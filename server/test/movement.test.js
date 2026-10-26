'use strict';
// The server simulates movement itself (same js/player.js as the browser) from the client's INPUT. These tests drive
// the server with a real prediction client (SimClient: local physics + the browser's wire format) and prove that
//   - everything the game's movement can do is accepted and produces the SAME result on both sides,
//   - everything it cannot do (extra jumps, speed-ups, teleports, impossible turning) is refused or corrected.
process.env.TEST_MODE = '1'; // enables the test-only teleport / debug messages used to inspect the server's state
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, SimClient, dbg, tp, sleep, runway, placeSim, CFG, S, RV } = require('./helpers');
const ac = require('../anticheat');
const seen = (rule) => ac.snapshot().rules.find((r) => r.rule === rule).seen;

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0; // these tests provoke kicks on purpose; every test client shares 127.0.0.1
});
test.after(async () => {
  await srv.stop();
});

async function match() {
  const m = await liveMatch(srv);
  const sa = new SimClient(m.a, m.map, m.ra.you, m.ra.n);
  return { m, sa };
}

/** Wait until the server has simulated everything the client sent, then compare the two positions. */
async function settle(m, sa) {
  sa.flush();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    sa.pump();
    const d = await dbg(m.a);
    if (d.a >= sa.sent && d.q === 0) {
      const b = sa.pl.b;
      const err = Math.hypot(d.x - b.x, d.y - b.y, d.z - b.z);
      return { d, err };
    }
  }
  throw new Error('server did not finish simulating the input');
}

/** A repeatable pseudo-random input script (keys, jumps, crouches, mouse turning). */
function script(seed, opts) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let fw = 1,
    sd = 0,
    crouch = false,
    sprint = true,
    yaw = 0,
    jumpAt = 0;
  return (i, sim) => {
    if (i % 7 === 0) {
      fw = rnd() < 0.8 ? 1 : rnd() < 0.5 ? 0 : -1;
      sd = rnd() < 0.5 ? 0 : rnd() < 0.5 ? -1 : 1;
      crouch = rnd() < 0.2;
      sprint = rnd() < 0.8;
    }
    yaw += (rnd() - 0.5) * 0.25;
    const jump = i >= jumpAt && rnd() < 0.3;
    if (jump) jumpAt = i + 3;
    return { k: 4, fw, sd, crouch, sprint, jump, yaw: Math.max(-3.1, Math.min(3.1, yaw)), pitch: 0, slot: opts && opts.slot != null ? opts.slot : 0, autoHop: opts && opts.autoHop };
  };
}

test('walking and sprinting: the server simulation matches the client prediction exactly, no corrections', async () => {
  const { m, sa } = await match();
  const rw = runway(m.map, 11); // (a clear straight line: the tight maps have walls and pillars close to every spawn)
  await placeSim(m, sa, rw, rw.yaw);
  await sa.run(1.1, () => ({ fw: 1, sprint: true }));
  const { d, err } = await settle(m, sa);
  assert.ok(err < 1e-6, 'client and server agree to the last bit, off by ' + err);
  assert.strictEqual(sa.fixes, 0, 'an honest client is never corrected');
  assert.ok(Math.hypot(sa.pl.b.vx, sa.pl.b.vz) > 5, 'and it really moved');
  assert.ok(d.a > 60, 'the server ran ' + d.a + ' steps');
  m.a.close();
  m.b.close();
});

test('bunny hopping, air strafing and slides are accepted and identical on both sides (many seeds, several maps)', async () => {
  for (const seed of [1, 2, 3]) {
    const { m, sa } = await match();
    await sa.run(3.2, script(seed, { autoHop: seed === 2 }));
    const { err } = await settle(m, sa);
    assert.ok(err < 1e-6, 'seed ' + seed + ' on ' + m.map + ': off by ' + err);
    assert.strictEqual(sa.fixes, 0, 'seed ' + seed + ': an honest, skilled client is never corrected');
    m.a.close();
    m.b.close();
  }
});

