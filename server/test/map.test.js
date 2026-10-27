'use strict';
// The map pool (Arena, Bridge, Crossroads, Docks, Station, Backrooms, Dark Arena) works online: every map is registered from its Blender collision data, has clear
// spawns, hidden and open fighting spots and no open edge (except the Docks' lethal water); hits are decided by the server and walls hide the opponent.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, liveMatch, openPair, hiddenPair, stage, shoot, tp, sleep, CFG, S, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

const POOL = ['testarena', 'bridge', 'crossroads', 'docks', 'station', 'backrooms', 'darkarena'];

test('the online map pool is exactly Arena, Bridge, Crossroads, Docks, Station, Backrooms, Dark Arena (the old maps are retired)', () => {
  assert.deepStrictEqual(CFG.MAPS, POOL);
  for (const id of POOL) assert.ok(RV.maps[id], id + ' is registered (its mapdata file loaded)');
  for (const old of ['toybox', 'skybridge', 'pinwheel', 'vertigo']) assert.strictEqual(RV.maps[old], undefined, old + ' is no longer active');
  assert.deepStrictEqual(RV.mapOrder.filter((id) => POOL.includes(id)), POOL, 'menu order');
});

for (const id of POOL) {
  test('map ' + id + ': spawns are on the floor and clear of every solid, there are hidden and open spots, bounds are closed', () => {
    const map = RV.maps[id];
    assert.ok(map.modes.includes('online'), 'offered for online 1v1');
    assert.ok(map.spawns.length >= 6, 'enough spawns: ' + map.spawns.length);
    const world = S.worldFor(id);
    for (const sp of map.spawns) {
      assert.ok(!world.overlapsAny(sp.x, sp.y + 0.05, sp.z, 0.45, 1.85), 'spawn clear: ' + sp.x + ',' + sp.z);
      assert.ok(Math.abs(world.floorBelow(sp.x, sp.y + 0.5, sp.z, 0.3) - sp.y) < 0.05, 'spawn on the floor');
    }
    assert.ok(hiddenPair(id), 'the map has places that cannot see each other');
    assert.ok(openPair(id, 8), 'and places that can');
    // nobody can walk out of the map: from every spawn, a ring of rays 30 m out at chest height hits something or the kill plane is below
    const bd = world.bounds;
    for (const sp of map.spawns) {
      for (let a = 0; a < 6.28; a += 0.5) {
        const far = { x: sp.x + Math.cos(a) * 200, z: sp.z + Math.sin(a) * 200 };
        const blocked = !world.lineClear(sp.x, sp.y + 1.0, sp.z, far.x, sp.y + 1.0, far.z) || far.x < bd.minX || far.x > bd.maxX || far.z < bd.minZ || far.z > bd.maxZ;
        // (an open edge is only allowed where the map says falling kills: the Docks' water)
        if (!blocked) assert.ok(map.water, id + ' has an open edge from ' + sp.x + ',' + sp.z + ' at angle ' + a.toFixed(1));
      }
    }
  });
}

for (const id of POOL) {
  test('map ' + id + ': an invisible fence on the outer walls - spawns are inside it, and nothing can leave however fast it is launched', () => {
    const map = RV.maps[id];
    const world = S.worldFor(id);
    assert.ok(world.play, 'the map has a play box');
    for (const sp of map.spawns) assert.ok(world.inPlay(sp.x, sp.z, 0.5), 'spawn inside the fence: ' + sp.x + ',' + sp.z);
    for (const d of map.dummies || []) assert.ok(world.inPlay(d.x, d.z, 0.5), 'practice dummy inside the fence');
    // random players with extreme launches (far beyond what a grenade gives): none may end up outside the box
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pl = new RV.Player(world);
    for (let r = 0; r < 30; r++) {
      const sp = map.spawns[Math.floor(rnd() * map.spawns.length)];
      pl.reset(sp.x, sp.y, sp.z, rnd() * 6.28 - 3.14, 0);
      pl.djEnabled = r % 2 === 0;
      const cmd = { fwd: 1, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: true };
      for (let i = 0; i < 12 * 120; i++) {
        if (i % 90 === 0) {
          const a = rnd() * 6.28;
          pl.b.vx += Math.cos(a) * (10 + rnd() * 40);
          pl.b.vz += Math.sin(a) * (10 + rnd() * 40);
          pl.b.vy += 3 + rnd() * 12;
          pl.yaw += (rnd() - 0.5) * 3;
        }
        cmd.jumpPressed = rnd() < 0.05;
        cmd.jumpDown = cmd.jumpPressed;
        pl.step(RV.PHYS.STEP, cmd);
        const b = pl.b;
        assert.ok(world.inPlay(b.x, b.z, b.hw - 1e-6), id + ': inside the fence at (' + b.x.toFixed(2) + ',' + b.z.toFixed(2) + ') run ' + r + ' step ' + i);
        assert.ok(b.y > world.killY + 4 || map.water, id + ': did not fall out of the map');
      }
    }
  });
}

