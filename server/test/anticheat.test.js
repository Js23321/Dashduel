'use strict';
// These tests play the part of a cheater / broken client against the real server: fabricated results, made-up damage,
// shooting too fast or while dead, spoofed identities, malformed and abusive traffic. (Movement cheats are in movement.test.js.)
process.env.TEST_MODE = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const crypto = require('crypto');
const { startServer, liveMatch, TestClient, openPair, stage, shoot, dbg, sleep, CFG, S, RV } = require('./helpers');
const ac = require('../anticheat');
const log = require('../log');
const seen = (rule) => ac.snapshot().rules.find((r) => r.rule === rule).seen;

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 500;
  CFG.AC.LOCKOUT_S = 0;
  log.setLevel('quiet');
});
test.after(async () => {
  await srv.stop();
});

test('a client cannot award itself anything: results, damage, kills and score messages are not accepted', async () => {
  const m = await liveMatch(srv);
  m.b.clear();
  m.a.clear();
  const bad0 = seen('bad_message');
  const fakes = [
    { t: 'hurt', dmg: 150, hp: 0 },
    { t: 'hit', dmg: 150, kill: true },
    { t: 'roundEnd', w: 'you', sc: [5, 0], over: true },
    { t: 'matchEnd', w: 'you', sc: [5, 0] },
    { t: 'snap', hp: 150, sc: [5, 0] },
    { t: 'dmg', dmg: 999 },
    { t: 'kill', who: 'opp' },
    { t: 'score', you: 5 },
    { t: 'boom', own: false, p: [0, 0, 0] },
    { t: 'nade', own: true, p: [0, 0, 0] },
    { t: 'welcome', name: 'Hacker' },
    { t: 'match', room: 99 },
    { t: 'admin', cmd: 'win' },
    { t: 'kick', who: 'opp' },
    { t: 'setHealth', hp: 1 },
    { t: 'fix', st: [] },
  ];
  for (const f of fakes) m.a.send(f);
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 0);
  assert.strictEqual(m.b.all('roundEnd').length, 0);
  assert.strictEqual(m.b.all('matchEnd').length, 0);
  assert.strictEqual(m.b.last('snap').hp, 150);
  assert.deepStrictEqual(m.b.last('snap').sc, [0, 0]);
  assert.strictEqual(m.a.last('snap').hp, 150);
  assert.ok(seen('bad_message') - bad0 >= fakes.length - 1, 'every one of them was recorded as a violation');
  m.a.close();
  m.b.close();
});

test('extra fields on a valid request are discarded: damage is always what the server computes', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  sa.step(12, {});
  sa.flush();
  // a fire request that also "claims" a kill, 999 damage, a target and a score
  m.a.send({ t: 'act', rn: sa.round, q: sa.sent, a: 'fire', s: 0, dmg: 999, damage: 999, kill: true, target: 'opp', victim: 1, hp: 0, score: [5, 0], seat: 1, id: 'x', ammo: 999 });
  const hurt = await m.b.wait('hurt', null, 2000);
  assert.strictEqual(hurt.dmg, 12, 'the damage is the rifle damage, whatever the client wrote');
  assert.strictEqual(hurt.hp, 138);
  await sleep(150);
  assert.strictEqual(m.a.last('snap').am, 19, 'one round used; the claimed ammo is ignored');
  assert.deepStrictEqual(m.a.last('snap').sc, [0, 0]);
  m.a.close();
  m.b.close();
});

test('a dead player cannot shoot, and trying is recorded', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  for (let i = 0; i < 13; i++) shoot(sa);
  await m.b.wait('roundEnd', null, 4000);
  m.a.clear();
  const dead0 = seen('fire_dead');
  // B is dead: it sends fire requests anyway
  for (let i = 0; i < 4; i++) m.b.send({ t: 'act', rn: m.ra.n, q: 0, a: 'fire', s: 0 });
  await sleep(300);
  assert.strictEqual(m.a.all('hurt').length, 0, 'a dead player deals no damage');
  assert.ok(seen('fire_dead') - dead0 >= 4, 'and it is recorded');
  m.a.close();
  m.b.close();
});

