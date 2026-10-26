'use strict';
// Combat is decided by the server. Players are staged with the test-only teleport (TEST_MODE) and the shooter is a
// prediction client that sends requests ("fire") with no direction or damage: the server aims with the view the player's
// input describes, shoots from ITS OWN simulated position and checks the target's position rewound by lag compensation.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, openPair, blockedPair, anglesTo, tp, dbg, stage, shoot, sleep, CFG, S, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

test('a body shot is decided by the server: 12 damage (the RIVALS rifle), health, confirmation and shot effect', async () => {
  const m = await liveMatch(srv, ['ShA', 'ShB']);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  shoot(sa);
  const hurt = await m.b.wait('hurt');
  const hit = await m.a.wait('hit');
  assert.strictEqual(hurt.dmg, 12);
  assert.strictEqual(hurt.hp, 138);
  assert.strictEqual(hurt.h, 0);
  assert.strictEqual(hurt.src, 'rifle');
  assert.strictEqual(hit.dmg, 12);
  assert.strictEqual(hit.head, false);
  assert.strictEqual(hit.kill, false);
  const fx = await m.b.wait('fx');
  assert.strictEqual(fx.k, 'shot');
  assert.strictEqual(fx.w, 'rifle');
  assert.ok(Array.isArray(fx.o), 'the shooter is in plain sight, so the effect carries its position');
  await sleep(120);
  assert.strictEqual(m.b.last('snap').hp, 138, 'the authoritative health is in the snapshot');
  m.a.close();
  m.b.close();
});

test('a headshot does 1.25x (15)', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair, { dy: 1.75 });
  shoot(sa);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.dmg, 15);
  assert.strictEqual(hurt.h, 1);
  assert.strictEqual((await m.a.wait('hit')).head, true);
  m.a.close();
  m.b.close();
});

test('fire rate is enforced: a burst of clicks in one instant is forgiven once (a long browser frame), the average rate is never beaten', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  sa.step(12, {});
  for (let i = 0; i < 5; i++) sa.act('fire'); // five clicks at the same instant of simulation time
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 2, 'a first shot plus the one extra a long frame can owe; the rest are refused');
  // a sustained too-fast rain of shots (every 25 ms instead of every 100 ms) is held to the weapon's rate
  sa.step(30, {});
  m.b.clear();
  for (let i = 0; i < 12; i++) {
    sa.step(3, {});
    sa.act('fire');
  }
  await sleep(600);
  const n = m.b.all('hurt').length;
  assert.ok(n >= 3 && n <= 5, '12 shots in 0.3 s of simulation time: only about 4 are allowed (rate + one burst), got ' + n);
  m.a.close();
  m.b.close();
});

test('a shot a hair before the reload finishes (the browser times it on the wall clock) still counts', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  sa.step(1, {});
  sa.act('fire'); // one round used so a reload is possible, and it hits (this also exercises the normal path)
  await m.b.wait('hurt', null, 1500);
  m.b.clear();
  sa.step(12, {});
  sa.act('reload');
  sa.step(Math.round((1.56 - 0.03) * 120), {}); // 30 ms before the server's own reload would be done
  sa.act('fire');
  const hurt = await m.b.wait('hurt', null, 4000).catch(() => null); // (the server spends real time simulating those ~200 steps)
  assert.ok(hurt && hurt.dmg === 12, 'the shot 30 ms early is accepted (reload margin), not silently dropped');
  m.a.close();
  m.b.close();
});

test('ammo is tracked on the server and a reload refills it', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  sa.step(1, { pitch: 1.4 }); // look at the sky so nothing is hit
  for (let i = 0; i < 5; i++) shoot(sa);
  await sleep(900);
  assert.strictEqual(m.a.last('snap').am, 15, 'a 20 round magazine, 5 fired');
  assert.strictEqual(m.a.last('snap').rs, 100, 'and 100 spare rounds');
  sa.act('reload');
  sa.step(200, {}); // 1.67 s of simulation: the reload (1.56 s) completes
  sa.flush();
  await sleep(2200);
  assert.strictEqual(m.a.last('snap').am, 20, 'ammo is back to a full magazine after the reload time');
  assert.strictEqual(m.a.last('snap').rs, 95, 'and only the 5 missing rounds came out of the spare rounds');
  // an empty magazine cannot shoot: burn 20 rounds, then aim at the enemy: the 21st does nothing
  for (let i = 0; i < 20; i++) shoot(sa, 12);
  sa.flush();
  await sleep(3500);
  assert.strictEqual(m.a.last('snap').am, 0, 'the magazine is empty');
  m.b.clear();
  const aim = anglesTo(pair.a, pair.b, 1.0);
  sa.step(1, { pitch: aim.pitch });
  shoot(sa, 12);
  await sleep(300);
  assert.strictEqual(m.b.all('hurt').length, 0, 'no ammo (and reloading): no shot');
  m.a.close();
  m.b.close();
});

