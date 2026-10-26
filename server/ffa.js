'use strict';
/*
 * The FREE-FOR-ALL room: one always-running room per map, with no rounds and no end. Anyone can join at any time and leave at any time;
 * everyone fights everyone, a player who dies is put back on a spawn a few seconds later, and the first to FFA.KILL_LIMIT eliminations wins
 * that round of the room (scores reset, nobody is thrown out).
 *
 * It is the same authority as the 1v1 room (room.js) and shares its machinery instead of copying it: the movement stepping of every player
 * from their own input stream, the speed-hack limits, corrections, bounded lag compensation, view-turn limits, the fire-rate and reload
 * rules, line-of-sight culling of what each client is told. What is different is only who can hit whom (everybody), what a death means
 * (a respawn, a point for the killer) and what the clients are told (a list of the visible players instead of one opponent).
 *
 * Joining: the client sends `ffa {map}`; the server answers `ffa` (the map, your slot and the player list), the client loads the map and
 * sends `ready`, and only then does the player exist in the world (`fspawn`): somebody still loading can neither be shot nor see anything.
 * Every life has its own number (`rn`): input and actions of an earlier life are ignored, exactly like those of an earlier round in 1v1.
 */
const { performance } = require('perf_hooks');
const S = require('./shared');
const CFG = require('./config');
const log = require('./log');
const { Room, makePlayer, modeId, r3, clamp } = require('./room');

const RV = S.RV;
const WEAPONS = RV.WEAPONS;
const GW = RV.WEAPON_BY_ID.grenade;
const FISTS = RV.WEAPON_BY_ID.fists;
const STEP = RV.PHYS.STEP;
const F = CFG.FFA;
const now = () => performance.now();

class FfaRoom {
  constructor(id, mapId, lobby) {
    this.id = 'ffa-' + mapId;
    this.mapId = mapId;
    this.map = RV.maps[mapId];
    this.world = S.worldFor(mapId);
    this.lobby = lobby;
    this.slots = new Array(F.MAX_PLAYERS).fill(null);
    this.phase = 'live'; // (the shared movement code asks: a free-for-all room is always live)
    this.round = 0;
    this.closed = false; // (never: the room runs for as long as the server does)
    this.grenades = [];
    this.snapSeq = 0;
    this.lastTickT = now();
    this.boardAt = 0;
    this.boardDirty = true;
    this.rounds = 0; // how many rounds of the room have been won
    this.cmd = { fwd: 0, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: false };
    this.fwd = { x: 0, y: 0, z: -1 };
    this.createdAt = Date.now();
    this.totals = { joins: 0, kills: 0 };
  }

  // ---------------------------------------------------------------------------------------------------------------- who is in the room
  get p() {
    return this.slots.filter(Boolean);
  }
  get count() {
    let n = 0;
    for (const s of this.slots) if (s) n++;
    return n;
  }
  get full() {
    return this.count >= F.MAX_PLAYERS;
  }
  playerOf(client) {
    const p = this.slots[client.seat];
    return p && p.cl === client ? p : null;
  }
  playerBySession(s) {
    return this.slots.find((x) => x && x.sid === s.id) || null;
  }
  /** (the shared message handlers ask for the number input must carry: here it is the player's own life) */
  roundOf(p) {
    return p.life;
  }
  /** Everybody else who can be hit. */
  foes(p) {
    return this.slots.filter((q) => q && q !== p && q.alive && !q.away);
  }

  /** Put a connected client into the room (it still has to load the map: it is not in the world until it says `ready`). */
  join(client) {
    if (this.closed) return false;
    const session = client.session;
    const old = this.playerBySession(session);
    if (old) {
      this.attach(session, client);
      return true;
    }
    const seat = this.slots.indexOf(null);
    if (seat < 0) return false;
    const p = makePlayer(client, seat, this.world);
    p.visUntil = new Array(F.MAX_PLAYERS).fill(0);
    p.life = 0;
    p.kills = 0;
    p.deaths = 0;
    p.streak = 0;
    p.waiting = true; // joined, still loading: not in the world
    p.joinedAt = now();
    p.activeAt = now();
    p.respawnAt = 0;
    p.lastHurtBy = null;
    p.lastHurtAt = 0;
    p.alive = false;
    p.gone = false;
    this.slots[seat] = p;
    client.room = this;
    client.seat = seat;
    client.state = 'room';
    session.room = this;
    this.totals.joins++;
    log.info('ffa_join', { room: this.id, sid: p.sid, name: p.name, players: this.count });
    this.sendJoin(p);
    this.boardDirty = true;
    return true;
  }