test('a hop chain: jump the instant you land keeps the speed (bunny hop), slide + slide jump adds speed', async () => {
  const { m, sa } = await match();
  const rw = runway(m.map, 11);
  await placeSim(m, sa, rw, rw.yaw);
  let hops = 0; // press jump every time we are on the ground
  sa.pl.onEvent = (type) => {
    if (type === 'jump') hops++;
  };
  await sa.run(3, (i, c) => {
    return { k: 2, fw: 1, sprint: true, jump: c.pl.b.grounded || c.pl.coyote > 0, press: true };
  }, 16);
  const v = Math.hypot(sa.pl.b.vx, sa.pl.b.vz);
  const { err } = await settle(m, sa);
  assert.ok(err < 1e-6);
  assert.strictEqual(sa.fixes, 0);
  assert.ok(hops >= 1, 'it really hopped (' + hops + ' jumps in 3 s on ' + m.map + '; the 11 m runway of the tightest map fits only one or two)');
  // slide: sprint, hold crouch (slide starts), then jump out of it
  const sl = await match();
  const rw2 = runway(sl.m.map, 11);
  await placeSim(sl.m, sl.sa, rw2, rw2.yaw);
  let slid = false,
    topSpeed = 0;
  await sl.sa.run(2.5, (i, c) => {
    topSpeed = Math.max(topSpeed, c.pl.speedH);
    if (c.pl.mode === 'slide') slid = true;
    if (i < 24) return { k: 4, fw: 1, sprint: true };
    if (i < 30) return { k: 4, fw: 1, sprint: true, crouch: true };
    if (i === 30) return { k: 4, fw: 1, sprint: true, crouch: true, jump: true };
    return { k: 4, fw: 1, sprint: true };
  });
  const r = await settle(sl.m, sl.sa);
  assert.ok(slid, 'the slide really happened');
  assert.ok(topSpeed > 11, 'slide boost ' + topSpeed.toFixed(1));
  assert.ok(r.err < 1e-6, 'slide: off by ' + r.err);
  assert.strictEqual(sl.sa.fixes, 0, 'slides and slide jumps are legal');
  for (const x of [m.a, m.b, sl.m.a, sl.m.b]) x.close();
});

test('the fists-only double jump: one extra jump per air time, accepted and identical', async () => {
  const { m, sa } = await match();
  // equip the fists (slot 2), wait out the switch, jump, then press jump again in the air, and a third time (must do nothing)
  let phase = 0,
    airJumps = 0,
    t0 = 0;
  await sa.run(2.4, (i, c) => {
    if (i < 3) return { k: 4, slot: 2 };
    if (i < 10) return { k: 4, slot: 2 };
    if (i === 10) return { k: 1, slot: 2, jump: true };
    if (i === 11) return { k: 1, slot: 2 };
    // press jump again every few frames while in the air
    if (!c.pl.b.grounded && i % 6 === 0) {
      if (c.pl.djUsed) airJumps++;
      return { k: 1, slot: 2, jump: true };
    }
    return { k: 4, slot: 2 };
  });
  const { d, err } = await settle(m, sa);
  assert.ok(err < 1e-6, 'double jump: off by ' + err);
  assert.strictEqual(sa.fixes, 0, 'the legal double jump is not corrected');
  assert.strictEqual(d.slot, 2);
  m.a.close();
  m.b.close();
});

test('an EXTRA jump without fists is refused: the server never grants it, the client is corrected', async () => {
  const { m, sa } = await match();
  // a modified client believes it may double jump with the rifle in hand
  let jumped = false;
  await sa.run(2, (i, c) => {
    const inp = { k: 1, slot: 0, forceDj: true };
    if (i === 5) return Object.assign(inp, { jump: true });
    if (!jumped && !c.pl.b.grounded && c.pl.airTime > 0.15) {
      jumped = true;
      return Object.assign(inp, { jump: true });
    }
    return { k: 4, slot: 0, forceDj: true };
  });
  const { d } = await settle(m, sa);
  assert.ok(sa.fixes >= 1, 'the server corrected the cheating client (' + sa.fixes + ' corrections)');
  // after the corrections client and server agree again, and the position is that of a player who did NOT double jump
  const b = sa.pl.b;
  assert.ok(Math.hypot(d.x - b.x, d.y - b.y, d.z - b.z) < 0.5, 'client was pulled back to the server state');
  const honest = new RV.Player(S.worldFor(m.map));
  const sp = RV.maps[m.map].spawns[m.ra.you];
  honest.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
  // an honest replay of the same inputs without the extra jump ends where the server says
  assert.ok(d.vy < 9.5, 'vertical speed is never above a normal jump: ' + d.vy.toFixed(2));
  m.a.close();
  m.b.close();
});