test('invalid ammunition and reloads: an empty magazine does not shoot, a full one does not "reload"', async () => {
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  const r0 = seen('reload_invalid');
  sa.step(12, {});
  sa.act('reload'); // magazine is full
  await sleep(300);
  assert.ok(seen('reload_invalid') > r0, 'a pointless reload is recorded');
  assert.strictEqual(m.a.last('snap').am, 20);
  // fists / grenade have no magazine at all
  sa.step(1, { slot: 2 });
  sa.act('reload');
  await sleep(200);
  assert.strictEqual(m.a.last('snap').am, 0, 'fists have no ammunition counter');
  m.a.close();
  m.b.close();
});

test('the server never takes a field from the client as truth: identity, seat and state fields are dropped', async () => {
  const m = await liveMatch(srv);
  m.a.clear();
  m.b.clear();
  // A pretends to be B (seat / id / session fields), and tries to move B
  m.a.send({ t: 'in', rn: m.ra.n, q: 0, r: [[10, 1, 0, 8, 0, 0, 0]], seat: 1, id: 'someone', sid: 'someone', session: 'x', c: [0, 0, 0, 0] });
  await sleep(400);
  const db = await dbg(m.b);
  const da = await dbg(m.a);
  assert.strictEqual(db.a, 0, "B's simulation did not advance: A cannot act as B");
  assert.ok(da.a >= 10, 'A moved A');
  // a message without a session cannot do anything either
  const stranger = new TestClient(srv.url, 'Stranger');
  await stranger.connect();
  stranger.send({ t: 'in', rn: m.ra.n, q: 0, r: [[10, 1, 0, 8, 0, 0, 0]] });
  stranger.send({ t: 'act', rn: m.ra.n, q: 0, a: 'fire', s: 0 });
  await sleep(300);
  assert.strictEqual((await dbg(m.b)).a, 0, 'someone outside the room cannot reach into it');
  stranger.close();
  m.a.close();
  m.b.close();
});

test('a forged or foreign session token never attaches to anyone else: it just creates a new session', async () => {
  const real = new TestClient(srv.url, 'Real');
  const w = await real.connect();
  assert.ok(w.tok && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(w.tok), 'the first connection receives a signed token');
  const forged = new TestClient(srv.url, 'Forger');
  await forged.connect({ hello: false });
  const sid = w.tok.split('.')[0];
  forged.send({ t: 'hello', v: CFG.PROTOCOL, name: 'Forger', tok: sid + '.' + 'A'.repeat(22) });
  const w2 = await forged.wait('welcome');
  assert.strictEqual(w2.resumed, false);
  assert.notStrictEqual(w2.id, w.id, 'a bad signature gives a brand new identity, not the target');
  assert.ok(!real.closed, 'and the real session is untouched');
  real.close();
  forged.close();
});

test('the opponent never receives your token, session id, address or any private state', async () => {
  const m = await liveMatch(srv);
  const all = JSON.stringify([...m.b.msgs, m.mb, m.rb]);
  assert.ok(!/tok|secret|127\.0\.0\.1|"id"/i.test(all), 'nothing identifying in what B was told about A');
  m.a.close();
  m.b.close();
});

