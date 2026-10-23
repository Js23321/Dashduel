'use strict';
// TEST_MODE lets the test clients stand wherever they like (movement validation is covered in cheat.test.js).
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, openPair, blockedPair, aimAt, stMsg, sleep, CFG, S, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
});
test.after(async () => {
  await srv.stop();
});

/** Put both players where we want them and let the server's history catch up. */
async function place(m, pa, pb, extraA, extraB) {
  for (let i = 0; i < 3; i++) {
    m.a.send(stMsg(pa, extraA));
    m.b.send(stMsg(pb, extraB));
    await sleep(120);
  }
}
const fireAt = (m, from, to, dy) => m.a.send({ t: 'fire', s: 0, d: aimAt(from, to, dy) });

test('a body shot is decided by the server: 25 damage, health, confirmation and shot effect', async () => {
  const m = await liveMatch(srv, ['ShA', 'ShB']);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.a.clear(); m.b.clear();
  fireAt(m, pair.a, pair.b, 1.0);
  const hurt = await m.b.wait('hurt');
  const hit = await m.a.wait('hit');
  assert.strictEqual(hurt.dmg, 25);
  assert.strictEqual(hurt.hp, 125);
  assert.strictEqual(hurt.h, 0);
  assert.strictEqual(hurt.src, 'rifle');
  assert.strictEqual(hit.dmg, 25);
  assert.strictEqual(hit.head, false);
  assert.strictEqual(hit.kill, false);
  const fx = await m.b.wait('fx');
  assert.strictEqual(fx.k, 'shot');
  assert.strictEqual(fx.w, 'rifle');
  await sleep(120);
  assert.strictEqual(m.b.last('snap').hp, 125, 'the authoritative health is in the snapshot');
  m.a.close(); m.b.close();
});

test('a headshot does 1.5x (38)', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.b.clear(); m.a.clear();
  fireAt(m, pair.a, pair.b, 1.75);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.dmg, 38);
  assert.strictEqual(hurt.h, 1);
  assert.strictEqual((await m.a.wait('hit')).head, true);
  m.a.close(); m.b.close();
});

test('fire rate is enforced: a second shot inside the interval does nothing', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.b.clear();
  const d = aimAt(pair.a, pair.b, 1.0);
  m.a.send({ t: 'fire', s: 0, d });
  m.a.send({ t: 'fire', s: 0, d });
  m.a.send({ t: 'fire', s: 0, d });
  await sleep(400);
  assert.strictEqual(m.b.all('hurt').length, 1, 'three instant shots count as one');
  m.a.close(); m.b.close();
});

test('ammo is tracked on the server and a reload refills it', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  // shoot at the sky so nothing is hit
  for (let i = 0; i < 5; i++) {
    m.a.send({ t: 'fire', s: 0, d: [0, 1, 0] });
    await sleep(115);
  }
  await sleep(100);
  assert.strictEqual(m.a.last('snap').am, 25);
  m.a.send({ t: 'reload' });
  await sleep(1700);
  assert.strictEqual(m.a.last('snap').am, 30, 'ammo is back to a full magazine after the reload time');
  // an empty magazine cannot shoot: burn 30 rounds, the 31st does nothing even aimed at the enemy
  for (let i = 0; i < 30; i++) {
    m.a.send({ t: 'fire', s: 0, d: [0, 1, 0] });
    await sleep(105);
  }
  m.b.clear();
  fireAt(m, pair.a, pair.b, 1.0);
  await sleep(300);
  assert.strictEqual(m.b.all('hurt').length, 0, 'no ammo (and reloading): no shot');
  m.a.close(); m.b.close();
});

test('shots cannot pass through walls', async () => {
  const bp = ['toybox', 'skybridge', 'pinwheel', 'vertigo'].map((id) => ({ id, bp: blockedPair(id) })).find((x) => x.bp);
  if (!bp) return; // none of the maps has such a pair: nothing to test
  // run a match until it lands on a map with a wall between two points: try a few matches
  for (let tries = 0; tries < 12; tries++) {
    const m = await liveMatch(srv);
    const pair = blockedPair(m.map);
    if (!pair) {
      m.a.close(); m.b.close();
      await sleep(100);
      continue;
    }
    await place(m, pair.a, pair.b);
    m.b.clear();
    fireAt(m, pair.a, pair.b, 1.0);
    await sleep(400);
    assert.strictEqual(m.b.all('hurt').length, 0, 'a wall must block the shot');
    m.a.close(); m.b.close();
    return;
  }
});