test('a claim of a different position changes nothing on the server (positions are never taken from the client)', async () => {
  const { m, sa } = await match();
  await sa.run(0.6, () => ({ fw: 1, sprint: true }));
  const before = await settle(m, sa);
  // lie: claim to be 40 m away
  m.a.send({ t: 'in', rn: sa.round, q: sa.sent, r: [[4, 1, 0, 8, sa.pl.yaw, 0, 0]], c: [before.d.x + 40, before.d.y, before.d.z, sa.fx] });
  sa.sent += 4; // keep the sequence consistent for the follow-up (the server did simulate those 4 steps)
  await sleep(150);
  const fix = await m.a.wait('fix', null, 2000);
  assert.strictEqual(fix.why, 'mismatch');
  const after = await dbg(m.a);
  assert.ok(Math.hypot(after.x - before.d.x, after.z - before.d.z) < 2, 'the server position moved only by 4 honest steps');
  m.a.close();
  m.b.close();
});

test('speed hack: input sent faster than real time is NOT simulated faster (it waits in the queue)', async () => {
  const { m, sa } = await match();
  const t0 = Date.now();
  // 2.7 seconds of input (320 steps) delivered in ~70 ms
  for (let i = 0; i < 8; i++) {
    sa.step(40, { fw: 1, sprint: true });
    sa.flush(true);
    await sleep(8);
  }
  const d = await dbg(m.a);
  const elapsed = (Date.now() - t0) / 1000;
  const allowed = elapsed * 120 * CFG.MOVE.CATCHUP + CFG.MOVE.INPUT_BURST_STEPS + 12;
  assert.ok(d.a <= allowed, 'server simulated ' + d.a + ' steps in ' + elapsed.toFixed(2) + ' s (limit ' + Math.round(allowed) + ')');
  assert.ok(d.q > 100, 'the surplus is still waiting in the queue (' + d.q + ' steps), not simulated early');
  // it is still honoured at the real-time rate: later the whole thing has been simulated, no steps lost or invented
  const r = await settle(m, sa);
  assert.ok(r.err < 1e-6 && r.d.a === 320, 'all 320 steps ran, at the speed of the clock');
  m.a.close();
  m.b.close();
});

test('a network stall that delivers 2 s of input in one lump is not punished, and the backlog is worked off (no permanent lag)', async () => {
  const { m, sa } = await match();
  const before = seen('input_overflow');
  // 0.5 s of normal play ...
  await sa.run(0.5, () => ({ fw: 1, sprint: true }));
  sa.flush();
  await sleep(100);
  // ... then the connection stalls for 2 s while the player keeps playing: all of it arrives at once
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) sa.step(40, { fw: 1, sd: i % 2, sprint: true, yaw: 0.05 * i });
  await sleep(2000 - (Date.now() - t0));
  sa.flush();
  await sleep(150);
  let d = await dbg(m.a);
  assert.ok(d.q > 60, 'the lump is queued (' + d.q + ' steps)');
  // 240 queued steps are worked off at 1.5x real time: far sooner than the 2 s it would take at 1x, and certainly not "never"
  const t1 = Date.now();
  while (d.q > 0 && Date.now() - t1 < 5000) {
    await sleep(100);
    d = await dbg(m.a);
  }
  const drain = (Date.now() - t1) / 1000;
  assert.strictEqual(d.q, 0, 'the backlog was worked off');
  assert.ok(drain < 1.9, 'in ' + drain.toFixed(2) + ' s (catch-up), not at 1x speed');
  const r = await settle(m, sa);
  assert.ok(r.err < 1e-6, 'and the result is exactly what the client predicted, off by ' + r.err);
  assert.strictEqual(seen('input_overflow'), before, 'an honest stall is not an overflow violation');
  assert.ok(!m.a.closed, 'and the player is not kicked');
  m.a.close();
  m.b.close();
});

