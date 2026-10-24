'use strict';
// The Test Arena map (converted from the CC0 "Rivals Arena Map" STL) works online: it is picked for matches, it has
// clear fighting spots and hidden spots, hits are decided by the server on it, and walls hide the opponent.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, openPair, hiddenPair, stage, shoot, sleep, CFG, S, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

test('the Test Arena is in the online map rotation and its spawns are on the floor, clear of every solid', () => {
  assert.ok(CFG.MAPS.includes('testarena'));
  const map = RV.maps.testarena;
  assert.ok(map.modes.includes('online'));
  const world = S.worldFor('testarena');
  assert.ok(map.spawns.length >= 6);
  for (const sp of map.spawns) {
    assert.ok(!world.overlapsAny(sp.x, sp.y + 0.05, sp.z, 0.45, 1.85), 'spawn clear: ' + sp.x + ',' + sp.z);
    assert.ok(Math.abs(world.floorBelow(sp.x, sp.y + 0.5, sp.z, 0.3) - sp.y) < 0.05, 'spawn on the floor');
  }
  assert.ok(hiddenPair('testarena'), 'the map has places that cannot see each other');
  assert.ok(openPair('testarena', 8), 'and places that can');
});

test('a match on the Test Arena: server-decided hit, and the opponent behind the bars is not replicated', async () => {
  const old = CFG.MAPS.slice();
  CFG.MAPS.length = 0;
  CFG.MAPS.push('testarena');
  try {
    const m = await liveMatch(srv);
    assert.strictEqual(m.map, 'testarena');
    const pair = openPair(m.map, 8);
    const sa = await stage(m, m.ra, pair);
    shoot(sa);
    const hurt = await m.b.wait('hurt', null, 2000);
    assert.strictEqual(hurt.dmg, 12);
    const hp = hiddenPair(m.map);
    const sw = { a: m.b, b: m.a, map: m.map };
    await stage(m, m.ra, hp, { settle: 900 });
    await sleep(600);
    assert.strictEqual(m.b.last('snap').o.hid, 1, 'B cannot see A behind the bars / tower');
    assert.strictEqual(m.b.last('snap').o.x, undefined);
    assert.ok(sw);
    m.a.close();
    m.b.close();
  } finally {
    CFG.MAPS.length = 0;
    for (const id of old) CFG.MAPS.push(id);
  }
});