test('violations add up, decay, warn and finally kick with a temporary lockout (never a permanent ban)', async () => {
  const oldDecay = CFG.AC.DECAY_PER_S,
    oldLock = CFG.AC.LOCKOUT_S;
  CFG.AC.DECAY_PER_S = 20;
  const who = { sid: 'unit-test-1', ip: '10.9.9.9' };
  assert.strictEqual(ac.record(who, 'fire_rate'), 'none', 'one slip is nothing');
  await sleep(300);
  CFG.AC.DECAY_PER_S = 0.0001;
  let verdict = 'none',
    n = 0;
  while (verdict !== 'kick' && n++ < 100) verdict = ac.record(who, 'fire_no_ammo');
  assert.strictEqual(verdict, 'kick', 'sustained violations end in a kick');
  CFG.AC.LOCKOUT_S = 1;
  assert.strictEqual(ac.lockedFor('unit-test-1', '10.9.9.9'), 0, 'the lockout configured at kick time (0 s here) already ended');
  // severe events kick quickly on their own
  const w2 = { sid: 'unit-test-2', ip: '10.9.9.8' };
  const v = [ac.record(w2, 'seq_gap'), ac.record(w2, 'seq_gap'), ac.record(w2, 'seq_gap')];
  assert.strictEqual(v[2], 'kick', 'three severe events inside a minute');
  CFG.AC.DECAY_PER_S = oldDecay;
  CFG.AC.LOCKOUT_S = oldLock;
});

test('a kicked session cannot queue again for the lockout time, then it can (temporary, not permanent)', async () => {
  const oldLock = CFG.AC.LOCKOUT_S;
  CFG.AC.LOCKOUT_S = 1.5;
  const c = new TestClient(srv.url, 'Lockee');
  const w = await c.connect();
  const verdicts = [1, 2, 3].map(() => ac.record({ sid: w.id, ip: '127.0.0.1' }, 'seq_gap')); // three severe events: kick
  assert.strictEqual(verdicts[2], 'kick');
  c.close();
  await sleep(100);
  const blocked = new TestClient(srv.url, 'Lockee2');
  await blocked.connect({ hello: false });
  blocked.send({ t: 'hello', v: CFG.PROTOCOL, name: 'Lockee2' });
  const err = await blocked.wait('err', null, 2000);
  assert.strictEqual(err.code, 'locked');
  await sleep(1700);
  const ok = new TestClient(srv.url, 'Lockee3');
  const w3 = await ok.connect();
  assert.ok(w3.id, 'after the lockout the address is welcome again');
  ok.close();
  CFG.AC.LOCKOUT_S = oldLock;
});