  sendJoin(p) {
    p.cl.send({ t: 'ffa', map: this.mapId, you: p.seat, cap: F.MAX_PLAYERS, kl: F.KILL_LIMIT, rs: F.RESPAWN_S, l: this.boardList() });
  }

  boardList() {
    return this.p.map((q) => [q.seat, q.name, q.kills, q.deaths, q.alive ? 1 : 0, Math.round(q.cl.rtt)]);
  }

  /** The same session on a new connection (it opened the game in another window): it loads again and gets a fresh life. */
  attach(session, client) {
    const p = this.playerBySession(session);
    if (!p) return;
    p.cl = client;
    p.name = client.name;
    client.room = this;
    client.seat = p.seat;
    client.state = 'room';
    p.waiting = true;
    p.alive = false;
    p.joinedAt = now();
    p.q.length = 0;
    p.qSteps = 0;
    p.acts.length = 0;
    this.sendJoin(p);
    this.boardDirty = true;
  }

  /** Take a player out of the room (they left, dropped, or were idle). */
  remove(p, why) {
    if (p.gone) return;
    p.gone = true;
    p.alive = false;
    this.slots[p.seat] = null;
    for (const q of this.slots) if (q) q.visUntil[p.seat] = 0;
    const s = p.cl.session;
    if (p.cl.room === this) p.cl.room = null;
    if (s && s.room === this) {
      s.room = null;
      s.expireAt = Date.now() + CFG.SESSION_IDLE_S * 1000;
    }
    if (p.cl.state === 'room') p.cl.state = 'idle';
    log.info('ffa_leave', { room: this.id, sid: p.sid, why, kills: p.kills, deaths: p.deaths, players: this.count });
    this.boardDirty = true;
  }

  onLeave(client, reason) {
    const p = this.playerOf(client);
    if (p) this.remove(p, reason || 'left');
  }

  /** The socket dropped: nothing is kept (the client simply joins again, as a new life). */
  onDisconnect(session) {
    const p = this.playerBySession(session);
    if (p) this.remove(p, 'disconnected');
  }