test('shots cannot pass through walls', async () => {
  for (let tries = 0; tries < 12; tries++) {
    const m = await liveMatch(srv);
    const pair = blockedPair(m.map);
    if (!pair) {
      m.a.close();
      m.b.close();
      await sleep(100);
      continue;
    }
    const sa = await stage(m, m.ra, pair);
    shoot(sa);
    await sleep(400);
    assert.strictEqual(m.b.all('hurt').length, 0, 'a wall must block the shot');
    m.a.close();
    m.b.close();
    return;
  }
});

test('the weapon must match what the server says is in hand: grenade out = no rifle shot', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair, { slotA: 3 });
  sa.step(12, {});
  sa.act('fire', 0); // asks to shoot the rifle: switching takes time, so nothing happens
  sa.step(12, {});
  sa.act('fire', 3); // the grenade is not a gun
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 0);
  m.a.close();
  m.b.close();
});

test('fists: 30 damage up close, nothing from far away', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  let sa = await stage(m, m.ra, pair, { slotA: 2 });
  sa.step(30, {});
  sa.act('punch');
  await sleep(450);
  assert.strictEqual(m.b.all('hurt').length, 0, '8 m away: out of reach');
  const near = { x: pair.b.x + ((pair.a.x - pair.b.x) / 8) * 1.5, y: pair.b.y, z: pair.b.z + ((pair.a.z - pair.b.z) / 8) * 1.5 };
  sa = await stage(m, m.ra, { a: near, b: pair.b }, { slotA: 2, sim: sa });
  sa.step(60, {});
  sa.act('punch');
  const hurt = await m.b.wait('hurt', null, 3000);
  assert.strictEqual(hurt.dmg, 30);
  assert.strictEqual(hurt.src, 'fists');
  m.a.close();
  m.b.close();
});

test('lag compensation: the shot is checked against where the shooter saw the target (bounded rewind)', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const world = S.worldFor(m.map);
  // the victim steps 2.5 m sideways (perpendicular to the line of fire)
  const dx = pair.b.x - pair.a.x,
    dz = pair.b.z - pair.a.z,
    l = Math.hypot(dx, dz);
  let px = -dz / l,
    pz = dx / l;
  const side = (s) => ({ x: pair.b.x + px * s, y: pair.b.y, z: pair.b.z + pz * s });
  const ok = (s) => !world.overlapsAny(side(s).x, side(s).y, side(s).z, 0.4, 1.8) && world.floorBelow(side(s).x, side(s).y + 0.5, side(s).z, 0.3) > side(s).y - 0.05;
  if (!ok(2.5)) {
    px = -px;
    pz = -pz;
  }
  if (!ok(2.5)) {
    m.a.close();
    m.b.close();
    return; // cramped spot: nothing to test here
  }
  const sa = await stage(m, m.ra, pair);
  m.a.send({ t: 'ping', ts: 1 });
  const back = anglesTo(pair.b, pair.a, 1.0);
  // B moves away just now; A fires at the OLD position immediately (A saw B there ~RTT ago) -> the server rewinds -> hit
  tp(m.b, side(2.5), back.yaw, back.pitch, 0);
  await sleep(20);
  shoot(sa, 1);
  const hurt = await m.b.wait('hurt', null, 1500);
  assert.strictEqual(hurt.dmg, 12, 'a shot at the position the shooter saw must hit');
  // 400 ms later B has been standing at the new spot for much longer than the rewind cap: aiming at the old spot misses
  await sleep(500);
  m.b.clear();
  shoot(sa, 12);
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 0, 'the rewind is bounded: shooting at where the target was long ago misses');
  m.a.close();
  m.b.close();
});