test('match telemetry is logged at the end of a match and flags are advisory (rule ids, no secrets)', async () => {
  log.clear();
  const m = await liveMatch(srv);
  const pair = openPair(m.map, 8);
  const sa = await stage(m, m.ra, pair);
  for (let i = 0; i < 13; i++) shoot(sa);
  await m.a.wait('roundEnd', null, 4000);
  m.a.send({ t: 'leave' });
  await sleep(300);
  assert.ok(log.counters().match_end >= 1, 'a match_end record was written');
  assert.ok(!JSON.stringify(log.recent(500)).match(/tok":|secret/i), 'no tokens or secrets in the security log');
  m.a.close();
  m.b.close();
});

// ---------------------------------------------------------------------------------------------
// transport and protocol abuse
// ---------------------------------------------------------------------------------------------
test('garbage input never crashes the server: bad JSON, wrong types, huge numbers, repeated hello', async () => {
  const c = new TestClient(srv.url, 'Garbage');
  await c.connect();
  for (const g of ['{', '[]', 'null', '123', '"x"', '{"t":5}', '{"t":"in","rn":"a"}', '{"t":"queue"}'.repeat(2), '\u0000\u0001', '{"t":"hello","v":1,"name":{"a":1}}']) c.send(g);
  await sleep(300);
  assert.ok(!c.closed, 'a few bad messages are tolerated');
  c.send({ t: 'ping', ts: 5 });
  assert.strictEqual((await c.wait('pong')).ts, 5, 'and the connection still works');
  const health = await (await fetch(srv.http + '/health')).json();
  assert.strictEqual(health.ok, true);
  c.close();
});

test('malformed input and action messages are refused by the schema (types, ranges, lengths)', async () => {
  const m = await liveMatch(srv);
  const bad0 = seen('bad_message');
  const run = [4, 1, 0, 8, 0, 0, 0];
  const bads = [
    { t: 'in', rn: m.ra.n, q: 0, r: [[0, 1, 0, 8, 0, 0, 0]] }, // zero steps
    { t: 'in', rn: m.ra.n, q: 0, r: [[999, 1, 0, 8, 0, 0, 0]] }, // run too long
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 2, 0, 8, 0, 0, 0]] }, // forward = 2: not a key state
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 99, 0, 0, 0]] }, // flags out of range
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 8, 'x', 0, 0]] }, // yaw is not a number
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 8, 99, 0, 0]] }, // yaw out of range
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 8, 0, 5, 0]] }, // pitch out of range
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 8, 0, 0, 9]] }, // no such weapon slot
    { t: 'in', rn: m.ra.n, q: 0, r: [[4, 1, 0, 8, NaN, 0, 0]] }, // NaN
    { t: 'in', rn: m.ra.n, q: -5, r: [run] }, // negative sequence
    { t: 'in', rn: m.ra.n, q: 0, r: [] }, // nothing
    { t: 'in', rn: m.ra.n, q: 0, r: new Array(40).fill(run) }, // too many runs
    { t: 'in', rn: m.ra.n, q: 0, r: [run], c: [1, 2] }, // bad claim
    { t: 'act', rn: m.ra.n, q: 0, a: 'teleport', s: 0 }, // unknown action
    { t: 'act', rn: m.ra.n, q: 0, a: 'fire', s: 7 }, // unknown slot
    { t: 'act', rn: 'x', q: 0, a: 'fire', s: 0 },
    { t: 'act', a: 'fire' },
  ];
  for (const b of bads) m.a.send(b);
  await sleep(500);
  assert.ok(seen('bad_message') - bad0 >= bads.length - 2, 'refused and recorded');
  assert.strictEqual((await dbg(m.a)).a, 0, 'none of them moved or shot anything');
  m.a.close();
  m.b.close();
});

test('message flooding gets the connection dropped without hurting other players', async () => {
  const flood = new TestClient(srv.url, 'Flooder'),
    calm = new TestClient(srv.url, 'Calm');
  await flood.connect();
  await calm.connect();
  for (let i = 0; i < 1500; i++) flood.send({ t: 'ping', ts: i });
  await sleep(600);
  assert.ok(flood.closed && flood.closed.code === 1008, 'flooder kicked, got ' + JSON.stringify(flood.closed));
  calm.send({ t: 'ping', ts: 1 });
  assert.ok(await calm.wait('pong'), 'other players are unaffected');
  calm.close();
});

test('an oversized message closes the connection (1009)', async () => {
  const c = new TestClient(srv.url, 'Big');
  await c.connect();
  c.send(JSON.stringify({ t: 'hello', pad: 'x'.repeat(CFG.MAX_MESSAGE + 500) }));
  await sleep(900);
  assert.ok(c.closed, 'closed');
  assert.strictEqual(c.closed.code, 1009);
});

test('too many sockets from one address are refused', async () => {
  const old = CFG.MAX_PER_IP;
  for (let i = 0; i < 60 && srv.lobby.perIp.get('127.0.0.1'); i++) await sleep(100); // let earlier tests' sockets drain
  CFG.MAX_PER_IP = 3;
  const cs = [];
  try {
    for (let i = 0; i < 3; i++) {
      const c = new TestClient(srv.url, 'Ip' + i);
      await c.connect();
      cs.push(c);
    }
    const extra = new TestClient(srv.url, 'IpExtra');
    await assert.rejects(() => extra.connect(), /connect failed/);
  } finally {
    for (const c of cs) c.close();
    await sleep(300);
    CFG.MAX_PER_IP = old;
  }
});