test('no push-out teleports: a body that brushes the side of a solid is not thrown to its far end or onto its top (Arena catwalk edge)', () => {
  const world = S.worldFor('testarena');
  const pl = new RV.Player(world);
  pl.reset(4.27, 1.83, 1.847, 0, 0); // under the catwalk (z -1.5..1.5, y 3.6..4.2), 3 mm inside its edge, head 3 cm into its underside
  const b = pl.b;
  b.h = 1.8;
  world.move(b, -0.012, -0.012, -0.0065);
  assert.ok(Math.hypot(b.x - 4.27, b.z - 1.847) < 0.1, 'moved sideways by ' + Math.hypot(b.x - 4.27, b.z - 1.847).toFixed(2) + ' m (was a 4 m + 20 m throw)');
  assert.ok(b.y < 2.5, 'not lifted onto the catwalk (y ' + b.y.toFixed(2) + ')');
});

for (const id of POOL) {
  test('map ' + id + ': random play (hops, slides, wall runs, grenade boosts) never teleports the body or leaves it inside a solid', () => {
    const map = RV.maps[id];
    const world = S.worldFor(id);
    const GW = RV.WEAPON_BY_ID.grenade;
    let seed = 31337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rr = (a, b) => a + (b - a) * rnd();
    const D = RV.PHYS.STEP;
    for (let r = 0; r < 24; r++) {
      const sp = map.spawns[Math.floor(rnd() * map.spawns.length)];
      const pl = new RV.Player(world);
      pl.reset(sp.x, sp.y, sp.z, rr(-3, 3), 0);
      pl.djEnabled = r % 2 === 0;
      const cmd = { fwd: 1, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: true };
      let turn = 0;
      for (let i = 0; i < 20 * 120; i++) {
        if (i % 40 === 0) {
          turn = rr(-3, 3);
          cmd.side = Math.floor(rr(-1.5, 1.5));
        }
        pl.yaw += turn * D;
        cmd.jumpPressed = rnd() < 0.04;
        cmd.jumpDown = cmd.jumpPressed || rnd() < 0.3;
        cmd.crouch = i % 50 < 20 && rnd() < 0.15;
        if (i % 400 === 399) RV.grensim.boost(world, pl, GW, pl.b.x + rr(-2, 2), pl.b.y - 0.1, pl.b.z + rr(-2, 2));
        const b = pl.b,
          x0 = b.x,
          y0 = b.y,
          z0 = b.z,
          v = Math.hypot(b.vx, b.vy, b.vz);
        pl.step(D, cmd);
        const d = Math.hypot(b.x - x0, b.y - y0, b.z - z0);
        assert.ok(d <= Math.max(0.6, (v + 30) * D + 0.02), id + ': a step moved the body ' + d.toFixed(2) + ' m (run ' + r + ', step ' + i + ', from ' + [x0, y0, z0].map((n) => n.toFixed(2)) + ')');
        assert.ok(!world.overlapsAny(b.x, b.y + 0.001, b.z, b.hw - 0.02, b.h - 0.02), id + ': inside a solid at ' + [b.x, b.y, b.z].map((n) => n.toFixed(2)));
        if (b.y < map.killY + 4) break; // fell out (the Docks' water): that is the round ending, not a teleport
      }
    }
  });
}