  // ---------------------------------------------------------------------------------------------------------------- messages
  onMessage(client, m) {
    const p = this.playerOf(client);
    if (!p) return;
    const t = now();
    switch (m.t) {
      case 'ready':
        if (p.waiting) this.spawn(p, t);
        break;
      case 'in':
        // (movement, a turn of the view or a key: that is "playing"; a player who does none of it for FFA.IDLE_S is moved out)
        for (const r of m.runs) if (r.fw || r.sd || r.fl & 7 || !p.lastRun || Math.abs(r.y - p.lastRun.y) > 1e-4 || Math.abs(r.p - p.lastRun.p) > 1e-4) p.activeAt = t;
        this.onInput(p, m, t);
        break;
      case 'act':
        p.activeAt = t;
        this.onAct(p, m, t);
        break;
      case 'leave':
        this.onLeave(client, 'left');
        break;
      case 'tp':
        if (CFG.TEST_MODE) this.onTeleport(p, m);
        break;
      case 'dbg':
        if (CFG.TEST_MODE) {
          const b = p.pl.b;
          p.cl.send({ t: 'dbg', a: p.seqDone, q: p.qSteps, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, slot: p.slot, am: p.ammo[p.slot], hp: p.hp, grounded: b.grounded ? 1 : 0, mode: p.pl.mode, st: p.pl.getState(), fx: p.fixId, kills: p.kills, deaths: p.deaths, alive: p.alive });
        }
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- spawning
  /** The spawn that is farthest from every living player (one of the three best, so it is not always the same). */
  pickSpawn(p) {
    const others = this.foes(p);
    const scored = this.map.spawns.map((s, i) => {
      let d = 1e9;
      for (const q of others) {
        const b = q.pl.b;
        d = Math.min(d, Math.hypot(b.x - s.x, b.z - s.z, (b.y - s.y) * 0.5));
      }
      return { i, s, d };
    });
    scored.sort((a, b) => b.d - a.d);
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  /** A player enters the world (first time, or after a death): fresh body, stream, weapons and a short spawn protection. */
  spawn(p, t) {
    const pick = this.pickSpawn(p);
    const s = pick.s;
    p.life++;
    p.waiting = false;
    p.alive = true;
    p.hp = RV.MAX_HP;
    p.spawn = pick.i;
    p.pl.reset(s.x, s.y, s.z, s.yaw, 0);
    p.pl.frozen = false;
    p.hist = [{ t, x: s.x, y: s.y, z: s.z, h: p.pl.b.h }];
    p.histAt = t;
    p.visUntil.fill(0);
    for (const q of this.slots) if (q) q.visUntil[p.seat] = 0;
    p.q.length = 0;
    p.qSteps = 0;
    p.acts.length = 0;
    p.recvSeq = 0;
    p.seqDone = 0;
    p.lastRun = null;
    p.lastActQ = 0;
    p.turns.length = 0;
    p.claims.length = 0;
    p.needFix = false;
    p.fixId++;
    p.ammo = WEAPONS.map((w) => w.mag);
    p.reserve = WEAPONS.map((w) => w.reserve || 0);
    p.reload = null;
    p.lastFireSim = -9;
    p.fireDebt = 0;
    p.lastPunchSim = -9;
    p.switchUntilSim = 0;
    p.lastSwitchSim = -9;
    p.pinSim = -1;
    p.slot = 0;
    p.grenades = GW.maxCount;
    p.nadeAt = 0;
    p.lastHurtBy = null;
    p.budget = 6;
    p.budgetT = t;
    p.owing = false;
    p.allowBase = 0;
    p.allowT0 = t;
    p.activeAt = t;
    p.protUntil = F.SPAWN_PROTECT_S > 0 ? t + F.SPAWN_PROTECT_S * 1000 : 0;
    p.cl.send({ t: 'fspawn', rn: p.life, st: p.pl.getState(), sp: pick.i, hp: p.hp, am: p.ammo[p.slot], rs: p.reserve[p.slot], gr: p.grenades, slot: p.slot, pr: this.protLeft(p, t), fx: p.fixId });
    this.boardDirty = true;
  }

  // ---------------------------------------------------------------------------------------------------------------- actions (all timing in simulation seconds)
  doAct(p, a, t) {
    const simT = p.seqDone * STEP;
    if (a.s !== p.slot && !this.trySwitch(p, a.s, simT)) {
      this.drop(p, 'switch_refused');
      return;
    }
    switch (a.a) {
      case 'fire':
        return this.doFire(p, t, simT);
      case 'punch':
        return this.doPunch(p, t, simT);
      case 'reload':
        return this.startReload(p, simT, true);
      case 'nadepin':
        if (p.slot === 3 && p.grenades > 0 && p.pinSim < 0 && simT >= p.switchUntilSim) p.pinSim = simT;
        return;
      case 'nadecancel':
        p.pinSim = -1;
        return;
      case 'nade':
        return this.doNade(p, t, simT);
      case 'nadeself':
        return this.doNadeSelf(p, t, simT);
    }
  }

  doFire(p, t, simT) {
    const w = WEAPONS[p.slot];
    if (w.kind !== 'gun') {
      this.violate(p, 'fire_wrong_weapon', { slot: p.slot });
      return;
    }
    if (simT < p.switchUntilSim) {
      this.drop(p, 'switching');
      return;
    }
    if (p.reload && p.reload.slot === p.slot && simT >= p.reload.doneSim - CFG.RELOAD_TOLERANCE_S) {
      const rs = p.reload.slot;
      const take = Math.min(WEAPONS[rs].mag - p.ammo[rs], p.reserve[rs]);
      p.ammo[rs] += take;
      p.reserve[rs] -= take;
      p.reload = null;
    }
    if (p.reload) {
      this.drop(p, 'reloading');
      return;
    }
    if (p.ammo[p.slot] <= 0) {
      this.drop(p, 'no_ammo');
      this.startReload(p, simT, false);
      this.violate(p, 'fire_no_ammo', {});
      return;
    }
    const gap = simT - p.lastFireSim;
    const owed = Math.max(0, p.fireDebt - Math.max(0, gap)) + w.interval;
    if (owed > w.interval + CFG.FIRE_SLACK_S) {
      this.drop(p, 'fire_rate');
      this.violate(p, 'fire_rate', { gap: r3(gap), min: r3(w.interval) });
      return;
    }
    p.fireDebt = owed;
    if (p.lastFireSim > 0 || gap < 5) {
      p.tele.minInt = Math.min(p.tele.minInt, gap);
      p.tele.sumInt += gap;
      p.tele.nInt++;
    }
    p.lastFireSim = simT;
    p.protUntil = 0; // attacking ends spawn protection
    p.ammo[p.slot]--;
    p.tele.shots++;
    if (p.ammo[p.slot] <= 0) this.startReload(p, simT, false);
    const d = this.aimOf(p, this.fwd);
    const o = this.eye(p);
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range, rh);
    const tW = hitW ? rh.t : w.range;
    let end = tW;
    // every player the shot could reach (rewound by the shooter's latency): the nearest one along the ray is hit
    let best = null;
    for (const q of this.foes(p)) {
      // (a spawn-protected player is still in the way of the bullet: it is absorbed, see damage())
      const lh = this.lagHit(p, q, t, o, d, tW, 0);
      if (lh && (!best || lh.t < best.lh.t)) best = { q, lh };
    }
    if (best) {
      end = best.lh.t;
      const head = o.y + d.y * end >= best.lh.qp.y + best.lh.qp.h - 0.3;
      const dmg = Math.round(RV.damageAt(w, end) * (head ? w.headMul || 1 : 1));
      if (head) p.tele.heads++;
      if (this.recentTurn(p) > 25) p.tele.flickHits++;
      this.damage(best.q, dmg, p, { head, src: w.id, from: o });
    }
    this.shotFx(p, w.id, o, d, end, t);
  }

  /** Tell everybody within earshot about a shot. A shooter nobody could see is only a sound (no positions). */
  shotFx(p, wid, o, d, end, t) {
    const b = p.pl.b;
    for (const q of this.slots) {
      if (!q || q === p || q.waiting || q.away) continue;
      const qb = q.pl.b;
      if (Math.hypot(qb.x - b.x, qb.y - b.y, qb.z - b.z) > F.HEAR_M) continue;
      if (this.visible(q, p, t)) q.cl.send({ t: 'fx', k: 'shot', w: wid, by: p.seat, o: [r3(o.x), r3(o.y), r3(o.z)], d: [r3(d.x), r3(d.y), r3(d.z)], e: [r3(o.x + d.x * end), r3(o.y + d.y * end), r3(o.z + d.z * end)] });
      else q.cl.send({ t: 'fx', k: 'shot', w: wid, by: p.seat });
    }
  }

  doPunch(p, t, simT) {
    if (p.slot !== 2 || simT < p.switchUntilSim) return;
    if (simT - p.lastPunchSim < FISTS.interval * CFG.FIRE_INTERVAL_TOLERANCE) {
      this.violate(p, 'melee_rate', {});
      return;
    }
    p.lastPunchSim = simT;
    p.protUntil = 0;
    p.tele.shots++;
    const d = this.aimOf(p, this.fwd);
    const o = this.eye(p);
    const b = p.pl.b;
    for (const q of this.slots) {
      if (q && q !== p && !q.waiting && !q.away && Math.hypot(q.pl.b.x - b.x, q.pl.b.z - b.z) < F.HEAR_M * 0.4) q.cl.send({ t: 'fx', k: 'punch', by: p.seat });
    }
    const range = FISTS.range + 0.4;
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, rh);
    const tW = hitW ? rh.t : range;
    let best = null;
    for (const q of this.foes(p)) {
      const lh = this.lagHit(p, q, t, o, d, tW, FISTS.reach, 0.15, 0.1);
      if (lh && (!best || lh.t < best.lh.t)) best = { q, lh };
    }
    if (best) this.damage(best.q, FISTS.dmg, p, { head: false, src: 'fists', from: o });
  }

  doNade(p, t, simT) {
    if (p.slot !== 3 || p.pinSim < 0 || p.grenades <= 0) {
      this.violate(p, 'nade_rate', { why: 'no pin' });
      return;
    }
    if (simT - p.pinSim < 0.15) {
      this.violate(p, 'nade_rate', { why: 'too fast' });
      return;
    }
    p.protUntil = 0;
    const d = this.aimOf(p, this.fwd);
    const b = p.pl.b;
    const L = RV.grensim.launch(this.world, this.eye(p), d, { vx: b.vx, vy: b.vy, vz: b.vz }, GW, {}, {});
    const g = { owner: p, x: L.sx, y: L.sy, z: L.sz, vx: L.vx, vy: L.vy, vz: L.vz, rest: false, age: 0, rh: {} };
    this.grenades.push(g);
    p.grenades--;
    p.nadeAt = t + GW.regen * 1000;
    p.pinSim = -1;
    // the throw is shown to those who can see the thrower (and to the thrower); everybody gets the explosion
    for (const q of this.slots) {
      if (!q || q.waiting || q.away) continue;
      if (q === p || this.visible(q, p, t)) q.cl.send({ t: 'nade', own: q === p, p: [r3(g.x), r3(g.y), r3(g.z)], v: [r3(g.vx), r3(g.vy), r3(g.vz)] });
    }
  }

  doNadeSelf(p, t, simT) {
    if (p.slot !== 3 || p.pinSim < 0 || p.grenades <= 0) {
      this.violate(p, 'nade_rate', { why: 'no pin' });
      return;
    }
    if (simT - p.pinSim < GW.hold.total - 0.4) {
      this.violate(p, 'nade_early', { held: r3(simT - p.pinSim) });
      return;
    }
    p.grenades--;
    p.protUntil = 0;
    p.nadeAt = t + GW.regen * 1000;
    p.pinSim = -1;
    const b = p.pl.b;
    this.explode({ owner: p, x: b.x, y: b.y, z: b.z });
  }

  explode(g) {
    const owner = g.owner;
    const ex = g.x,
      ey = g.y + 0.12,
      ez = g.z;
    for (const q of this.slots) {
      if (!q || !q.alive || q.away) continue;
      const tb = q.pl.b;
      if (q !== owner) {
        const d = Math.round(RV.grensim.damageAt(this.world, GW, ex, ey, ez, tb.x, tb.y, tb.z, tb.h));
        if (d >= 1) this.damage(q, d, owner, { head: false, src: 'grenade', from: { x: ex, z: ez } });
      }
      // the blast pushes anyone standing near it (own or somebody else's grenade): authoritative, then corrected on the client
      if (q.alive && RV.grensim.boost(this.world, q.pl, GW, ex, ey, ez)) {
        q.needFix = true;
        q.fixWhy = 'boost';
      }
    }
    for (const q of this.slots) {
      if (!q || q.waiting || q.away) continue;
      const qb = q.pl.b;
      if (q === owner || Math.hypot(qb.x - ex, qb.z - ez) < F.HEAR_M) q.cl.send({ t: 'boom', own: q === owner, p: [r3(ex), r3(ey), r3(ez)] });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- health, deaths, scores
  damage(victim, dmg, attacker, info) {
    if (!victim.alive || dmg <= 0 || victim.away || victim.gone || victim === attacker) return;
    const t = now();
    if (info.src !== 'fall' && victim.protUntil > t) {
      if (attacker && !attacker.gone) attacker.cl.send({ t: 'blk' }); // spawn protection: the shot is absorbed (the void still kills)
      return;
    }
    if (attacker && attacker !== victim) {
      victim.lastHurtBy = attacker;
      victim.lastHurtAt = t;
    }
    victim.hp = Math.max(0, victim.hp - dmg);
    const kill = victim.hp <= 0;
    let credit = attacker;
    if (kill && info.src === 'fall' && !credit && victim.lastHurtBy && !victim.lastHurtBy.gone && t - victim.lastHurtAt < F.CREDIT_S * 1000) credit = victim.lastHurtBy; // pushed or shot into the void
    const from = info.from || victim.pl.b;
    victim.cl.send({ t: 'hurt', dmg, hp: victim.hp, h: info.head ? 1 : 0, x: r3(from.x), z: r3(from.z), src: info.src, by: attacker ? attacker.seat : -1, rs: kill ? F.RESPAWN_S : 0 });
    if (attacker && !attacker.gone) {
      attacker.tele.hits++;
      attacker.cl.send({ t: 'hit', dmg, head: !!info.head, kill, src: info.src, v: victim.seat });
    }
    if (kill) this.onKill(victim, credit, info, t);
  }

  onKill(victim, killer, info, t) {
    victim.alive = false;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = t + F.RESPAWN_S * 1000;
    victim.pl.frozen = true;
    victim.pinSim = -1;
    victim.reload = null;
    this.totals.kills++;
    if (killer && killer !== victim && !killer.gone) {
      killer.kills++;
      killer.streak++;
    }
    const msg = { t: 'fkf', k: killer && killer !== victim ? killer.seat : -1, v: victim.seat, w: info.src, h: info.head ? 1 : 0 };
    for (const q of this.slots) if (q && !q.waiting) q.cl.send(msg);
    this.boardDirty = true;
    if (killer && killer !== victim && !killer.gone && killer.kills >= F.KILL_LIMIT) this.roundWon(killer);
  }

  /** Somebody reached the kill limit: say so, and everybody starts from zero again (the room itself never stops). */
  roundWon(w) {
    this.rounds++;
    log.info('ffa_round', { room: this.id, winner: w.sid, name: w.name, kills: w.kills, deaths: w.deaths, players: this.count });
    for (const q of this.slots) if (q && !q.waiting) q.cl.send({ t: 'fwin', i: w.seat, n: w.name, k: w.kills, d: w.deaths });
    for (const q of this.slots) {
      if (!q) continue;
      q.kills = 0;
      q.deaths = 0;
      q.streak = 0;
    }
    this.boardDirty = true;
  }

  protLeft(p, t) {
    return p.protUntil > t ? Math.round(((p.protUntil - t) / 1000) * 10) / 10 : 0;
  }

  // ---------------------------------------------------------------------------------------------------------------- the 30 Hz tick
  tick(t, dt) {
    const players = this.p;
    if (!players.length) {
      this.grenades.length = 0;
      this.lastTickT = t;
      return;
    }
    this.lastTickT = t;
    for (const p of players) {
      if (p.waiting) {
        if (t - p.joinedAt > F.LOAD_TIMEOUT_S * 1000) {
          p.cl.send({ t: 'matchEnd', w: 'none', sc: [0, 0], reason: 'the map did not load in time', shots: 0, hits: 0, rm: 0 });
          this.remove(p, 'load_timeout');
        }
        continue;
      }
      if (!p.alive && t >= p.respawnAt) this.spawn(p, t);
      else if (p.alive && t - p.activeAt > F.IDLE_S * 1000) {
        p.cl.send({ t: 'matchEnd', w: 'none', sc: [p.kills, p.deaths], reason: 'you were inactive for ' + F.IDLE_S + ' seconds', shots: p.tele.shots, hits: p.tele.hits, rm: 0 });
        this.remove(p, 'idle');
      }
    }
    this.stepGrenades(dt, t);
    for (const p of this.slots) {
      if (!p || p.waiting) continue;
      if (p.grenades < GW.maxCount && t >= p.nadeAt) p.grenades = GW.maxCount;
      this.advance(p, t);
      this.flushFix(p, t);
    }
    if (this.boardDirty && t - this.boardAt > 250) this.sendBoard(t);
    else if (t - this.boardAt > 2000) this.sendBoard(t); // (also the round-trip times change)
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

  sendBoard(t) {
    this.boardAt = t;
    this.boardDirty = false;
    const l = this.boardList();
    for (const q of this.slots) if (q && !q.away) q.cl.send({ t: 'fboard', l });
  }

  snapshots(t) {
    this.snapSeq++;
    for (const p of this.slots) {
      if (!p || p.waiting || p.away) continue;
      const m = {
        t: 'fsnap',
        n: this.snapSeq,
        rn: p.life,
        hp: p.hp,
        gr: p.grenades,
        gc: p.grenades > 0 ? 0 : Math.max(0, Math.round((p.nadeAt - t) / 100) / 10),
        am: p.ammo[p.slot],
        rs: p.reserve[p.slot],
        pr: this.protLeft(p, t),
        a: p.seqDone,
        os: [],
      };
      if (p.alive) {
        for (const q of this.slots) {
          if (!q || q === p || !q.alive || q.waiting || q.away) continue;
          if (!this.visible(p, q, t)) continue;
          const b = q.pl.b;
          m.os.push([q.seat, r3(b.x), r3(b.y), r3(b.z), r3(q.pl.yaw), r3(q.pl.pitch), r3(q.pl.speedH), b.grounded ? 1 : 0, modeId(q.pl), q.slot, this.protLeft(q, t) > 0 ? 1 : 0]);
        }
      }
      p.cl.send(m);
    }
  }

  /** Summary for /debug/rooms and /health. */
  summary() {
    return { id: this.id, map: this.mapId, players: this.count, cap: F.MAX_PLAYERS, rounds: this.rounds, joins: this.totals.joins, kills: this.totals.kills };
  }
}

// the machinery shared with the 1v1 room (it only needs `this.world`, the player records and a few hooks)
for (const k of ['onInput', 'onAct', 'drop', 'advance', 'stepOne', 'runActs', 'checkClaim', 'flushFix', 'recordHist', 'histAt', 'lagHit', 'recentTurn', 'eye', 'aimOf', 'trySwitch', 'startReload', 'los', 'visible', 'violate', 'onTeleport']) {
  FfaRoom.prototype[k] = Room.prototype[k];
}

module.exports = { FfaRoom };
