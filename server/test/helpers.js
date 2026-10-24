'use strict';
/* Shared helpers for the server tests: a tiny WebSocket test client and a way to find open ground. */
const S = require('../shared');
const CFG = require('../config');
const { createServer } = require('../server');

const RV = S.RV;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  CFG.SPAWN_PROTECT_S = 0; // the staged fights in the tests start right after 'live'; the protection tests turn it on themselves
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
    this.bytes = 0; // characters received (bandwidth measurements)
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
      this.bytes += typeof e.data === 'string' ? e.data.length : 0;
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

/** Two standing spots from which NO part of the other player can be seen (every sight ray the server uses is blocked). */
function hiddenPair(mapId) {
  const world = S.worldFor(mapId);
  const map = RV.maps[mapId];
  const HW = 0.35,
    th = 1.8;
  const seen = (a, b) => {
    const cy = b.y + th * 0.55;
    const dx = b.x - a.x,
      dz = b.z - a.z,
      l = Math.hypot(dx, dz) || 1,
      px = (-dz / l) * HW,
      pz = (dx / l) * HW;
    const ey = a.y + 1.62;
    return world.lineClear(a.x, ey, a.z, b.x, cy, b.z) || world.lineClear(a.x, ey, a.z, b.x, b.y + th - 0.2, b.z) || world.lineClear(a.x, ey, a.z, b.x, b.y + 0.3, b.z) || world.lineClear(a.x, ey, a.z, b.x + px, cy, b.z + pz) || world.lineClear(a.x, ey, a.z, b.x - px, cy, b.z - pz);
  };
  for (const a of map.spawns)
    for (const b of map.spawns) {
      if (a === b || Math.hypot(a.x - b.x, a.z - b.z) < 7) continue;
      if (!seen(a, b) && !seen(b, a)) return { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
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

/** A flat, clear straight run of `len` metres on a map: { x, y, z, yaw } (start point and the direction to run in). */
function runway(mapId, len) {
  const world = S.worldFor(mapId);
  const map = RV.maps[mapId];
  len = len || 22;
  for (const sp of map.spawns) {
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2 - Math.PI;
      const fx = -Math.sin(yaw),
        fz = -Math.cos(yaw);
      let ok = true;
      for (let d = 0; d <= len && ok; d += 1.5) {
        const x = sp.x + fx * d,
          z = sp.z + fz * d;
        const f = world.floorBelow(x, sp.y + 0.5, z, 0.3);
        if (!isFinite(f) || Math.abs(f - sp.y) > 0.02 || world.overlapsAny(x, sp.y + 0.05, z, 0.45, 2.0)) ok = false;
        for (const pad of world.pads) if (x > pad.x0 - 1.2 && x < pad.x1 + 1.2 && z > pad.z0 - 1.2 && z < pad.z1 + 1.2) ok = false; // launch pads change the run
      }
      if (ok) return { x: sp.x, y: sp.y, z: sp.z, yaw };
    }
  }
  throw new Error('no runway of ' + len + ' m on ' + mapId);
}

/** TEST_MODE: put the player at `pos` looking along `yaw` and let the prediction client adopt the server's corrected state. */
async function placeSim(m, sa, pos, yaw) {
  m.a.clear('fix');
  tp(m.a, pos, yaw, 0, 0);
  const f = await m.a.wait('fix', (x) => x.why === 'tp', 3000);
  m.a.msgs.unshift(f); // (wait() consumed it: hand it back to the prediction client)
  sa.pump();
  sa.pl.yaw = yaw;
  sa.fixes = 0; // only count corrections from here on
}

/** yaw / pitch (the game's convention: forward = (-sin yaw, ., -cos yaw)) that look from a standing eye to a point. */
function anglesTo(from, to, dy) {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    ddy = to.y + (dy == null ? 1.0 : dy) - (from.y + 1.62);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(ddy, Math.hypot(dx, dz)) };
}

/** TEST_MODE only: stand a player somewhere, looking somewhere, with a weapon in hand. */
function tp(client, pos, yaw, pitch, slot, hp) {
  client.send({ t: 'tp', x: pos.x, y: pos.y, z: pos.z, yaw: yaw || 0, pitch: pitch || 0, slot: slot == null ? -1 : slot, hp: hp || -1 });
}

/** Ask the room for the server-side truth about my player (TEST_MODE). */
async function dbg(client) {
  client.clear('dbg');
  client.send({ t: 'dbg' });
  return client.wait('dbg');
}

/**
 * A stand-in for the real game client: it runs the SAME movement physics locally (prediction), sends its input
 * exactly as the browser does (runs of identical input + a claim of where it thinks it is), and applies the
 * server's corrections by restoring the state and replaying what is still unacknowledged. Used to prove that
 * what the client predicts is what the server simulates.
 */
class SimClient {
  constructor(tc, mapId, spawnIdx, round) {
    this.tc = tc;
    this.world = S.worldFor(mapId);
    const sp = RV.maps[mapId].spawns[spawnIdx];
    this.pl = new RV.Player(this.world);
    this.pl.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
    this.round = round;
    this.seq = 0; // steps executed
    this.sent = 0; // steps sent
    this.runs = []; // not yet sent
    this.pending = []; // sent, not yet acknowledged: {from, k, fw, sd, fl, y, p, w}
    this.fx = 0; // last correction applied
    this.slot = 0;
    this.fixes = 0;
    this.cmd = { fwd: 0, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: false };
    this.autoHop = false;
  }

  /** Execute k steps of one input locally and queue them as one run. */
  step(k, inp) {
    const pl = this.pl;
    pl.yaw = inp.yaw != null ? inp.yaw : pl.yaw;
    pl.pitch = inp.pitch != null ? inp.pitch : pl.pitch;
    const slot = inp.slot != null ? inp.slot : this.slot;
    this.slot = slot;
    pl.autoHop = !!inp.autoHop;
    const fw = inp.fw || 0,
      sd = inp.sd || 0;
    for (let i = 0; i < k; i++) {
      const fl = RV.NETP.flags({ jumpDown: !!inp.jump, jumpPressed: !!inp.jump && i === 0 && inp.press !== false, crouch: !!inp.crouch, sprint: !!inp.sprint }, !!inp.autoHop);
      RV.NETP.cmdFrom(fw, sd, fl, this.cmd);
      pl.djEnabled = inp.forceDj ? true : !!RV.WEAPONS[slot].doubleJump && inp.dj !== false;
      pl.step(RV.PHYS.STEP, this.cmd);
      const last = this.runs[this.runs.length - 1];
      const entry = { fw, sd, fl, y: pl.yaw, p: pl.pitch, w: slot };
      if (last && last.fw === fw && last.sd === sd && last.fl === fl && last.y === entry.y && last.p === entry.p && last.w === slot && last.k < RV.NETP.MAX_RUN_STEPS) last.k++;
      else this.runs.push(Object.assign({ k: 1 }, entry));
      this.seq++;
    }
  }

  /** Send everything queued (in messages the schema accepts: <= 24 runs, <= 200 steps) with a claim of the current predicted position. */
  flush(noClaim) {
    if (!this.runs.length) return;
    const runs = this.runs;
    this.runs = [];
    let i = 0;
    while (i < runs.length) {
      const chunk = [];
      let steps = 0;
      while (i < runs.length && chunk.length < 24 && steps + runs[i].k <= 200) {
        steps += runs[i].k;
        chunk.push(runs[i++]);
      }
      const last = i >= runs.length;
      const msg = { t: 'in', rn: this.round, q: this.sent, r: chunk.map((r) => [r.k, r.fw, r.sd, r.fl, r.y, r.p, r.w]) };
      if (!noClaim && last) {
        const b = this.pl.b;
        msg.c = [b.x, b.y, b.z, this.fx];
      }
      this.tc.send(msg);
      let from = this.sent;
      for (const r of chunk) {
        this.pending.push({ from, k: r.k, fw: r.fw, sd: r.sd, fl: r.fl, y: r.y, p: r.p, w: r.w });
        from += r.k;
      }
      this.sent = from;
    }
  }

  act(a, s) {
    this.flush();
    this.tc.send({ t: 'act', rn: this.round, q: this.sent, a, s: s == null ? this.slot : s });
  }

  /** Apply any corrections the server sent (restore state, replay the unacknowledged steps). */
  pump() {
    for (const f of this.tc.all('fix')) {
      this.fixes++;
      this.fx = f.id;
      const yaw = this.pl.yaw,
        pitch = this.pl.pitch;
      this.pl.setState(f.st);
      this.pending = this.pending.filter((r) => r.from + r.k > f.a);
      for (const r of this.pending) {
        const skip = Math.max(0, f.a - r.from);
        this.pl.yaw = r.y;
        this.pl.pitch = r.p;
        this.pl.autoHop = (r.fl & 16) !== 0;
        this.pl.djEnabled = !!RV.WEAPONS[r.w].doubleJump;
        RV.NETP.cmdFrom(r.fw, r.sd, r.fl, this.cmd);
        for (let i = skip; i < r.k; i++) this.pl.step(RV.PHYS.STEP, this.cmd);
      }
      this.pl.yaw = yaw;
      this.pl.pitch = pitch;
    }
    this.tc.clear('fix');
    // drop acknowledged history
    const snap = this.tc.last('snap');
    if (snap && typeof snap.a === 'number') this.pending = this.pending.filter((r) => r.from + r.k > snap.a);
  }

  /** Play `seconds` of real time: every 33 ms, 4 steps of fn(i) are executed, sent and corrections applied. */
  async run(seconds, fn, interval) {
    const iv = interval || 33;
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < seconds * 1000) {
      const inp = fn(i++, this);
      if (inp) this.step(inp.k || 4, inp);
      this.flush();
      await sleep(iv);
      this.pump();
    }
  }
}

