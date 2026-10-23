'use strict';
/* Shared helpers for the server tests: a tiny WebSocket test client and a way to find open ground. */
const S = require('../shared');
const CFG = require('../config');
const { createServer } = require('../server');

const RV = S.RV;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const { server, lobby } = createServer();
  lobby.start();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    lobby,
    url: 'ws://127.0.0.1:' + port + '/ws',
    http: 'http://127.0.0.1:' + port,
    async stop() {
      lobby.stop();
      server.close();
      if (server.closeAllConnections) server.closeAllConnections();
      await sleep(100);
    },
  };
}

class TestClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.closed = null;
    this.t0 = Date.now();
  }

  async connect(opts) {
    opts = opts || {};
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.t === 'sping') {
        this.send({ t: 'spong', ts: m.ts });
        return;
      }
      m._at = Date.now();
      this.msgs.push(m);
      for (const w of this.waiters.slice()) if (w.test(m)) w.resolve(m);
    };
    this.ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason };
      for (const w of this.waiters.slice()) w.reject(new Error('closed ' + e.code + ' while waiting for ' + w.what));
    };
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('connect failed'));
    });
    if (opts.hello !== false) {
      this.send({ t: 'hello', v: CFG.PROTOCOL, name: this.name });
      return this.wait('welcome');
    }
    return null;
  }

  send(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  /** Wait for the next message of type `t` (optionally matching `pred`); already received ones count. */
  wait(t, pred, timeout) {
    const test = (m) => m.t === t && (!pred || pred(m));
    const found = this.msgs.find(test);
    if (found) {
      this.msgs.splice(this.msgs.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const w = {
        what: t,
        test,
        resolve: (m) => {
          clearTimeout(timer);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          const i = this.msgs.indexOf(m);
          if (i >= 0) this.msgs.splice(i, 1);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          reject(e);
        },
      };
      const timer = setTimeout(() => w.reject(new Error('timeout waiting for "' + t + '" (' + this.name + ')')), timeout || 8000);
      this.waiters.push(w);
    });
  }

  /** All received messages of a type, without waiting. */
  all(t) {
    return this.msgs.filter((m) => m.t === t);
  }
  clear(t) {
    this.msgs = t ? this.msgs.filter((m) => m.t !== t) : [];
  }
  last(t) {
    const a = this.all(t);
    return a[a.length - 1];
  }
  close() {
    try {
      this.ws.close();
    } catch (e) {
      /* ignore */
    }
  }
}

/** Two matched, loaded clients standing in a live round (waits through the real 3 s countdown). */
async function liveMatch(srv, names) {
  const a = new TestClient(srv.url, (names && names[0]) || 'Alpha');
  const b = new TestClient(srv.url, (names && names[1]) || 'Bravo');
  await a.connect();
  await b.connect();
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const [ma, mb] = await Promise.all([a.wait('match'), b.wait('match')]);
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  const [ra, rb] = await Promise.all([a.wait('round'), b.wait('round')]);
  await Promise.all([a.wait('live', null, 6000), b.wait('live', null, 6000)]);
  return { a, b, ma, mb, ra, rb, map: ma.map, room: ma.room };
}

/** Find two standing spots on a map that can see each other, ~dist m apart. */
function openPair(mapId, dist) {
  const world = S.worldFor(mapId);
  const map = RV.maps[mapId];
  dist = dist || 8;
  for (const s of map.spawns) {
    for (let ang = 0; ang < 6.28; ang += 0.4) {
      const x2 = s.x + Math.cos(ang) * dist,
        z2 = s.z + Math.sin(ang) * dist;
      if (world.overlapsAny(x2, s.y, z2, 0.35, 1.8) || world.overlapsAny(s.x, s.y, s.z, 0.35, 1.8)) continue;
      // same floor level and a clear line of sight eye to chest, both ways
      const f = world.floorBelow(x2, s.y + 0.5, z2, 0.3);
      if (!isFinite(f) || Math.abs(f - s.y) > 0.05) continue;
      if (!world.lineClear(s.x, s.y + 1.62, s.z, x2, s.y + 1, z2) || !world.lineClear(x2, s.y + 1.62, z2, s.x, s.y + 1, s.z)) continue;
      return { a: { x: s.x, y: s.y, z: s.z }, b: { x: x2, y: s.y, z: z2 } };
    }
  }
  throw new Error('no open pair on ' + mapId);
}

/** Two spots that are behind a wall from each other (no line of sight). */
function blockedPair(mapId) {
  const world = S.worldFor(mapId);
  const map = RV.maps[mapId];
  for (let i = 0; i < map.spawns.length; i++) {
    for (let j = 0; j < map.spawns.length; j++) {
      const a = map.spawns[i],
        b = map.spawns[j];
      if (i === j || Math.abs(a.y - b.y) > 0.05) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 6 || d > 40) continue;
      if (!world.lineClear(a.x, a.y + 1.62, a.z, b.x, b.y + 1, b.z)) return { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
    }
  }
  return null;
}

/** Aim direction (unit vector) from a standing eye position to a point. */
function aimAt(from, to, dy) {
  const dx = to.x - from.x,
    ddy = to.y + (dy == null ? 1.0 : dy) - (from.y + 1.62),
    dz = to.z - from.z;
  const l = Math.hypot(dx, ddy, dz);
  return [dx / l, ddy / l, dz / l];
}

function stMsg(p, extra) {
  return Object.assign({ t: 'st', x: p.x, y: p.y, z: p.z, yw: 0, pt: 0, sp: 0, gr: 1, m: 0, w: 0 }, extra || {});
}

module.exports = { S, RV, CFG, sleep, startServer, TestClient, liveMatch, openPair, blockedPair, aimAt, stMsg };