test('hit tolerance: a shot that grazes just outside the body still counts (lag-compensation margin), one clearly outside does not', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const dist = Math.hypot(pair.b.x - pair.a.x, pair.b.z - pair.a.z);
  const sa = await stage(m, m.ra, pair);
  const yaw0 = sa.pl.yaw;
  // the body is 0.35 m to each side of its centre line, the margin CFG.LAG.TOL_XZ adds 0.10: 0.43 m off the line is a hit, 0.70 m is not
  assert.ok(CFG.LAG.TOL_XZ >= 0.08, 'the margin is configured');
  sa.pl.yaw = yaw0 + Math.atan2(0.43, dist);
  shoot(sa);
  const hurt = await m.b.wait('hurt', null, 1500);
  assert.strictEqual(hurt.dmg, 12, 'a graze 0.43 m off the centre line hits');
  await sleep(400);
  m.b.clear();
  sa.pl.yaw = yaw0 + Math.atan2(0.7, dist);
  shoot(sa, 12);
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 0, 'a shot 0.70 m off the centre line misses');
  m.a.close();
  m.b.close();
});

test('grenade: server-simulated flight, boom after the fuse, 75 to the enemy, none to the thrower', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 3);
  const sa = await stage(m, m.ra, pair, { slotA: 3 });
  sa.act('nadepin');
  sa.step(30, {}); // 0.25 s later (the pin has to be out a moment before it can be thrown)
  sa.step(1, { pitch: -1.5 }); // throw straight down: it lands at the thrower's feet, 3 m from the enemy (inside the 6 m blast)
  sa.act('nade');
  const na = await m.a.wait('nade'),
    nb = await m.b.wait('nade');
  assert.strictEqual(na.own, true);
  assert.strictEqual(nb.own, false);
  const t0 = Date.now();
  const boomA = await m.a.wait('boom', null, 4000),
    boomB = await m.b.wait('boom', null, 4000);
  const fuse = Date.now() - t0;
  assert.ok(fuse > RV.WEAPON_BY_ID.grenade.fuse * 1000 - 250 && fuse < RV.WEAPON_BY_ID.grenade.fuse * 1000 + 500, 'fuse is about ' + RV.WEAPON_BY_ID.grenade.fuse + ' s, was ' + fuse);
  assert.strictEqual(boomA.own, true);
  assert.strictEqual(boomB.own, false);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.src, 'grenade');
  assert.ok(hurt.dmg >= 25 && hurt.dmg <= 75, 'blast damage ' + hurt.dmg);
  assert.strictEqual(m.a.all('hurt').length, 0, 'your own grenade never hurts you');
  // a second throw straight away is refused (one grenade, 30 s cooldown)
  m.a.clear();
  m.b.clear();
  sa.act('nadepin');
  sa.step(30, {});
  sa.act('nade');
  await sleep(600);
  assert.strictEqual(m.b.all('nade').length, 0, 'no second grenade during the cooldown');
  m.a.close();
  m.b.close();
});

test('holding the grenade for the full time detonates it on the thrower (boost), not earlier', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 3);
  const sa = await stage(m, m.ra, pair, { slotA: 3 });
  sa.act('nadepin');
  sa.step(72, {}); // 0.6 s into the hold
  sa.act('nadeself'); // far too early
  await sleep(1000);
  assert.strictEqual(m.a.all('boom').length, 0, 'an early self-detonation is refused');
  sa.step(300, {}); // 3.1 s in
  sa.flush();
  await sleep(2800);
  sa.act('nadeself');
  const boom = await m.a.wait('boom', null, 2500);
  assert.strictEqual(boom.own, true);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.src, 'grenade');
  assert.strictEqual(m.a.all('hurt').length, 0);
  // the server pushed the thrower: they get a correction carrying the boosted state
  const fix = await m.a.wait('fix', (f) => f.why === 'boost', 1500);
  assert.ok(fix.st[4] > 3 || Math.hypot(fix.st[3], fix.st[5]) > 3, 'the blast launched the thrower (server-side boost)');
  m.a.close();
  m.b.close();
});