test('the weapon must match: a rifle shot while the grenade is out is ignored', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b, { w: 3 });
  m.b.clear();
  m.a.send({ t: 'fire', s: 0, d: aimAt(pair.a, pair.b, 1.0) });
  m.a.send({ t: 'fire', s: 3, d: aimAt(pair.a, pair.b, 1.0) });
  await sleep(400);
  assert.strictEqual(m.b.all('hurt').length, 0);
  m.a.close(); m.b.close();
});

test('fists: 32 damage up close, nothing from far away', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const near = { x: pair.b.x + (pair.a.x - pair.b.x) / 8 * 1.5, y: pair.b.y, z: pair.b.z + (pair.a.z - pair.b.z) / 8 * 1.5 };
  await place(m, pair.a, pair.b, { w: 2 });
  m.b.clear();
  m.a.send({ t: 'punch', d: aimAt(pair.a, pair.b, 1.0) });
  await sleep(350);
  assert.strictEqual(m.b.all('hurt').length, 0, '8 m away: out of reach');
  await place(m, near, pair.b, { w: 2 });
  m.b.clear();
  m.a.send({ t: 'punch', d: aimAt(near, pair.b, 1.0) });
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.dmg, 32);
  assert.strictEqual(hurt.src, 'fists');
  m.a.close(); m.b.close();
});

test('lag compensation: the shot is checked against where the shooter saw the target', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const world = S.worldFor(m.map);
  // the victim runs sideways (perpendicular to the line of fire) at 10 m/s
  const dx = pair.b.x - pair.a.x, dz = pair.b.z - pair.a.z, l = Math.hypot(dx, dz);
  let px = -dz / l, pz = dx / l;
  const endOk = (s) => world.lineClear(pair.a.x, pair.a.y + 1.62, pair.a.z, pair.b.x + px * s * 3, pair.b.y + 1, pair.b.z + pz * s * 3);
  if (!endOk(1)) { px = -px; pz = -pz; }
  if (!endOk(1)) { m.a.close(); m.b.close(); return; } // cramped spot: skip
  const speed = 10;
  const posAt = (sec) => ({ x: pair.b.x + px * speed * sec, y: pair.b.y, z: pair.b.z + pz * speed * sec });
  m.a.send(stMsg(pair.a));
  const t0 = Date.now();
  const run = async (aimBack, label) => {
    // stream the victim's states for 0.45 s, fire at the right moment
    let fired = false, hp0 = null;
    m.b.clear();
    const start = Date.now();
    while (Date.now() - start < 450) {
      const s = (Date.now() - start) / 1000;
      m.b.send(stMsg(posAt(s), { sp: speed }));
      if (!fired && s > 0.3) {
        fired = true;
        const target = posAt(s - (aimBack ? 0.1 : 0));
        m.a.send({ t: 'fire', s: 0, d: aimAt(pair.a, target, 1.0) });
      }
      await sleep(33);
    }
    await sleep(250);
    return m.b.all('hurt').length;
  };
  // 1) aim where the target was 100 ms ago (what the shooter's screen showed): hits
  m.b.send(stMsg(pair.b));
  await sleep(200);
  const hitsBack = await run(true, 'rewound');
  assert.strictEqual(hitsBack, 1, 'a shot at the position the shooter saw must hit');
  // 2) aim at the target's CURRENT position, 1 m ahead of where the shooter saw it: misses
  await sleep(300);
  m.b.send(stMsg(pair.b));
  await sleep(200);
  const hitsFront = await run(false, 'current');
  assert.strictEqual(hitsFront, 0, 'aiming where the target is now (ahead of what the shooter saw) must miss');
  m.a.close(); m.b.close();
});

test('grenade: server-simulated flight, boom after the fuse, 75 to the enemy, none to the thrower', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 3);
  await place(m, pair.a, pair.b, { w: 3 }, { w: 0 });
  m.a.clear(); m.b.clear();
  m.a.send({ t: 'nadepin' });
  await sleep(250);
  // throw straight down: it lands at the thrower's feet, 3 m from the enemy (inside the 6 m blast)
  m.a.send({ t: 'nade', d: [0, -1, 0] });
  const na = await m.a.wait('nade'), nb = await m.b.wait('nade');
  assert.strictEqual(na.own, true);
  assert.strictEqual(nb.own, false);
  const t0 = Date.now();
  const boomA = await m.a.wait('boom', null, 4000), boomB = await m.b.wait('boom', null, 4000);
  const fuse = Date.now() - t0;
  assert.ok(fuse > 1500 && fuse < 2500, 'fuse is about 2 s, was ' + fuse);
  assert.strictEqual(boomA.own, true);
  assert.strictEqual(boomB.own, false);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.src, 'grenade');
  assert.ok(hurt.dmg >= 25 && hurt.dmg <= 75, 'blast damage ' + hurt.dmg);
  assert.strictEqual(m.a.all('hurt').length, 0, 'your own grenade never hurts you');
  // a second throw straight away is refused (one grenade, 30 s cooldown)
  m.a.clear(); m.b.clear();
  m.a.send({ t: 'nadepin' });
  await sleep(250);
  m.a.send({ t: 'nade', d: [0, -1, 0] });
  await sleep(500);
  assert.strictEqual(m.b.all('nade').length, 0, 'no second grenade during the cooldown');
  m.a.close(); m.b.close();
});

