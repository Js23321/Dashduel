'use strict';
// NORMAL mode (no TEST_MODE): movement validation is ON. These tests play the part of a cheater / broken client.
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const crypto = require('crypto');
const { startServer, liveMatch, TestClient, openPair, aimAt, stMsg, sleep, CFG, S, RV } = require('./helpers');

let srv;
test.before(async () => {
  srv = await startServer();
  CFG.MAX_PER_IP = 200; // every test client comes from 127.0.0.1; the per-address limit has its own test
});
test.after(async () => {
  await srv.stop();
});

test('teleporting is rejected: the server snaps you back and the opponent never sees it', async () => {
  const m = await liveMatch(srv);
  const spawn = RV.maps[m.map].spawns[m.ra.you];
  m.a.clear(); m.b.clear();
  m.a.send(stMsg({ x: spawn.x + 100, y: spawn.y, z: spawn.z }));
  const fix = await m.a.wait('fix');
  assert.ok(Math.abs(fix.x - spawn.x) < 0.01 && Math.abs(fix.z - spawn.z) < 0.01, 'snapped back to the last good position');
  assert.strictEqual(fix.why, 'moved too fast');
  await sleep(150);
  const o = m.b.last('snap').o;
  assert.ok(Math.hypot(o.x - spawn.x, o.z - spawn.z) < 0.5, 'the opponent still sees the old position');
  m.a.close(); m.b.close();
});

test('legitimate movement is accepted (walking and sprinting speeds)', async () => {
  const m = await liveMatch(srv);
  const s = RV.maps[m.map].spawns[m.ra.you];
  m.a.clear(); m.b.clear();
  // 10.5 m/s sprint straight along the spawn's facing for half a second (checked for walls by the server)
  const yaw = s.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const world = S.worldFor(m.map);
  let x = s.x, z = s.z, ok = 0, bad = 0;
  m.a.send(stMsg({ x, y: s.y, z }));
  await sleep(40);
  for (let i = 0; i < 12; i++) {
    const nx = x + fx * 10.5 * 0.033, nz = z + fz * 10.5 * 0.033;
    if (world.overlapsAny(nx, s.y + 0.08, nz, 0.33, 1.68)) break;
    x = nx; z = nz;
    m.a.send(stMsg({ x, y: s.y, z }, { sp: 10.5 }));
    await sleep(33);
  }
  await sleep(100);
  assert.strictEqual(m.a.all('fix').length, 0, 'normal sprinting must never be corrected');
  const o = m.b.last('snap').o;
  assert.ok(Math.hypot(o.x - s.x, o.z - s.z) > 0.5, 'and the opponent sees the movement');
  m.a.close(); m.b.close();
});

test('snapshots that arrive in a bunch (a stall, TCP batching) are not mistaken for speeding', async () => {
  const m = await liveMatch(srv);
  const s = RV.maps[m.map].spawns[m.ra.you];
  m.a.clear(); m.b.clear();
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const world = S.worldFor(m.map);
  m.a.send(stMsg({ x: s.x, y: s.y, z: s.z }));
  await sleep(250); // the client stalled for a quarter of a second ...
  let x = s.x, z = s.z, sent = 0;
  for (let i = 0; i < 7; i++) {
    // ... and now its queued snapshots (12 m/s sprint, 33 ms apart) arrive all at once
    const nx = x + fx * 12 * 0.033, nz = z + fz * 12 * 0.033;
    if (world.overlapsAny(nx, s.y + 0.08, nz, 0.33, 1.68)) break;
    x = nx; z = nz; sent++;
    m.a.send(stMsg({ x, y: s.y, z }, { sp: 12 }));
  }
  await sleep(150);
  assert.ok(sent >= 3, 'test needs open ground ahead of the spawn');
  assert.strictEqual(m.a.all('fix').length, 0, 'honest bunched snapshots must never be corrected');
  m.a.close(); m.b.close();
});

test('speed hacking gets corrected, and a persistent cheater is kicked', async () => {
  const m = await liveMatch(srv);
  const s = RV.maps[m.map].spawns[m.ra.you];
  m.a.send(stMsg({ x: s.x, y: s.y, z: s.z }));
  await sleep(50);
  m.a.clear();
  let x = s.x;
  for (let i = 0; i < 30 && !m.a.closed; i++) {
    x += 6; // 6 m per 40 ms = 150 m/s
    m.a.send(stMsg({ x, y: s.y, z: s.z }));
    await sleep(40);
  }
  assert.ok(m.a.all('fix').length >= 8, 'every speed-hacked snapshot is corrected');
  await sleep(500);
  assert.ok(m.a.closed && m.a.closed.code === 1008, 'repeat offender kicked (1008), got ' + JSON.stringify(m.a.closed));
  const end = await m.b.wait('matchEnd', null, 4000);
  assert.strictEqual(end.w, 'you', 'the honest player wins by forfeit');
  m.b.close();
});

test('standing inside a wall is rejected', async () => {
  const m = await liveMatch(srv);
  const world = S.worldFor(m.map);
  const sp = RV.maps[m.map].spawns[m.ra.you];
  const solid = world.solids.find((s) => !s.isRamp && s.maxY - s.minY > 2 && s.maxX - s.minX > 1 && s.maxZ - s.minZ > 1);
  assert.ok(solid);
  const cx = (solid.minX + solid.maxX) / 2, cz = (solid.minZ + solid.maxZ) / 2, cy = solid.minY + 0.5;
  m.a.send(stMsg({ x: sp.x, y: sp.y, z: sp.z }));
  await sleep(50);
  m.a.clear();
  // not a teleport (small step is irrelevant: the position itself is illegal)
  m.a.send(stMsg({ x: cx, y: cy, z: cz }));
  const fix = await m.a.wait('fix');
  assert.ok(['inside a wall', 'moved too fast'].includes(fix.why));
  m.a.close(); m.b.close();
});

