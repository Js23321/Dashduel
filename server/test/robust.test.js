'use strict';
// A bug in the game code that one client's message (or one pairing) happens to reach must cost that message, never the server:
// every other match on it keeps running.
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, TestClient, sleep, CFG } = require('./helpers');
const { Room } = require('../room');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
});
test.after(async () => {
  await srv.stop();
});

test('an exception inside a message handler is logged and ignored: the server keeps running and the player stays connected', async () => {
  const a = new TestClient(srv.url, 'Alpha');
  const b = new TestClient(srv.url, 'Bravo');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  await Promise.all([a.wait('match'), b.wait('match')]);
  const orig = Room.prototype.onMessage;
  const before = srv.lobby.totals.errors || 0;
  Room.prototype.onMessage = function () {
    throw new Error('test: a bug in the room');
  };
  try {
    a.send({ t: 'ready' });
    await sleep(200);
  } finally {
    Room.prototype.onMessage = orig;
  }
  assert.strictEqual(srv.lobby.totals.errors, before + 1, 'the error was counted');
  assert.strictEqual(a.closed, null, 'the connection was not dropped');
  // the server and the match are fine: a ping is answered and the match starts as usual
  a.send({ t: 'ping', ts: 7 });
  assert.strictEqual((await a.wait('pong', null, 2000)).ts, 7);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  await Promise.all([a.wait('round'), b.wait('round')]);
  a.close();
  b.close();
});

test('a match that cannot be created: both players get a plain error and can search again', async () => {
  const lobby = srv.lobby;
  const orig = Room.prototype.announce;
  const before = lobby.totals.errors || 0;
  const roomsBefore = lobby.rooms.size; // (the match of the test above may still be waiting for its dropped players)
  Room.prototype.announce = function () {
    throw new Error('test: the room cannot be set up');
  };
  const a = new TestClient(srv.url, 'Alpha');
  const b = new TestClient(srv.url, 'Bravo');
  try {
    await a.connect();
    await b.connect();
    a.send({ t: 'queue' });
    b.send({ t: 'queue' });
    const [ea, eb] = await Promise.all([a.wait('err', (m) => m.code === 'server', 4000), b.wait('err', (m) => m.code === 'server', 4000)]);
    assert.ok(ea.msg && eb.msg, 'both are told, in plain words');
    assert.ok(!/test:|Error|at /.test(ea.msg), 'no internals');
  } finally {
    Room.prototype.announce = orig;
  }
  assert.ok((lobby.totals.errors || 0) > before, 'logged and counted');
  assert.strictEqual(lobby.rooms.size, roomsBefore, 'no half-made room is left behind');
  // both are idle again and can search; the server is fine
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [m1, m2] = await Promise.all([a.wait('match', null, 4000), b.wait('match', null, 4000)]);
  assert.strictEqual(m1.map, m2.map);
  a.close();
  b.close();
});
