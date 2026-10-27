'use strict';
// The map vote: two players who have just been paired vote on the map (3 maps offered, 12 s, or as soon as both have voted) before the match loads.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, TestClient, sleep, CFG, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

/** Two connected clients that look at the vote themselves (no automatic vote), paired by the queue. */
async function pair(names) {
  const a = new TestClient(srv.url, (names && names[0]) || 'Alpha');
  const b = new TestClient(srv.url, (names && names[1]) || 'Bravo');
  a.autoVote = b.autoVote = false;
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [va, vb] = await Promise.all([a.wait('vote'), b.wait('vote')]);
  return { a, b, va, vb };
}

test('pairing opens a vote: both players get the same 3 different maps from the pool, the time, and the opponent name', async () => {
  const { a, b, va, vb } = await pair(['Alpha', 'Bravo']);
  assert.deepStrictEqual(va.opts, vb.opts, 'the same options');
  assert.strictEqual(va.opts.length, CFG.VOTE.OPTIONS);
  assert.strictEqual(new Set(va.opts).size, va.opts.length, 'all different');
  for (const id of va.opts) assert.ok(CFG.MAPS.includes(id) && RV.maps[id], id + ' is a map of the pool');
  assert.strictEqual(va.secs, CFG.VOTE.SECONDS);
  assert.strictEqual(va.opp, 'Bravo');
  assert.strictEqual(vb.opp, 'Alpha');
  assert.strictEqual(a.all('match').length, 0, 'the match does not start before the vote is over');
  a.close();
  b.close();
});

test('both vote the same map: that map is played, at once, and both are told', async () => {
  const { a, b, va } = await pair();
  const pick = va.opts[1];
  a.send({ t: 'vote', map: pick });
  b.send({ t: 'vote', map: pick });
  const [ma, mb, ea, eb] = await Promise.all([a.wait('match'), b.wait('match'), a.wait('voteend'), b.wait('voteend')]);
  assert.strictEqual(ma.map, pick);
  assert.strictEqual(mb.map, pick);
  assert.strictEqual(ea.map, pick);
  assert.strictEqual(eb.map, pick);
  a.close();
  b.close();
});

test('two different votes: one of the two voted maps is played (decided by chance), never the third', async () => {
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const { a, b, va } = await pair(['Alpha' + i, 'Bravo' + i]);
    a.send({ t: 'vote', map: va.opts[0] });
    b.send({ t: 'vote', map: va.opts[2] });
    const m = await a.wait('match');
    assert.ok(m.map === va.opts[0] || m.map === va.opts[2], 'played ' + m.map + ' of ' + va.opts.join(', '));
    seen.add(m.map === va.opts[0] ? 0 : 2);
    a.close();
    b.close();
    await sleep(30);
    if (seen.size === 2) break;
  }
  assert.strictEqual(seen.size, 2, 'both voted maps can come up (the tie is random)');
});

test('a vote can be changed until the vote closes, and each vote is counted for both players', async () => {
  const { a, b, va } = await pair();
  a.send({ t: 'vote', map: va.opts[0] });
  const t1 = await b.wait('votes');
  assert.strictEqual(t1.n[va.opts[0]], 1);
  a.send({ t: 'vote', map: va.opts[1] });
  const t2 = await b.wait('votes', (m) => m.n[va.opts[1]] === 1);
  assert.strictEqual(t2.n[va.opts[0]], 0, 'the first choice was taken back');
  assert.strictEqual(a.all('match').length, 0, 'one vote alone does not end the vote');
  b.send({ t: 'vote', map: va.opts[1] });
  assert.strictEqual((await a.wait('match')).map, va.opts[1]);
  a.close();
  b.close();
});

test('only one player votes: when time runs out that vote wins (the other did not mind)', async () => {
  const old = CFG.VOTE.SECONDS;
  CFG.VOTE.SECONDS = 0.8;
  try {
    const { a, b, va } = await pair();
    a.send({ t: 'vote', map: va.opts[2] });
    const m = await b.wait('match', null, 4000);
    assert.strictEqual(m.map, va.opts[2]);
    a.close();
    b.close();
  } finally {
    CFG.VOTE.SECONDS = old;
  }
});

