'use strict';
process.env.TEST_MODE = '1'; // (the debug message lets a test read the server's own position)
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, TestClient, dbg, sleep, CFG, S, RV } = require('./helpers');
const { originAllowed } = require('../server');
const { cleanName } = require('../lobby');

let srv;
test.before(async () => {
  srv = await startServer();
});
test.after(async () => {
  await srv.stop();
});

test('health endpoint answers with status and counts, no secrets', async () => {
  const r = await fetch(srv.http + '/health');
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.protocol, CFG.PROTOCOL);
  assert.ok('online' in j && 'queued' in j && 'rooms' in j);
  assert.ok(!/key|secret|token|password/i.test(JSON.stringify(j)));
});

test('handshake: welcome echoes a cleaned username and server settings', async () => {
  const c = new TestClient(srv.url, '  <b>Bad</b>   Name!!  ');
  const w = await c.connect();
  assert.strictEqual(w.name, 'bBadb Name', 'tags and punctuation are stripped, spaces collapsed');
  assert.match(w.name, /^[A-Za-z0-9_\- ]{3,16}$/);
  assert.strictEqual(w.tick, CFG.TICK_HZ);
  c.close();
});

test('too-short or empty names get a generated one; names are capped at 16', async () => {
  assert.match(cleanName('ab'), /^Player\d{3}$/);
  assert.match(cleanName(''), /^Player\d{3}$/);
  assert.strictEqual(cleanName('x'.repeat(40)).length, 16);
  assert.strictEqual(cleanName('Good_Name-1'), 'Good_Name-1');
});

test('a client speaking another protocol version is refused', async () => {
  const c = new TestClient(srv.url, 'Old');
  await c.connect({ hello: false });
  c.send({ t: 'hello', v: 999, name: 'Old' });
  const e = await c.wait('err');
  assert.strictEqual(e.code, 'version');
  await sleep(700);
  assert.ok(c.closed);
});

test('a client that never says hello is dropped', async () => {
  const c = new TestClient(srv.url, 'Silent');
  await c.connect({ hello: false });
  await sleep(9500);
  assert.ok(c.closed, 'connection should be closed after the handshake timeout');
});

test('origin policy: localhost / file:// by default, an explicit list in production', () => {
  const saved = CFG.ALLOWED_ORIGINS.slice();
  CFG.ALLOWED_ORIGINS.length = 0;
  assert.ok(originAllowed(undefined));
  assert.ok(originAllowed('null'));
  assert.ok(originAllowed('http://localhost:5173'));
  assert.ok(!originAllowed('https://evil.example'));
  CFG.ALLOWED_ORIGINS.push('https://mygame.netlify.app');
  assert.ok(originAllowed('https://mygame.netlify.app'));
  assert.ok(originAllowed('https://mygame.netlify.app/'));
  assert.ok(!originAllowed('https://evil.example'));
  assert.ok(!originAllowed(undefined));
  assert.ok(originAllowed('http://192.168.1.20:8787', '192.168.1.20:8787'), 'a page served by this server may always connect');
  assert.ok(!originAllowed('https://evil.example', '192.168.1.20:8787'));
  assert.ok(!originAllowed('not a url', 'evil.example'));
  CFG.ALLOWED_ORIGINS.length = 0;
  CFG.ALLOWED_ORIGINS.push('*');
  assert.ok(originAllowed('https://anything.example'));
  CFG.ALLOWED_ORIGINS.length = 0;
  for (const o of saved) CFG.ALLOWED_ORIGINS.push(o);
});

test('matchmaking: two queued players are paired into one room, a third waits', async () => {
  const a = new TestClient(srv.url, 'MatchA'),
    b = new TestClient(srv.url, 'MatchB'),
    c = new TestClient(srv.url, 'MatchC');
  await a.connect();
  await b.connect();
  await c.connect();
  a.send({ t: 'queue' });
  const qa = await a.wait('queued');
  assert.ok(qa.queued >= 1);
  b.send({ t: 'queue' });
  const [ma, mb] = await Promise.all([a.wait('match'), b.wait('match')]);
  assert.strictEqual(ma.room, mb.room);
  assert.notStrictEqual(ma.seat, mb.seat);
  assert.strictEqual(ma.map, mb.map);
  assert.ok(CFG.MAPS.includes(ma.map));
  assert.strictEqual(ma.opp, 'MatchB');
  assert.strictEqual(mb.opp, 'MatchA');
  assert.strictEqual(ma.to, 5);
  c.send({ t: 'queue' });
  await c.wait('queued');
  await sleep(400);
  assert.strictEqual(c.all('match').length, 0, 'a lone third player must keep waiting');
  c.send({ t: 'unqueue' });
  await c.wait('unqueued');
  a.close();
  b.close();
  c.close();
});

