'use strict';
/*
 * One isolated 1v1 match. The room is the AUTHORITY for everything that decides the result:
 *
 *   server decides                          client decides (and the server only validates)
 *   -----------------------------------     ------------------------------------------------
 *   health, damage, headshots, deaths       where the player walks (movement is simulated by the
 *   ammo, reloads, fire rate, weapon stock  client's physics; every snapshot is checked for speed,
 *   grenade flight, fuse, blast damage      teleports and walls and rejected / snapped back if bad)
 *   rounds, score, countdown, spawns        look direction
 *   who wins, forfeits, timeouts
 *
 * Shots are never trusted: the client only says "fire in this direction". The server uses ITS OWN
 * validated position of the shooter as the origin, checks weapon / ammo / fire rate, and tests the
 * ray against the opponent's position REWOUND by the shooter's measured latency (lag compensation)
 * and against the walls of the map.
 */
const { performance } = require('perf_hooks');
const S = require('./shared');
const CFG = require('./config');

const RV = S.RV;
const WEAPONS = RV.WEAPONS;
const GW = RV.WEAPON_BY_ID.grenade;
const FISTS = RV.WEAPON_BY_ID.fists;

const EYE = [1.62, 0.95, 0.78]; // eye height above the feet: stand / crouch / slide
const BODY_H = [1.8, 1.1, 1.1];
const HW = 0.35; // player half width
const MAX_H_SPEED = 70; // m/s: the client's own cap is 60; the rest is slack for timing jitter
const MAX_V_SPEED = 90; // falling from a tall map reaches ~55 m/s
const SLACK = 1.0; // metres of positional slack per snapshot
const BURST_S = 0.15; // movement a snapshot may "catch up" on after a stall (server hiccup, packets bunching in TCP)
const HIST_MS = 1500;
const PH = { loading: 0, countdown: 1, live: 2, ended: 3, over: 4 };

const now = () => performance.now();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const isNum = (v) => typeof v === 'number' && isFinite(v);
/** A direction vector from the client: must be (close to) unit length, otherwise it is rejected. */
function dir3(a) {
  if (!Array.isArray(a) || a.length !== 3 || !a.every(isNum)) return null;
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 0.9 || l > 1.1) return null;
  return { x: a[0] / l, y: a[1] / l, z: a[2] / l };
}

function makePlayer(client, seat) {
  return {
    cl: client,
    seat,
    ready: false,
    hasState: false,
    bH: 0,
    bV: 0,
    pos: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    sp: 0,
    gr: 1,
    mode: 0,
    h: BODY_H[0],
    slot: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: RV.MAX_HP,
    alive: false,
    hist: [],
    lastSt: 0,
    ammo: WEAPONS.map((w) => w.mag),
    reload: null,
    lastFire: 0,
    lastPunch: 0,
    switchUntil: 0,
    grenades: GW.maxCount,
    nadeAt: 0,
    pinAt: -1,
    viol: [],
    shots: 0,
    hits: 0,
  };
}

class Room {
  /** onClosed(room) is called once, when the match is over and both players are free again. */
  constructor(id, mapId, a, b, onClosed) {
    this.id = id;
    this.mapId = mapId;
    this.map = RV.maps[mapId];
    this.world = S.worldFor(mapId);
    this.onClosed = onClosed;
    this.p = [makePlayer(a, 0), makePlayer(b, 1)];
    this.phase = 'loading';
    this.phaseAt = now();
    this.round = 0;
    this.score = [0, 0];
    this.flip = false;
    this.over = false;
    this.grenades = [];
    this.closed = false;
    this.liveAt = 0;
    this.snapSeq = 0;
    for (const p of this.p) {
      p.cl.room = this;
      p.cl.seat = p.seat;
      p.cl.send({ t: 'match', room: id, map: mapId, seat: p.seat, opp: this.p[1 - p.seat].cl.name, to: CFG.TO, cd: CFG.COUNTDOWN });
    }
  }