test('nobody votes: when time runs out one of the offered maps is played', async () => {
  const old = CFG.VOTE.SECONDS;
  CFG.VOTE.SECONDS = 0.6;
  try {
    const { a, b, va } = await pair();
    const m = await a.wait('match', null, 4000);
    assert.ok(va.opts.includes(m.map), m.map + ' is one of ' + va.opts.join(', '));
    assert.strictEqual((await b.wait('match')).map, m.map, 'both get the same map');
    a.close();
    b.close();
  } finally {
    CFG.VOTE.SECONDS = old;
  }
});

test('a vote for a map that is not on offer is refused (and noted), the vote goes on', async () => {
  const { a, b, va } = await pair();
  const notOffered = CFG.MAPS.find((id) => !va.opts.includes(id));
  assert.ok(notOffered, 'the pool is bigger than the offer');
  a.send({ t: 'vote', map: notOffered });
  a.send({ t: 'vote', map: 'nonsense_map' });
  a.send({ t: 'vote', map: 42 }); // (the schema refuses it)
  await sleep(150);
  assert.strictEqual(a.all('votes').length, 0, 'nothing was counted');
  assert.strictEqual(a.all('match').length, 0);
  a.send({ t: 'vote', map: va.opts[0] });
  b.send({ t: 'vote', map: va.opts[0] });
  assert.strictEqual((await a.wait('match')).map, va.opts[0]);
  a.close();
  b.close();
});

test('one player leaves during the vote: the other is told and goes back to searching, first in line', async () => {
  const { a, b } = await pair();
  b.close();
  const c = await a.wait('votecancel');
  assert.strictEqual(c.why, 'left');
  await a.wait('queued');
  // a newcomer is paired with the one who was left waiting
  const n = new TestClient(srv.url, 'Newcomer');
  n.autoVote = false;
  await n.connect();
  n.send({ t: 'queue' });
  const [v1, v2] = await Promise.all([a.wait('vote'), n.wait('vote')]);
  assert.deepStrictEqual(v1.opts, v2.opts);
  a.close();
  n.close();
});

test('one player stops searching during the vote (unqueue): the other searches again; the one who left is idle', async () => {
  const { a, b } = await pair();
  b.send({ t: 'unqueue' });
  await b.wait('unqueued');
  await a.wait('votecancel');
  const q = await a.wait('queued');
  assert.ok(q.queued >= 1);
  a.close();
  b.close();
});

test('with the vote switched off the server picks the map at once, as before', async () => {
  CFG.VOTE.ENABLED = false;
  try {
    const a = new TestClient(srv.url, 'Alpha');
    const b = new TestClient(srv.url, 'Bravo');
    a.autoVote = b.autoVote = false;
    await a.connect();
    await b.connect();
    a.send({ t: 'queue' });
    b.send({ t: 'queue' });
    const [ma, mb] = await Promise.all([a.wait('match'), b.wait('match')]);
    assert.strictEqual(ma.map, mb.map);
    assert.ok(CFG.MAPS.includes(ma.map));
    assert.strictEqual(a.all('vote').length, 0);
    a.close();
    b.close();
  } finally {
    CFG.VOTE.ENABLED = true;
  }
});

test('a rematch keeps the map: there is no new vote after a match', async () => {
  // (the vote belongs to the pairing; the room itself never asks again)
  const { a, b, va } = await pair();
  a.send({ t: 'vote', map: va.opts[0] });
  b.send({ t: 'vote', map: va.opts[0] });
  await Promise.all([a.wait('match'), b.wait('match')]);
  assert.strictEqual(a.all('vote').length, 0);
  assert.strictEqual(b.all('vote').length, 0);
  a.close();
  b.close();
});

test('the instant grenade throw (G): a player with a grenade throws it with no pin and no weapon change; with none left nothing happens', async () => {
  const a = new TestClient(srv.url, 'Alpha');
  const b = new TestClient(srv.url, 'Bravo');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [ma] = await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  const [ra] = await Promise.all([a.wait('round'), b.wait('round')]);
  await a.wait('live', null, 8000);
  // the action message as the browser sends it: round, input sequence, action, weapon slot (the rifle: nothing was taken out)
  a.send({ t: 'act', rn: ra.n, q: 0, a: 'nadeq', s: 0 });
  const n = await a.wait('nade', null, 3000);
  assert.strictEqual(n.own, true);
  assert.ok(Array.isArray(n.p) && Array.isArray(n.v));
  a.send({ t: 'act', rn: ra.n, q: 0, a: 'nadeq', s: 0 }); // the stock is empty now
  await sleep(300);
  assert.strictEqual(a.all('nade').length, 0, 'no second grenade');
  a.close();
  b.close();
  void ma;
});