test('queueing twice or before saying hello is harmless', async () => {
  const early = new TestClient(srv.url, 'Early');
  await early.connect({ hello: false });
  early.send({ t: 'queue' });
  await sleep(200);
  assert.strictEqual(early.all('queued').length, 0, 'queueing before hello does nothing');
  early.send({ t: 'hello', v: CFG.PROTOCOL, name: 'Early' });
  await early.wait('welcome');
  early.send({ t: 'queue' });
  early.send({ t: 'queue' });
  early.send({ t: 'queue' });
  await sleep(300);
  assert.strictEqual(early.all('queued').length, 1, 'only one queue entry');
  early.close();
});

test('plain ws:// can be refused (REQUIRE_TLS) unless a trusted proxy says the client used https', async () => {
  const old = [CFG.REQUIRE_TLS, CFG.TRUST_PROXY];
  try {
  CFG.REQUIRE_TLS = true;
  CFG.TRUST_PROXY = false;
  const refused = await new Promise((resolve) => {
    const sock = net.connect(srv.port, '127.0.0.1');
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('close', () => resolve(data));
    sock.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  assert.match(refused, /426/, 'plain ws:// refused');
  CFG.TRUST_PROXY = true;
  const viaProxy = await new Promise((resolve) => {
    const sock = net.connect(srv.port, '127.0.0.1');
    let data = '';
    sock.on('data', (d) => {
      data += d;
      if (data.includes('\r\n\r\n')) {
        resolve(data);
        sock.destroy();
      }
    });
    sock.write('GET /ws HTTP/1.1\r\nHost: x\r\nX-Forwarded-Proto: https\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  assert.match(viaProxy, /101/, 'accepted when the proxy terminated TLS');
  } finally {
    [CFG.REQUIRE_TLS, CFG.TRUST_PROXY] = old;
  }
});

test('the debug endpoints are off by default; when on they need local access or the admin token and expose no secrets', async () => {
  const get = (path, headers) => fetch(srv.http + path, { headers: headers || {} });
  assert.strictEqual((await get('/debug/anticheat')).status, 404, 'off by default');
  const old = [CFG.DEBUG_ENDPOINTS, CFG.ADMIN_TOKEN];
  try {
  CFG.DEBUG_ENDPOINTS = true;
  CFG.ADMIN_TOKEN = '';
  const local = await get('/debug/anticheat');
  assert.strictEqual(local.status, 200, 'no admin token configured: this machine only (the test runs locally)');
  const body = await local.json();
  assert.ok(Array.isArray(body.anticheat.rules) && body.anticheat.rules.length > 10, 'rules, weights and counters are listed');
  assert.ok(!/tok|secret|127\.0\.0\.1/i.test(JSON.stringify(body)), 'no tokens, secrets or addresses');
  CFG.ADMIN_TOKEN = 'correct-horse-battery-staple';
  assert.strictEqual((await get('/debug/anticheat')).status, 404, 'with a token configured, requests without it are refused');
  assert.strictEqual((await get('/debug/anticheat', { Authorization: 'Bearer wrong' })).status, 404);
  assert.strictEqual((await get('/debug/anticheat', { Authorization: 'Bearer correct-horse-battery-staple' })).status, 200);
  const rooms = await (await get('/debug/rooms', { Authorization: 'Bearer correct-horse-battery-staple' })).json();
  assert.ok(Array.isArray(rooms.rooms));
  } finally {
    [CFG.DEBUG_ENDPOINTS, CFG.ADMIN_TOKEN] = old;
  }
});

// ---------------------------------------------------------------------------------------------
// the hand-written WebSocket layer, spoken to with raw frames
// ---------------------------------------------------------------------------------------------
function rawConnect(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0),
      shaken = false;
    const frames = [];
    const waiters = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!shaken) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        buf = buf.subarray(i + 4);
        shaken = true;
        const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        if (!head.startsWith('HTTP/1.1 101') || !head.includes(accept)) return reject(new Error('bad handshake: ' + head));
        resolve(api);
      }
      for (;;) {
        if (buf.length < 2) break;
        let len = buf[1] & 0x7f,
          off = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          off = 4;
        }
        if (buf.length < off + len) break;
        const f = { op: buf[0] & 0x0f, payload: buf.subarray(off, off + len) };
        buf = buf.subarray(off + len);
        frames.push(f);
        for (const w of waiters.slice()) w();
      }
    });
    sock.on('error', reject);
    sock.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    const mask = (payload) => {
      const m = crypto.randomBytes(4);
      const out = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ m[i & 3];
      return [m, out];
    };
    const api = {
      sock,
      frames,
      frame(op, payload, fin, masked) {
        const len = payload.length;
        const head = len < 126 ? Buffer.from([(fin === false ? 0 : 0x80) | op, (masked === false ? 0 : 0x80) | len]) : Buffer.concat([Buffer.from([(fin === false ? 0 : 0x80) | op, (masked === false ? 0 : 0x80) | 126]), Buffer.from([len >> 8, len & 255])]);
        if (masked === false) return Buffer.concat([head, payload]);
        const [m, p] = mask(payload);
        return Buffer.concat([head, m, p]);
      },
      send(op, payload, fin, masked) {
        sock.write(this.frame(op, Buffer.from(payload), fin, masked));
      },
      async next(pred, ms) {
        const t0 = Date.now();
        for (;;) {
          const i = frames.findIndex(pred);
          if (i >= 0) return frames.splice(i, 1)[0];
          if (Date.now() - t0 > (ms || 3000)) throw new Error('timeout');
          await new Promise((r) => {
            waiters.push(r);
            setTimeout(r, 50);
          });
        }
      },
    };
  });
}