test('killing the opponent ends the round on both sides and starts the next countdown', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  for (let i = 0; i < 13; i++) shoot(sa); // 150 health / 12 damage
  const ea = await m.a.wait('roundEnd', null, 4000),
    eb = await m.b.wait('roundEnd', null, 4000);
  assert.strictEqual(ea.w, 'you');
  assert.strictEqual(eb.w, 'opp');
  assert.deepStrictEqual(ea.sc, [1, 0]);
  assert.deepStrictEqual(eb.sc, [0, 1]);
  assert.strictEqual(ea.over, false);
  const lastHit = m.a.all('hit').pop();
  assert.strictEqual(lastHit.kill, true);
  const r2 = await m.a.wait('round', null, 5000);
  assert.strictEqual(r2.n, 2);
  assert.deepStrictEqual(r2.sc, [1, 0]);
  assert.strictEqual(r2.opp, undefined, 'the opponent spawn is not disclosed');
  await sleep(200);
  assert.strictEqual(m.b.last('snap').hp, 150, 'round 2 starts with full health');
  m.a.close();
  m.b.close();
});

test('first to 5 wins the match; both players may agree to a rematch', async () => {
  const m = await liveMatch(srv);
  let round = m.ra;
  for (let n = 1; n <= 5; n++) {
    const pair = openPair(m.map, 8);
    const sa = await stage(m, round, pair);
    for (let i = 0; i < 13; i++) shoot(sa); // 150 health / 12 damage
    const e = await m.a.wait('roundEnd', null, 5000);
    assert.strictEqual(e.n, n);
    assert.deepStrictEqual(e.sc, [n, 0]);
    if (n < 5) {
      round = await m.a.wait('round', null, 5000);
      await m.b.wait('round', null, 5000);
      await m.a.wait('live', null, 6000);
      await m.b.wait('live', null, 6000);
    } else assert.strictEqual(e.over, true);
  }
  const ea = await m.a.wait('matchEnd', null, 5000),
    eb = await m.b.wait('matchEnd', null, 5000);
  assert.strictEqual(ea.w, 'you');
  assert.strictEqual(eb.w, 'opp');
  assert.deepStrictEqual(ea.sc, [5, 0]);
  assert.strictEqual(ea.reason, 'score');
  assert.ok(ea.rm > 0, 'a rematch window is offered');
  // rematch: both agree -> a fresh match in the same room with scores back to 0
  m.a.send({ t: 'rematch' });
  assert.strictEqual((await m.b.wait('rematch')).st, 'opp', 'the opponent is told that you want a rematch');
  m.b.send({ t: 'rematch' });
  const [ra, rb] = await Promise.all([m.a.wait('match', null, 3000), m.b.wait('match', null, 3000)]);
  assert.strictEqual(ra.room, m.room);
  assert.strictEqual(ra.opp, 'Bravo');
  m.a.send({ t: 'ready' });
  m.b.send({ t: 'ready' });
  const r1 = await m.a.wait('round', null, 3000);
  assert.strictEqual(r1.n, 1);
  assert.deepStrictEqual(r1.sc, [0, 0], 'scores are back to zero');
  m.a.close();
  m.b.close();
});

test('the round clock: when time runs out the player with more health wins', async () => {
  const old = CFG.ROUND_TIME;
  CFG.ROUND_TIME = 3.5;
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair, { settle: 250 });
  shoot(sa);
  const e = await m.a.wait('roundEnd', null, 6000);
  assert.strictEqual(e.w, 'you');
  CFG.ROUND_TIME = old;
  m.a.close();
  m.b.close();
});

test('leaving on purpose forfeits at once: the other player wins', async () => {
  const m = await liveMatch(srv);
  m.b.send({ t: 'leave' });
  const e = await m.a.wait('matchEnd', null, 4000);
  assert.strictEqual(e.w, 'you');
  assert.strictEqual(e.reason, 'forfeit');
  m.a.close();
  m.b.close();
});

test('falling off the map costs the round (decided by the simulation)', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await stage(m, m.ra, pair);
  m.b.clear();
  m.a.clear();
  tp(m.b, { x: pair.b.x, y: -100, z: pair.b.z }, 0, 0, 0); // far below the kill plane
  await sleep(50);
  // B's next input step is simulated at that height: the fall kills
  m.b.send({ t: 'in', rn: m.ra.n, q: 0, r: [[1, 0, 0, 0, 0, 0, 0]] });
  const hurt = await m.b.wait('hurt', null, 3000);
  assert.strictEqual(hurt.src, 'fall');
  assert.strictEqual((await m.a.wait('roundEnd')).w, 'you');
  m.a.close();
  m.b.close();
});