test('a client cannot award itself anything: made-up server messages are ignored', async () => {
  const m = await liveMatch(srv);
  m.b.clear(); m.a.clear();
  for (const fake of [
    { t: 'hurt', dmg: 150, hp: 0 },
    { t: 'hit', dmg: 150, kill: true },
    { t: 'roundEnd', w: 'you', sc: [5, 0], over: true },
    { t: 'matchEnd', w: 'you', sc: [5, 0] },
    { t: 'snap', hp: 150, sc: [5, 0] },
    { t: 'dmg', dmg: 999 },
    { t: 'kill', who: 'opp' },
    { t: 'boom', own: false, p: [0, 0, 0] },
    { t: 'nade', own: true },
    { t: 'welcome', name: 'Hacker' },
    { t: 'match', room: 99 },
  ]) m.a.send(fake);
  await sleep(500);
  assert.strictEqual(m.b.all('hurt').length, 0);
  assert.strictEqual(m.b.all('roundEnd').length, 0);
  assert.strictEqual(m.b.all('matchEnd').length, 0);
  assert.strictEqual(m.b.last('snap').hp, 150);
  assert.deepStrictEqual(m.b.last('snap').sc, [0, 0]);
  assert.ok(!m.a.closed, 'harmless unknown messages do not disconnect');
  m.a.close(); m.b.close();
});

test('no shooting during the countdown, and malformed shots are ignored', async () => {
  const a = new TestClient(srv.url, 'CdCheatA'), b = new TestClient(srv.url, 'CdCheatB');
  await a.connect(); await b.connect();
  a.send({ t: 'queue' }); b.send({ t: 'queue' });
  const [ma] = await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' }); b.send({ t: 'ready' });
  await Promise.all([a.wait('round'), b.wait('round')]);
  b.clear();
  for (let i = 0; i < 10; i++) a.send({ t: 'fire', s: 0, d: [1, 0, 0] });
  a.send({ t: 'punch', d: [1, 0, 0] });
  a.send({ t: 'nadepin' });
  await sleep(500);
  assert.strictEqual(b.all('hurt').length, 0);
  assert.strictEqual(b.all('fx').length, 0, 'no shot effects during the countdown');
  await a.wait('live', null, 6000);
  b.clear();
  // after going live, nonsense directions do nothing
  for (const d of [[0, 0, 0], [5, 5, 5], ['a', 'b', 'c'], [NaN, 0, 1], [1, 2], null, 'x', [1e9, 0, 0]]) a.send({ t: 'fire', s: 0, d });
  await sleep(400);
  assert.strictEqual(b.all('hurt').length, 0);
  assert.strictEqual(b.all('fx').length, 0);
  a.close(); b.close();
});

test('garbage input never crashes the server: bad JSON, wrong types, huge numbers, repeated hello', async () => {
  const c = new TestClient(srv.url, 'Garbage');
  await c.connect();
  for (const g of ['{', '[]', 'null', '123', '"x"', '{"t":5}', '{"t":"st","x":"a"}', '{"t":"queue"}'.repeat(2), '\u0000\u0001', '{"t":"hello","v":1,"name":{"a":1}}']) c.send(g);
  await sleep(300);
  assert.ok(!c.closed, 'a few bad messages are tolerated');
  c.send({ t: 'ping', ts: 5 });
  assert.strictEqual((await c.wait('pong')).ts, 5, 'and the connection still works');
  const health = await (await fetch(srv.http + '/health')).json();
  assert.strictEqual(health.ok, true);
  c.close();
});

test('message flooding gets the connection dropped without hurting other players', async () => {
  const flood = new TestClient(srv.url, 'Flooder'), calm = new TestClient(srv.url, 'Calm');
  await flood.connect(); await calm.connect();
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
  for (let i = 0; i < 40 && srv.lobby.perIp.get('127.0.0.1'); i++) await sleep(100); // let earlier tests' sockets drain
  CFG.MAX_PER_IP = 3;
  const cs = [];
  for (let i = 0; i < 3; i++) {
    const c = new TestClient(srv.url, 'Ip' + i);
    await c.connect();
    cs.push(c);
  }
  const extra = new TestClient(srv.url, 'IpExtra');
  await assert.rejects(() => extra.connect(), /connect failed/);
  for (const c of cs) c.close();
  await sleep(300);
  CFG.MAX_PER_IP = old;
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
  const info = await (await fetch(srv.http + '/health')).json();
  assert.strictEqual(info.queued >= 1, true);
  early.close();
});

// ---------------------------------------------------------------------------------------------
// the hand-written WebSocket layer, spoken to with raw frames
// ---------------------------------------------------------------------------------------------
function rawConnect(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), shaken = false;
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
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
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
      send(op, payload, fin, masked) { sock.write(this.frame(op, Buffer.from(payload), fin, masked)); },
      async next(pred, ms) {
        const t0 = Date.now();
        for (;;) {
          const i = frames.findIndex(pred);
          if (i >= 0) return frames.splice(i, 1)[0];
          if (Date.now() - t0 > (ms || 3000)) throw new Error('timeout');
          await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
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
  // a hello split into three fragments (text, continuation, final continuation)
  const hello = JSON.stringify({ t: 'hello', v: CFG.PROTOCOL, name: 'Fragmented' });
  c.send(0x1, hello.slice(0, 10), false);
  c.send(0x0, hello.slice(10, 25), false);
  c.send(0x0, hello.slice(25), true);
  const w = await c.next((f) => f.op === 0x1);
  assert.strictEqual(JSON.parse(w.payload.toString()).t, 'welcome');
  // a 300 byte message uses the 16-bit length field
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