test('websocket layer: ping gets a pong, fragmented and long messages are reassembled', async () => {
  const c = await rawConnect(srv.port);
  c.send(0x9, 'hi');
  const pong = await c.next((f) => f.op === 0xa);
  assert.strictEqual(pong.payload.toString(), 'hi');
  const hello = JSON.stringify({ t: 'hello', v: CFG.PROTOCOL, name: 'Fragmented' });
  c.send(0x1, hello.slice(0, 10), false);
  c.send(0x0, hello.slice(10, 25), false);
  c.send(0x0, hello.slice(25), true);
  const w = await c.next((f) => f.op === 0x1);
  assert.strictEqual(JSON.parse(w.payload.toString()).t, 'welcome');
  c.send(0x1, JSON.stringify({ t: 'ping', ts: 7, pad: 'y'.repeat(300) }));
  const p = await c.next((f) => f.op === 0x1);
  assert.strictEqual(JSON.parse(p.payload.toString()).t, 'pong');
  c.sock.destroy();
});

test('websocket layer: unmasked client frames and binary frames are refused', async () => {
  const a = await rawConnect(srv.port);
  a.send(0x1, '{"t":"ping"}', true, false);
  const close = await a.next((f) => f.op === 0x8);
  assert.strictEqual(close.payload.readUInt16BE(0), 1002);
  a.sock.destroy();
  const b = await rawConnect(srv.port);
  b.send(0x2, Buffer.from([1, 2, 3]));
  const close2 = await b.next((f) => f.op === 0x8);
  assert.strictEqual(close2.payload.readUInt16BE(0), 1003);
  b.sock.destroy();
});

test('websocket layer: a bad handshake gets an HTTP error, a foreign origin is refused when a list is configured', async () => {
  const plain = await fetch(srv.http + '/ws');
  assert.strictEqual(plain.status, 200); // plain HTTP to /ws is just the info page, never a WebSocket
  const saved = CFG.ALLOWED_ORIGINS.slice();
  CFG.ALLOWED_ORIGINS.push('https://good.example');
  await new Promise((resolve) => {
    const sock = net.connect(srv.port, '127.0.0.1');
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('close', () => {
      assert.match(data, /403/);
      resolve();
    });
    sock.write('GET /ws HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  CFG.ALLOWED_ORIGINS.length = 0;
  for (const o of saved) CFG.ALLOWED_ORIGINS.push(o);
});