  opp(p) {
    return this.p[1 - p.seat];
  }
  playerOf(client) {
    return this.p[client.seat];
  }
  broadcast(fn) {
    for (const p of this.p) p.cl.send(fn(p));
  }

  // ---------------------------------------------------------------------------
  // messages
  // ---------------------------------------------------------------------------
  onMessage(client, m) {
    if (this.closed) return;
    const p = this.playerOf(client);
    const t = now();
    switch (m.t) {
      case 'ready':
        p.ready = true;
        break;
      case 'st':
        this.onState(p, m, t);
        break;
      case 'fire':
        this.onFire(p, m, t);
        break;
      case 'punch':
        this.onPunch(p, m, t);
        break;
      case 'reload':
        this.startReload(p, t);
        break;
      case 'nadepin':
        if (this.phase === 'live' && p.alive && p.slot === 3 && p.grenades > 0 && p.pinAt < 0 && t >= p.switchUntil) p.pinAt = t;
        break;
      case 'nadecancel':
        p.pinAt = -1;
        break;
      case 'nade':
        this.onNade(p, m, t);
        break;
      case 'nadeself':
        this.onNadeSelf(p, t);
        break;
      case 'leave':
        this.onLeave(client, 'left');
        break;
    }
  }

  flag(p, why, snap) {
    const t = now();
    p.viol.push(t);
    while (p.viol.length && t - p.viol[0] > 10000) p.viol.shift();
    if (snap) p.cl.send({ t: 'fix', x: r3(p.pos.x), y: r3(p.pos.y), z: r3(p.pos.z), why });
    if (p.viol.length > 12) p.cl.kick('Too many invalid moves');
  }