test('Arena: both ends are mirror images (every spawn has its point-mirrored partner, and the solids are 180-degree symmetric)', () => {
  const sp = RV.maps.testarena.spawns;
  assert.ok(sp.length >= 6 && sp.length % 2 === 0, 'an even number of spawns');
  for (const a of sp) {
    assert.ok(sp.some((b) => Math.abs(a.x + b.x) < 0.3 && Math.abs(a.z + b.z) < 0.3), 'spawn ' + a.x + ',' + a.z + ' has a mirror partner');
  }
  const world = S.worldFor('testarena');
  let n = 0,
    diff = 0;
  for (let x = -13.5; x < 14; x += 1.5) {
    for (let z = -21.5; z < 22; z += 1.5) {
      for (const y of [0.1, 1.6, 4.5]) {
        n++;
        if (world.overlapsAny(x, y, z, 0.2, 0.3) !== world.overlapsAny(-x, y, -z, 0.2, 0.3)) diff++;
      }
    }
  }
  assert.ok(diff / n < 0.01, 'the collision is point-symmetric (' + diff + ' of ' + n + ' samples differ)');
});

test('spawn rotation: a round never starts at the point the round before used, spawns vary, and the two players start far apart', () => {
  for (const id of CFG.MAPS) {
    const sp = RV.maps[id].spawns;
    const recent = [];
    let prev = null;
    const seen = new Set();
    for (let r = 0; r < 60; r++) {
      const [a, b] = RV.pickSpawnPair(sp, recent);
      assert.notStrictEqual(a, b, id + ': two different points');
      // (the partner comes from the far end, which on a map with only two or three points there may force a repeat: only `a` is free to rotate)
      if (prev) assert.ok(!prev.includes(a), id + ': round ' + r + ' started at a point of the previous round (' + [a, b] + ' vs ' + prev + ')');
      const d = (i, j) => Math.hypot(sp[i].x - sp[j].x, sp[i].z - sp[j].z, (sp[i].y - sp[j].y) * 0.5);
      let max = 0;
      for (let i = 0; i < sp.length; i++) if (i !== a) max = Math.max(max, d(a, i));
      assert.ok(d(a, b) >= max * 0.8 - 1e-9, id + ': the partner is from the far end');
      seen.add(a + ',' + b);
      prev = [a, b];
    }
    assert.ok(seen.size >= 3, id + ': several different pairs over 60 rounds (' + seen.size + ')');
  }
});

test('Docks: the water is lethal and not walkable (nothing under the surface to stand on, kill plane just below it)', () => {
  const map = RV.maps.docks;
  const world = S.worldFor('docks');
  assert.ok(map.water && map.killY > -10 && map.killY < map.water.y, 'kill plane is just below the water surface');
  assert.ok(world.floorBelow(0, 5, -30, 0.3) > -0.01, 'the central pier is walkable');
  assert.ok(!(world.floorBelow(10, 5, -30, 0.3) > map.killY), 'open water beside the pier has no floor above the kill plane');
});

test('Docks: stepping off the quay into the water costs the round (server-decided)', async () => {
  const old = CFG.MAPS.slice();
  CFG.MAPS.length = 0;
  CFG.MAPS.push('docks');
  try {
    const m = await liveMatch(srv);
    assert.strictEqual(m.map, 'docks');
    const pair = openPair(m.map, 8);
    await stage(m, m.ra, pair);
    m.b.clear();
    m.a.clear();
    tp(m.b, { x: 10, y: -6.2, z: -30 }, 0, 0, 0); // in the water, below the kill plane (-5.5) but above where any other map would kill (-30)
    await sleep(50);
    m.b.send({ t: 'in', rn: m.ra.n, q: 0, r: [[1, 0, 0, 0, 0, 0, 0]] });
    const hurt = await m.b.wait('hurt', null, 3000);
    assert.strictEqual(hurt.src, 'fall');
    assert.strictEqual((await m.a.wait('roundEnd')).w, 'you');
    m.a.close();
    m.b.close();
  } finally {
    CFG.MAPS.length = 0;
    for (const id of old) CFG.MAPS.push(id);
  }
});

test('a match on the Arena: server-decided hit, and the opponent behind the bars is not replicated', async () => {
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