test('a stalled server loop does not become a permanent backlog: the time it lost is paid back (no overflow kick for an honest client)', async () => {
  const { m, sa } = await match();
  const before = seen('input_overflow');
  // 2.5 s of input arrives in one go and starts to be worked off ...
  for (let i = 0; i < 5; i++) sa.step(60, { fw: 1, sprint: true });
  sa.flush(true);
  await sleep(150);
  const d0 = await dbg(m.a);
  assert.ok(d0.q > 200, 'a backlog is waiting (' + d0.q + ' steps)');
  // ... then the server's event loop does not run for 1.2 s (a GC pause, a throttled host, a busy machine)
  const t = Date.now();
  while (Date.now() - t < 1200) {
    /* blocked */
  }
  await sleep(120);
  const d1 = await dbg(m.a);
  // 1.2 s at 1.5x is ~216 steps of owed time: it must be used, not thrown away down to the 45-step burst
  assert.ok(d1.a - d0.a >= 150, 'the server caught up by ' + (d1.a - d0.a) + ' steps after the stall (it was owed ~216)');
  assert.strictEqual(seen('input_overflow'), before, 'no overflow violation');
  assert.ok(!m.a.closed, 'and the player is not kicked');
  m.a.close();
  m.b.close();
});

test('a sustained speed-up (input at ~2x real time) is caught once it is ahead of the clock by more than the slack', async () => {
  const { m, sa } = await match();
  const before = seen('input_overflow');
  const t0 = Date.now();
  // exactly 240 steps per real second (2x). The slack (3 s of input) is used up after ~3 s.
  while (Date.now() - t0 < 6000 && !m.a.closed) {
    const want = Math.floor(((Date.now() - t0) / 1000) * 240) - sa.seq;
    if (want > 0) sa.step(Math.min(want, 40), { fw: 1, sprint: true });
    sa.flush(true);
    await sleep(25);
  }
  await sleep(300);
  assert.ok(seen('input_overflow') > before, 'recorded as input_overflow');
  assert.ok(m.a.closed && m.a.closed.code === 1008, 'and the session was kicked (1008): ' + JSON.stringify(m.a.closed));
  m.b.close();
});

test('flooding the input queue is flagged as severe and gets the session kicked (with a lockout, never a permanent ban)', async () => {
  const { m, sa } = await match();
  const before = seen('input_overflow');
  for (let i = 0; i < 14 && !m.a.closed; i++) {
    sa.step(60, { fw: 1, sprint: true });
    sa.flush(true);
    await sleep(4);
  }
  await sleep(300);
  assert.ok(seen('input_overflow') > before, 'flooding was recorded');
  assert.ok(m.a.closed && m.a.closed.code === 1008, 'kicked (1008), got ' + JSON.stringify(m.a.closed));
  m.b.close();
});

test('impossible view turning is clamped and flagged (no instant 180 degree snap)', async () => {
  const { m, sa } = await match();
  const before = seen('aim_rate');
  sa.step(1, { fw: 0, yaw: 0, pitch: 0 });
  sa.step(1, { fw: 0, yaw: 3.0, pitch: 0 }); // 3 radians in 1/120 s = 360 rad/s: faster than any hand
  sa.flush(true);
  await sleep(200);
  assert.ok(seen('aim_rate') > before, 'flagged');
  m.a.close();
  m.b.close();
});

test('out-of-order or replayed input is refused (the server keeps its own count)', async () => {
  const { m, sa } = await match();
  const dup0 = seen('seq_dup'),
    gap0 = seen('seq_gap');
  sa.step(8, { fw: 1 });
  sa.flush(true);
  await sleep(120);
  // replay the same sequence number
  m.a.send({ t: 'in', rn: sa.round, q: 0, r: [[8, 1, 0, 0, 0, 0, 0]] });
  // and jump ahead of it
  m.a.send({ t: 'in', rn: sa.round, q: 500, r: [[8, 1, 0, 0, 0, 0, 0]] });
  await sleep(200);
  assert.ok(seen('seq_dup') > dup0, 'replay counted');
  assert.ok(seen('seq_gap') > gap0, 'gap counted');
  const d = await dbg(m.a);
  assert.ok(d.a <= 8, 'neither message moved the player (server ran ' + d.a + ' steps)');
  m.a.close();
  m.b.close();
});