test('a cancelled player is never matched', async () => {
  const a = new TestClient(srv.url, 'Quitter'),
    b = new TestClient(srv.url, 'Stayer');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  await a.wait('queued');
  a.send({ t: 'unqueue' });
  await a.wait('unqueued');
  b.send({ t: 'queue' });
  await b.wait('queued');
  await sleep(500);
  assert.strictEqual(b.all('match').length, 0);
  b.close();
  a.close();
});

test('rooms are isolated: two simultaneous matches never see each other', async () => {
  const names = ['R1a', 'R1b', 'R2a', 'R2b'];
  const cs = names.map((n) => new TestClient(srv.url, n));
  for (const c of cs) await c.connect();
  cs[0].send({ t: 'queue' });
  cs[1].send({ t: 'queue' });
  const [m0, m1] = await Promise.all([cs[0].wait('match'), cs[1].wait('match')]);
  cs[2].send({ t: 'queue' });
  cs[3].send({ t: 'queue' });
  const [m2, m3] = await Promise.all([cs[2].wait('match'), cs[3].wait('match')]);
  assert.strictEqual(m0.room, m1.room);
  assert.strictEqual(m2.room, m3.room);
  assert.notStrictEqual(m0.room, m2.room);
  assert.strictEqual(m0.opp, 'R1b');
  assert.strictEqual(m2.opp, 'R2b');
  for (const c of cs) c.send({ t: 'ready' });
  await Promise.all(cs.map((c) => c.wait('round')));
  for (const c of cs) {
    const snap = await c.wait('snap');
    assert.ok(snap.o, 'every player receives a snapshot about its own room');
    assert.strictEqual(snap.rn, 1);
  }
  // a shot fired in room 1 is heard only in room 1
  cs[2].clear();
  cs[3].clear();
  await sleep(100);
  assert.strictEqual(cs[2].all('fx').length + cs[3].all('fx').length, 0, 'nothing from the other room arrives');
  for (const c of cs) c.close();
  await sleep(200);
});

test('round start: separate spawns, a real 3 second locked countdown, then live', async () => {
  const a = new TestClient(srv.url, 'CdA'),
    b = new TestClient(srv.url, 'CdB');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [ma] = await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  const [ra, rb] = await Promise.all([a.wait('round'), b.wait('round')]);
  const t0 = ra._at;
  assert.strictEqual(ra.n, 1);
  assert.strictEqual(ra.cd, 3);
  assert.notStrictEqual(ra.you, ra.opp, 'players spawn on different spawn points');
  assert.notStrictEqual(ra.you, rb.you, 'each player has their own spawn');
  assert.strictEqual(ra.opp, undefined, 'the opponent spawn is not disclosed');
  const map = RV.maps[ma.map];
  const spA = map.spawns[ra.you];
  // input during the countdown is ignored: the player stays in the spawn
  a.send({ t: 'in', rn: ra.n, q: 0, r: [[20, 1, 0, 8, 0, 0, 0]] });
  await sleep(300);
  const da = await dbg(a);
  assert.ok(Math.hypot(da.x - spA.x, da.z - spA.z) < 0.01 && da.a === 0, 'a countdown move must not be applied');
  assert.strictEqual(b.last('snap').ph, 1, 'phase is countdown');
  const live = await a.wait('live', null, 6000);
  const dt = live._at - t0;
  assert.ok(dt > 2800 && dt < 3600, 'countdown lasts about 3 s, was ' + dt);
  await sleep(150);
  assert.strictEqual(a.last('snap').ph, 2, 'phase is live');
  a.close();
  b.close();
});

test('leaving during the loading screen cancels the match for the other player', async () => {
  const a = new TestClient(srv.url, 'LdA'),
    b = new TestClient(srv.url, 'LdB');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  await Promise.all([a.wait('match'), b.wait('match')]);
  a.close();
  const end = await b.wait('matchEnd');
  assert.strictEqual(end.w, 'none');
  assert.match(end.reason, /before the start/);
  b.close();
});

test('a player who never finishes loading times the match out', async () => {
  const old = CFG.LOADING_TIMEOUT;
  CFG.LOADING_TIMEOUT = 1.2;
  const a = new TestClient(srv.url, 'TmA'),
    b = new TestClient(srv.url, 'TmB');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' }); // b never does
  const end = await a.wait('matchEnd', null, 5000);
  assert.strictEqual(end.w, 'none');
  CFG.LOADING_TIMEOUT = old;
  a.close();
  b.close();
});

test('after a match ends both players are free to queue again', async () => {
  const a = new TestClient(srv.url, 'ReA'),
    b = new TestClient(srv.url, 'ReB');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'leave' });
  await b.wait('matchEnd');
  await sleep(100);
  b.send({ t: 'queue' });
  const q = await b.wait('queued');
  assert.ok(q);
  a.send({ t: 'queue' });
  const [m1] = await Promise.all([a.wait('match'), b.wait('match')]);
  assert.ok(m1.room);
  a.close();
  b.close();
});