/**
 * Stage a fight: A (a prediction client) and B stand at pair.a / pair.b looking at each other, with the given weapons
 * in hand; the server's position history is given time to settle. Returns A's SimClient (aimed at B's chest).
 * `round` is the 'round' message of the current round.
 */
async function stage(m, round, pair, opts) {
  opts = opts || {};
  const sa = opts.sim || new SimClient(m.a, m.map, round.you, round.n); // (reuse the same client to stage again within a round)
  const aim = anglesTo(pair.a, pair.b, opts.dy == null ? 1.0 : opts.dy);
  const back = anglesTo(pair.b, pair.a, 1.0);
  m.a.clear('fix');
  m.b.clear('fix');
  tp(m.a, pair.a, aim.yaw, aim.pitch, opts.slotA == null ? 0 : opts.slotA);
  tp(m.b, pair.b, back.yaw, back.pitch, opts.slotB == null ? 0 : opts.slotB);
  const f = await m.a.wait('fix', (x) => x.why === 'tp', 3000);
  m.a.msgs.unshift(f);
  sa.pump();
  sa.fixes = 0;
  sa.pl.yaw = aim.yaw;
  sa.pl.pitch = aim.pitch;
  sa.slot = opts.slotA == null ? 0 : opts.slotA;
  await m.b.wait('fix', (x) => x.why === 'tp', 3000);
  await sleep(opts.settle == null ? 320 : opts.settle); // lag compensation looks ~180 ms back: let the history catch up
  m.a.clear();
  m.b.clear();
  return sa;
}

/** One shot the way the browser sends it: run `gap` simulation steps (default 0.1 s) of standing still, then ask to fire. */
function shoot(sa, gap, action) {
  sa.step(gap == null ? 12 : gap, {});
  sa.act(action || 'fire');
}

function stMsg() {
  throw new Error('stMsg: client-reported positions no longer exist; use SimClient (real inputs) or tp() (TEST_MODE)');
}

module.exports = { S, RV, CFG, sleep, startServer, TestClient, SimClient, liveMatch, openPair, blockedPair, hiddenPair, aimAt, anglesTo, tp, dbg, stMsg, runway, placeSim, stage, shoot };
