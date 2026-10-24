'use strict';
// Spawn protection: a player whose round has just gone live takes no damage for SPAWN_PROTECT_S seconds, or until they
// attack. The server decides it (the client only shows a countdown); falling out of the map still kills.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, SimClient, openPair, anglesTo, tp, stage, shoot, sleep, CFG } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

/** Run `fn` with spawn protection switched on for this many seconds (the rest of the suite runs with it off). */
async function withProtection(seconds, fn) {
  const old = CFG.SPAWN_PROTECT_S;
  CFG.SPAWN_PROTECT_S = seconds;
  try {
    await fn();
  } finally {
    CFG.SPAWN_PROTECT_S = old;
  }
}

test('a protected player takes no damage: the shooter is told it was absorbed; afterwards shots land again', async () => {
  await withProtection(3, async () => {
    const m = await liveMatch(srv);
    const t0 = Date.now();
    const pair = openPair(m.map, 8);
    const sa = await stage(m, m.ra, pair, { settle: 200 });
    shoot(sa);
    await m.a.wait('blk', null, 1500);
    await sleep(100);
    assert.strictEqual(m.b.all('hurt').length, 0, 'no damage while protected');
    assert.strictEqual(m.a.all('hit').length, 0, 'and no hit marker for the shooter');
    assert.ok(m.b.last('snap').pr > 0, 'the protected player is told how long it lasts');
    assert.strictEqual(m.a.last('snap').o.pr, 1, 'and the opponent sees that they are protected');
    // wait for it to run out, then the same shot hurts
    while (Date.now() - t0 < 3300) await sleep(100);
    await sleep(100);
    assert.strictEqual(m.b.last('snap').pr, 0, 'the protection has ended');
    m.b.clear();
    shoot(sa);
    const hurt = await m.b.wait('hurt', null, 1500);
    assert.strictEqual(hurt.dmg, 12);
    m.a.close();
    m.b.close();
  });
});

test('attacking ends the protection at once: the attacker can be shot back', async () => {
  await withProtection(30, async () => {
    const m = await liveMatch(srv);
    const pair = openPair(m.map, 8);
    // B (protected) shoots A first
    const sw = { a: m.b, b: m.a, map: m.map };
    const sb = await stage(sw, m.rb, { a: pair.b, b: pair.a }, { settle: 200 });
    const sa = new SimClient(m.a, m.map, m.ra.you, m.ra.n); // A has not moved since the teleport; its view already points at B
    sa.act('fire');
    await m.a.wait('blk', null, 1500).catch(() => null);
    await sleep(100);
    assert.strictEqual(m.b.all('hurt').length, 0, 'B is still protected before it attacks');
    shoot(sb);
    const hit = await m.b.wait('hit', null, 1500);
    assert.strictEqual(hit.dmg, 12, 'a protected player can attack');
    await sleep(120); // (the next snapshot)
    assert.strictEqual(m.b.last('snap').pr || 0, 0, 'but its own protection is gone');
    m.a.clear();
    m.b.clear();
    const aim = anglesTo(pair.a, pair.b, 1.0); // A's view of B, as the staging helper set it
    sa.step(12, { yaw: aim.yaw, pitch: aim.pitch });
    sa.flush(true);
    sa.act('fire');
    const hurt = await m.b.wait('hurt', null, 1500);
    assert.strictEqual(hurt.dmg, 12, 'so A can hit B right away although 30 s of protection were configured');
    m.a.close();
    m.b.close();
  });
});

test('spawn protection does not stop the void: falling out of the map still costs the round', async () => {
  await withProtection(30, async () => {
    const m = await liveMatch(srv);
    const pair = openPair(m.map, 8);
    await stage(m, m.ra, pair, { settle: 100 });
    m.a.clear();
    m.b.clear();
    tp(m.b, { x: pair.b.x, y: -100, z: pair.b.z }, 0, 0, 0);
    await sleep(50);
    m.b.send({ t: 'in', rn: m.ra.n, q: 0, r: [[1, 0, 0, 0, 0, 0, 0]] });
    const hurt = await m.b.wait('hurt', null, 3000);
    assert.strictEqual(hurt.src, 'fall');
    assert.strictEqual((await m.a.wait('roundEnd')).w, 'you');
    m.a.close();
    m.b.close();
  });
});

test('protection starts when the round goes live, not before (the countdown is locked anyway) and is per round', async () => {
  await withProtection(30, async () => {
    const m = await liveMatch(srv);
    await sleep(150);
    assert.ok(m.a.last('snap').pr > 25, 'full protection right after live: ' + m.a.last('snap').pr);
    const pair = openPair(m.map, 8);
    const sa = await stage(m, m.ra, pair, { settle: 100 });
    // end the round with a fall; the next round starts unprotected until it goes live again
    tp(m.b, { x: pair.b.x, y: -100, z: pair.b.z }, 0, 0, 0);
    await sleep(50);
    m.b.send({ t: 'in', rn: m.ra.n, q: 0, r: [[1, 0, 0, 0, 0, 0, 0]] });
    await m.a.wait('roundEnd', null, 3000);
    await m.a.wait('round', null, 5000);
    await sleep(200);
    assert.strictEqual(m.a.last('snap').pr || 0, 0, 'no protection during the countdown');
    await m.a.wait('live', null, 6000);
    await sleep(150);
    assert.ok(m.a.last('snap').pr > 25, 'protected again once round 2 is live');
    assert.ok(sa);
    m.a.close();
    m.b.close();
  });
});