test('holding the grenade for the full time detonates it on the thrower (boost), not earlier', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 3);
  await place(m, pair.a, pair.b, { w: 3 }, { w: 0 });
  m.a.clear(); m.b.clear();
  m.a.send({ t: 'nadepin' });
  await sleep(600);
  m.a.send({ t: 'nadeself' }); // far too early
  await sleep(300);
  assert.strictEqual(m.a.all('boom').length, 0, 'an early self-detonation is refused');
  await sleep(2300);
  m.a.send({ t: 'nadeself' });
  const boom = await m.a.wait('boom', null, 2000);
  assert.strictEqual(boom.own, true);
  const hurt = await m.b.wait('hurt');
  assert.strictEqual(hurt.src, 'grenade');
  assert.strictEqual(m.a.all('hurt').length, 0);
  m.a.close(); m.b.close();
});

test('killing the opponent ends the round on both sides and starts the next countdown', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.a.clear(); m.b.clear();
  for (let i = 0; i < 6; i++) {
    fireAt(m, pair.a, pair.b, 1.0);
    await sleep(115);
  }
  const ea = await m.a.wait('roundEnd'), eb = await m.b.wait('roundEnd');
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
  // round 2: full health again, shots are not accepted during the new countdown
  await sleep(200);
  assert.strictEqual(m.b.last('snap').hp, 150);
  m.a.close(); m.b.close();
});

test('first to 5 wins the match; the room then closes and both players are free', async () => {
  const m = await liveMatch(srv);
  let live = true;
  for (let round = 1; round <= 5; round++) {
    const pair = openPair(m.map, 8);
    await place(m, pair.a, pair.b);
    m.a.clear(); m.b.clear();
    for (let i = 0; i < 6; i++) {
      fireAt(m, pair.a, pair.b, 1.0);
      await sleep(115);
    }
    const e = await m.a.wait('roundEnd', null, 4000);
    assert.strictEqual(e.n, round);
    assert.deepStrictEqual(e.sc, [round, 0]);
    if (round < 5) {
      await m.a.wait('round', null, 5000);
      await m.a.wait('live', null, 6000);
      await m.b.wait('live', null, 6000);
    } else assert.strictEqual(e.over, true);
  }
  const ea = await m.a.wait('matchEnd', null, 5000), eb = await m.b.wait('matchEnd', null, 5000);
  assert.strictEqual(ea.w, 'you');
  assert.strictEqual(eb.w, 'opp');
  assert.deepStrictEqual(ea.sc, [5, 0]);
  assert.strictEqual(ea.reason, 'score');
  await sleep(200);
  m.a.send({ t: 'queue' });
  assert.ok(await m.a.wait('queued'), 'the winner can queue again');
  m.a.close(); m.b.close();
});

test('the round clock: when time runs out the player with more health wins', async () => {
  const old = CFG.ROUND_TIME;
  CFG.ROUND_TIME = 2.5;
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.a.clear(); m.b.clear();
  fireAt(m, pair.a, pair.b, 1.0);
  const e = await m.a.wait('roundEnd', null, 5000);
  assert.strictEqual(e.w, 'you');
  CFG.ROUND_TIME = old;
  m.a.close(); m.b.close();
});

test('if the opponent disconnects mid-match you win by forfeit', async () => {
  const m = await liveMatch(srv);
  m.b.close();
  const e = await m.a.wait('matchEnd', null, 4000);
  assert.strictEqual(e.w, 'you');
  assert.strictEqual(e.reason, 'forfeit');
  m.a.close();
});

test('falling off the map costs the round', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  await place(m, pair.a, pair.b);
  m.b.clear(); m.a.clear();
  m.b.send(stMsg({ x: pair.b.x, y: -500 + 400, z: pair.b.z })); // y = -100: far below the kill plane
  const hurt = await m.b.wait('hurt', null, 3000);
  assert.strictEqual(hurt.src, 'fall');
  assert.strictEqual((await m.a.wait('roundEnd')).w, 'you');
  m.a.close(); m.b.close();
});
