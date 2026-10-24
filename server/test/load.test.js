'use strict';
// Scale check: many matches at once, every player sending real input at the real rate. Measures what the SERVER spends
// (time inside the room code, by instrumenting it) and what each player receives, and checks nothing goes wrong
// (no corrections for honest play, every match keeps ticking, rooms stay isolated).
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { performance } = require('perf_hooks');
const { startServer, TestClient, SimClient, sleep, CFG, S, RV } = require('./helpers');
const log = require('../log');
const { Room } = require('../room');

const ROOMS = +process.env.LOAD_ROOMS || 16;

test(ROOMS + ' simultaneous matches: server cost per second and bandwidth per player', async () => {
  log.setLevel('quiet');
  const srv = await startServer();
  CFG.MAX_PER_IP = 1000;
  CFG.MAX_CONNECTIONS = 1000;
  // time spent inside the room code
  const spent = { tick: 0, input: 0, ticks: 0, inputs: 0 };
  const wrap = (name, key, countKey) => {
    const orig = Room.prototype[name];
    Room.prototype[name] = function (...a) {
      const t0 = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        spent[key] += performance.now() - t0;
        spent[countKey]++;
      }
    };
    return () => (Room.prototype[name] = orig);
  };
  const undo = [wrap('tick', 'tick', 'ticks'), wrap('onInput', 'input', 'inputs')];
  try {
    const pairs = [];
    for (let i = 0; i < ROOMS; i++) {
      const a = new TestClient(srv.url, 'LoadA' + i),
        b = new TestClient(srv.url, 'LoadB' + i);
      await a.connect();
      await b.connect();
      a.send({ t: 'queue' });
      await a.wait('queued');
      b.send({ t: 'queue' });
      await Promise.all([a.wait('match'), b.wait('match')]);
      pairs.push({ a, b });
    }
    for (const p of pairs) {
      p.a.send({ t: 'ready' });
      p.b.send({ t: 'ready' });
    }
    const rounds = await Promise.all(pairs.map((p) => Promise.all([p.a.wait('round'), p.b.wait('round')])));
    await Promise.all(pairs.flatMap((p) => [p.a.wait('live', null, 8000), p.b.wait('live', null, 8000)]));
    // every player is a prediction client (same physics), keyed to its own room's map
    const all = [];
    for (let i = 0; i < pairs.length; i++) {
      const room = [...srv.lobby.rooms][i];
      all.push(new SimClient(pairs[i].a, room.mapId, rounds[i][0].you, rounds[i][0].n));
      all.push(new SimClient(pairs[i].b, room.mapId, rounds[i][1].you, rounds[i][1].n));
    }
    for (const p of pairs) {
      p.a.clear();
      p.b.clear();
      p.a.bytes = p.b.bytes = 0;
    }
    spent.tick = spent.input = spent.ticks = spent.inputs = 0;
    const DUR = 6;
    const t0 = performance.now();
    let n = 0;
    while ((performance.now() - t0) / 1000 < DUR) {
      n++;
      for (const sim of all) {
        const yaw = Math.sin(n * 0.05 + all.indexOf(sim)) * 1.5;
        sim.step(4, { fw: 1, sd: n % 40 < 20 ? 1 : 0, sprint: true, jump: n % 18 === 0, yaw, pitch: 0 });
        sim.flush();
      }
      await sleep(33);
      for (const sim of all) sim.pump();
    }
    const secs = (performance.now() - t0) / 1000;
    const bytes = pairs.flatMap((p) => [p.a.bytes, p.b.bytes]);
    const avgKBs = bytes.reduce((s, x) => s + x, 0) / bytes.length / secs / 1024;
    const fixes = all.reduce((s, x) => s + x.fixes, 0);
    const serverMs = spent.tick + spent.input;
    const usage = serverMs / (secs * 1000);
    console.log('LOAD ' + ROOMS + ' rooms, ' + all.length + ' players, ' + secs.toFixed(1) + ' s: server busy ' + (usage * 100).toFixed(1) + '% of one core (' + (spent.tick / spent.ticks).toFixed(3) + ' ms per room-tick, ' + (spent.input / spent.inputs).toFixed(3) + ' ms per input batch), ' + avgKBs.toFixed(1) + ' KB/s down per player, corrections: ' + fixes);
    assert.ok(usage < 0.6, 'server uses ' + (usage * 100).toFixed(1) + '% of a core');
    assert.ok(avgKBs < 40, 'bandwidth per player ' + avgKBs.toFixed(1) + ' KB/s');
    assert.ok(fixes <= all.length, 'honest players are (almost) never corrected: ' + fixes + ' corrections for ' + all.length + ' players');
    // every match kept simulating: the server is never more than a moment behind what each client sent
    await sleep(600);
    const rooms = [...srv.lobby.rooms];
    rooms.forEach((r, i) => {
      for (const [k, sim] of [all[i * 2], all[i * 2 + 1]].entries()) {
        const p = r.p[k];
        assert.ok(p.seqDone > 300 && p.seqDone >= sim.sent - 80, 'room ' + r.id + ' player ' + k + ': server ran ' + p.seqDone + ' of ' + sim.sent + ' steps');
      }
    });
    for (const p of pairs) {
      p.a.close();
      p.b.close();
    }
  } finally {
    for (const u of undo) u();
    await srv.stop();
  }
});