  /** A position snapshot from the client: validated, then accepted or snapped back. */
  onState(p, m, t) {
    if (!p.alive || (this.phase !== 'live' && this.phase !== 'ended')) return;
    if (!isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.yw) || !isNum(m.pt)) return this.flag(p, 'bad state', false);
    if (Math.abs(m.x) > 500 || Math.abs(m.z) > 500 || m.y < -200 || m.y > 300) return this.flag(p, 'out of bounds', true);
    const mode = m.m === 1 || m.m === 2 ? m.m : 0;
    const slot = m.w === 1 || m.w === 2 || m.w === 3 ? m.w : 0;
    const h = BODY_H[mode];
    if (!CFG.TEST_MODE) {
      if (p.hasState) {
        // Movement budget: you earn MAX_SPEED x the time that passed (capped at a short burst) and spend what you
        // move. Judging every snapshot against its own arrival gap would flag honest players whenever packets
        // happen to arrive in a bunch; the budget still catches teleports and sustained speed hacks.
        const gap = clamp((t - p.lastSt) / 1000, 0, BURST_S);
        p.bH = Math.min(MAX_H_SPEED * BURST_S, p.bH + MAX_H_SPEED * gap);
        p.bV = Math.min(MAX_V_SPEED * BURST_S, p.bV + MAX_V_SPEED * gap);
        const dh = Math.hypot(m.x - p.pos.x, m.z - p.pos.z);
        const dy = Math.abs(m.y - p.pos.y);
        if (dh > p.bH + SLACK || dy > p.bV + SLACK) return this.flag(p, 'moved too fast', true);
        p.bH -= dh;
        p.bV -= dy;
      }
      if (this.world.overlapsAny(m.x, m.y + 0.08, m.z, 0.33, h - 0.12)) return this.flag(p, 'inside a wall', true);
    }
    const dt = clamp((t - p.lastSt) / 1000, 0.004, 0.75);
    if (p.hasState) {
      p.vx = (m.x - p.pos.x) / dt;
      p.vy = (m.y - p.pos.y) / dt;
      p.vz = (m.z - p.pos.z) / dt;
    }
    p.pos.x = m.x;
    p.pos.y = m.y;
    p.pos.z = m.z;
    p.yaw = m.yw;
    p.pitch = clamp(m.pt, -1.6, 1.6);
    p.sp = isNum(m.sp) ? clamp(m.sp, 0, 90) : 0;
    p.gr = m.gr ? 1 : 0;
    p.mode = mode;
    p.h = h;
    p.hasState = true;
    p.lastSt = t;
    if (slot !== p.slot) {
      // switching cancels a reload and a held grenade
      p.slot = slot;
      p.reload = null;
      p.pinAt = -1;
      p.switchUntil = t + WEAPONS[slot].switchTime * 1000 * 0.8;
    }
    p.hist.push({ t, x: m.x, y: m.y, z: m.z, h });
    while (p.hist.length > 2 && t - p.hist[0].t > HIST_MS) p.hist.shift();
    if (m.y < this.world.killY && this.phase === 'live') this.damage(p, 9999, null, { src: 'fall', from: p.pos });
  }

  /** Where `q` was at server time `t` (interpolated from its validated history). */
  histAt(q, t) {
    const h = q.hist;
    if (!h.length) return { x: q.pos.x, y: q.pos.y, z: q.pos.z, h: q.h };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1],
          b = h[i];
        const k = clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, h: b.h };
      }
    }
    return h[h.length - 1];
  }

  eye(p) {
    return { x: p.pos.x, y: p.pos.y + EYE[p.mode], z: p.pos.z };
  }

  startReload(p, t) {
    const w = WEAPONS[p.slot];
    if (!p.alive || this.phase !== 'live' || w.kind !== 'gun' || p.reload || p.ammo[p.slot] >= w.mag || t < p.switchUntil) return;
    p.reload = { slot: p.slot, until: t + w.reload * 1000 };
  }

  onFire(p, m, t) {
    if (this.phase !== 'live' || !p.alive) return;
    const w = WEAPONS[p.slot];
    if (!w || w.kind !== 'gun' || (m.s !== undefined && m.s !== p.slot)) return;
    if (t < p.switchUntil || p.reload) return;
    if (p.ammo[p.slot] <= 0) return this.startReload(p, t);
    if (t - p.lastFire < w.interval * 1000 * 0.85) return;
    const d = dir3(m.d);
    if (!d) return this.flag(p, 'bad direction', false);
    p.lastFire = t;
    p.ammo[p.slot]--;
    p.shots++;
    if (p.ammo[p.slot] <= 0) this.startReload(p, t);
    // the ORIGIN is the server's own validated position of the shooter, never the client's claim
    const o = this.eye(p);
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range, rh);
    const tW = hitW ? rh.t : w.range;
    let end = tW;
    const q = this.opp(p);
    if (q.alive && q.hasState) {
      // the shooter saw the opponent about (their round trip + the 100 ms interpolation delay) ago
      const qp = this.histAt(q, t - clamp(p.cl.rtt + 100, 0, 350));
      const hit = RV.rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, qp.x - HW, qp.y, qp.z - HW, qp.x + HW, qp.y + qp.h, qp.z + HW, tW);
      if (hit >= 0) {
        end = hit;
        const head = o.y + d.y * hit >= qp.y + qp.h - 0.3;
        const dmg = Math.round(RV.damageAt(w, hit) * (head ? w.headMul || 1 : 1));
        this.damage(q, dmg, p, { head, src: w.id, from: o });
      }
    }
    q.cl.send({ t: 'fx', k: 'shot', w: w.id, o: [r3(o.x), r3(o.y), r3(o.z)], d: [r3(d.x), r3(d.y), r3(d.z)], e: [r3(o.x + d.x * end), r3(o.y + d.y * end), r3(o.z + d.z * end)] });
  }

  onPunch(p, m, t) {
    if (this.phase !== 'live' || !p.alive || p.slot !== 2) return;
    if (t < p.switchUntil || t - p.lastPunch < FISTS.interval * 1000 * 0.85) return;
    const d = dir3(m.d);
    if (!d) return this.flag(p, 'bad direction', false);
    p.lastPunch = t;
    p.shots++;
    const o = this.eye(p);
    const q = this.opp(p);
    q.cl.send({ t: 'fx', k: 'punch' });
    if (!q.alive || !q.hasState) return;
    const qp = this.histAt(q, t - clamp(p.cl.rtt + 100, 0, 350));
    const range = FISTS.range + 0.4;
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, rh);
    const tW = hitW ? rh.t : range;
    const pad = FISTS.reach;
    const hit = RV.rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, qp.x - HW - pad, qp.y - 0.15, qp.z - HW - pad, qp.x + HW + pad, qp.y + qp.h + 0.1, qp.z + HW + pad, tW);
    if (hit >= 0) this.damage(q, FISTS.dmg, p, { head: false, src: 'fists', from: o });
  }

  onNade(p, m, t) {
    if (this.phase !== 'live' || !p.alive || p.slot !== 3 || p.pinAt < 0 || p.grenades <= 0) return;
    if (t - p.pinAt < 150) return this.flag(p, 'grenade too fast', false);
    const d = dir3(m.d);
    if (!d) return this.flag(p, 'bad direction', false);
    const L = RV.grensim.launch(this.world, this.eye(p), d, { vx: clamp(p.vx, -40, 40), vy: clamp(p.vy, -40, 40), vz: clamp(p.vz, -40, 40) }, GW, {}, {});
    const g = { owner: p.seat, x: L.sx, y: L.sy, z: L.sz, vx: L.vx, vy: L.vy, vz: L.vz, rest: false, age: 0, rh: {} };
    this.grenades.push(g);
    p.grenades--;
    p.nadeAt = t + GW.regen * 1000;
    p.pinAt = -1;
    for (const pl of this.p) pl.cl.send({ t: 'nade', own: pl.seat === p.seat, p: [r3(g.x), r3(g.y), r3(g.z)], v: [r3(g.vx), r3(g.vy), r3(g.vz)] });
  }

  /** The client held the grenade for the full hold time: it explodes on the thrower (a boost; damages only the enemy). */
  onNadeSelf(p, t) {
    if (this.phase !== 'live' || !p.alive || p.slot !== 3 || p.pinAt < 0 || p.grenades <= 0) return;
    if (t - p.pinAt < GW.hold.total * 1000 - 400) return this.flag(p, 'grenade released early', false);
    p.grenades--;
    p.nadeAt = t + GW.regen * 1000;
    p.pinAt = -1;
    this.explode({ owner: p.seat, x: p.pos.x, y: p.pos.y, z: p.pos.z });
  }

  explode(g) {
    const owner = this.p[g.owner];
    const target = this.opp(owner);
    const ex = g.x,
      ey = g.y + 0.12,
      ez = g.z;
    if (this.phase === 'live' && target.alive) {
      const d = Math.round(RV.grensim.damageAt(this.world, GW, ex, ey, ez, target.pos.x, target.pos.y, target.pos.z, target.h));
      if (d >= 1) this.damage(target, d, owner, { head: false, src: 'grenade', from: { x: ex, z: ez } });
    }
    for (const pl of this.p) pl.cl.send({ t: 'boom', own: pl.seat === g.owner, p: [r3(ex), r3(ey), r3(ez)] });
  }

  // ---------------------------------------------------------------------------
  // health, rounds, match
  // ---------------------------------------------------------------------------
  damage(victim, dmg, attacker, info) {
    if (!victim.alive || this.phase !== 'live' || dmg <= 0) return;
    victim.hp = Math.max(0, victim.hp - dmg);
    const kill = victim.hp <= 0;
    if (kill) victim.alive = false;
    const from = info.from || victim.pos;
    victim.cl.send({ t: 'hurt', dmg, hp: victim.hp, h: info.head ? 1 : 0, x: r3(from.x), z: r3(from.z), src: info.src });
    if (attacker) {
      attacker.hits++;
      attacker.cl.send({ t: 'hit', dmg, head: !!info.head, kill, src: info.src });
    }
    if (kill) this.checkRound();
  }

  checkRound() {
    if (this.phase !== 'live') return;
    const dead = this.p.filter((p) => !p.alive);
    if (!dead.length) return;
    this.endRound(dead.length === 2 ? -1 : 1 - dead[0].seat);
  }

  endRound(winner) {
    this.phase = 'ended';
    this.phaseAt = now();
    if (winner >= 0) this.score[winner]++;
    this.over = this.score[0] >= CFG.TO || this.score[1] >= CFG.TO;
    this.grenades.length = 0;
    for (const p of this.p) {
      p.pinAt = -1;
      p.cl.send({ t: 'roundEnd', w: winner < 0 ? 'draw' : winner === p.seat ? 'you' : 'opp', sc: [this.score[p.seat], this.score[1 - p.seat]], over: this.over, n: this.round });
    }
  }

  startRound() {
    const sp = this.map.spawns;
    const a = Math.floor(Math.random() * sp.length);
    let far = a,
      fd = -1;
    for (let i = 0; i < sp.length; i++) {
      const d = Math.hypot(sp[i].x - sp[a].x, sp[i].z - sp[a].z, (sp[i].y - sp[a].y) * 0.5) + Math.random() * 3;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    this.flip = !this.flip;
    const idx = [this.flip ? a : far, this.flip ? far : a];
    this.round++;
    this.phase = 'countdown';
    this.phaseAt = now();
    this.grenades.length = 0;
    for (const p of this.p) {
      const s = sp[idx[p.seat]];
      p.spawn = idx[p.seat];
      p.pos = { x: s.x, y: s.y, z: s.z };
      p.yaw = s.yaw;
      p.pitch = 0;
      p.sp = 0;
      p.mode = 0;
      p.h = BODY_H[0];
      p.hp = RV.MAX_HP;
      p.alive = true;
      p.hasState = true; // the spawn IS a known position: the very first snapshot is already speed-checked against it
      p.bH = 0;
      p.bV = 0;
      p.hist = [{ t: this.phaseAt, x: s.x, y: s.y, z: s.z, h: p.h }];
      p.ammo = WEAPONS.map((w) => w.mag);
      p.reload = null;
      p.grenades = GW.maxCount;
      p.nadeAt = 0;
      p.pinAt = -1;
      p.lastSt = this.phaseAt;
    }
    for (const p of this.p) {
      p.cl.send({ t: 'round', n: this.round, you: idx[p.seat], opp: idx[1 - p.seat], cd: CFG.COUNTDOWN, sc: [this.score[p.seat], this.score[1 - p.seat]] });
    }
  }

  goLive(t) {
    this.phase = 'live';
    this.phaseAt = t;
    this.liveAt = t;
    for (const p of this.p) p.lastSt = t;
    this.broadcast(() => ({ t: 'live' }));
  }

  finish(winner, reason) {
    if (this.closed) return;
    this.phase = 'over';
    this.over = true;
    for (const p of this.p) {
      p.cl.send({ t: 'matchEnd', w: winner < 0 ? 'draw' : winner === p.seat ? 'you' : 'opp', sc: [this.score[p.seat], this.score[1 - p.seat]], reason: reason || 'score', shots: p.shots, hits: p.hits });
    }
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.grenades.length = 0;
    for (const p of this.p) {
      if (p.cl.room === this) p.cl.room = null;
    }
    if (this.onClosed) this.onClosed(this);
  }

  /** A player disconnected or left: the other one wins. */
  onLeave(client, reason) {
    if (this.closed) return;
    const p = this.playerOf(client);
    const other = this.opp(p);
    if (this.phase === 'over') return this.close();
    const wasLoading = this.phase === 'loading';
    if (other.cl.alive()) {
      other.cl.send({ t: 'matchEnd', w: wasLoading ? 'none' : 'you', sc: [this.score[other.seat], this.score[p.seat]], reason: wasLoading ? 'opponent left before the start' : 'forfeit', shots: other.shots, hits: other.hits });
    }
    this.phase = 'over';
    this.close();
  }

  // ---------------------------------------------------------------------------
  // the 30 Hz tick
  // ---------------------------------------------------------------------------
  tick(t, dt) {
    if (this.closed) return;
    switch (this.phase) {
      case 'loading':
        if (this.p[0].ready && this.p[1].ready) this.startRound();
        else if (t - this.phaseAt > CFG.LOADING_TIMEOUT * 1000) {
          for (const p of this.p) p.cl.send({ t: 'matchEnd', w: 'none', sc: [0, 0], reason: 'the opponent did not load in time' });
          this.phase = 'over';
          this.close();
        }
        return;
      case 'countdown':
        if (t - this.phaseAt >= CFG.COUNTDOWN * 1000) this.goLive(t);
        break;
      case 'live': {
        this.stepGrenades(dt, t);
        for (const p of this.p) {
          if (p.reload && t >= p.reload.until) {
            p.ammo[p.reload.slot] = WEAPONS[p.reload.slot].mag;
            p.reload = null;
          }
          if (p.grenades < GW.maxCount && t >= p.nadeAt) p.grenades = GW.maxCount;
        }
        if (t - this.liveAt >= CFG.ROUND_TIME * 1000) {
          const d = this.p[0].hp - this.p[1].hp;
          this.endRound(d > 0 ? 0 : d < 0 ? 1 : -1);
        }
        break;
      }
      case 'ended':
        if (t - this.phaseAt >= (this.over ? CFG.OVER_PAUSE : CFG.ENDED_PAUSE) * 1000) {
          if (this.over) return this.finish(this.score[0] > this.score[1] ? 0 : 1, 'score');
          this.startRound();
        }
        break;
    }
    this.snapshots(t);
  }

  stepGrenades(dt, t) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.age += dt;
      let left = dt;
      while (left > 1e-6 && !g.rest) {
        const h = Math.min(left, 1 / 90);
        left -= h;
        RV.grensim.step(g, h, this.world, g.rh);
      }
      if (g.y < this.world.killY) {
        this.grenades.splice(i, 1);
        continue;
      }
      if (g.age >= GW.fuse) {
        this.grenades.splice(i, 1);
        this.explode(g);
      }
    }
  }

  snapshots(t) {
    this.snapSeq++;
    const live = this.phase === 'live';
    const rt = live ? Math.max(0, CFG.ROUND_TIME - (t - this.liveAt) / 1000) : CFG.ROUND_TIME;
    for (const p of this.p) {
      const q = this.opp(p);
      const m = {
        t: 'snap',
        n: this.snapSeq,
        rn: this.round,
        ph: PH[this.phase],
        rt: Math.round(rt * 10) / 10,
        hp: p.hp,
        sc: [this.score[p.seat], this.score[q.seat]],
        gr: p.grenades,
        gc: p.grenades > 0 ? 0 : Math.max(0, Math.round((p.nadeAt - t) / 100) / 10),
        am: p.ammo[p.slot],
      };
      if (q.hasState || this.phase === 'countdown') {
        m.o = { x: r3(q.pos.x), y: r3(q.pos.y), z: r3(q.pos.z), yw: r3(q.yaw), pt: r3(q.pitch), sp: r3(q.sp), gr: q.gr, m: q.mode, w: q.slot, al: q.alive ? 1 : 0 };
      }
      p.cl.send(m);
    }
  }
}

module.exports = { Room, PH };
