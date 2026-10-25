'use strict';
/*
 * One isolated 1v1 match. The room is the AUTHORITY for everything that decides the result:
 *
 *   server decides                                  client does (and the server only checks)
 *   --------------------------------------------    ------------------------------------------------------
 *   where every player is: the server runs the      sends its INPUT (keys, view angles) and predicts its own
 *   same movement physics (js/player.js) from       movement so it feels instant; applies the server's
 *   those inputs, so a position can only be what    corrections (reconciliation)
 *   the physics allows (no teleports, no speed
 *   hacks, no wall clipping, no extra jumps)
 *   health, damage, headshots, deaths, respawns     asks ("fire", "reload", "throw") - never says what happened
 *   ammo, reloads, fire rate, weapon stock
 *   grenade flight, fuse, blast, blast push
 *   rounds, score, countdown, spawns, winners
 *   what each client is told about the opponent
 *
 * Timing of weapons is measured in SIMULATION time (steps of the player's own input stream) rather than the
 * arrival time of packets, so a lag spike that delivers three shots at once cannot make an honest player look
 * like a cheater, and a cheater cannot gain time: input is only simulated as fast as real time allows.
 *
 * Shots are never trusted: they carry no direction. The server aims with the view angles the player's inputs
 * describe (turn-rate limited), takes the shooter's origin from ITS OWN simulation, and tests the ray against the
 * opponent's position REWOUND by the shooter's measured latency (bounded lag compensation) and the map's walls.
 */
const { performance } = require('perf_hooks');
const S = require('./shared');
const CFG = require('./config');
const log = require('./log');

const RV = S.RV;
const WEAPONS = RV.WEAPONS;
const GW = RV.WEAPON_BY_ID.grenade;
const FISTS = RV.WEAPON_BY_ID.fists;
const N = RV.NETP;
const STEP = RV.PHYS.STEP;

const EYE = [1.62, 0.95, 0.78]; // eye height above the feet: stand / crouch / slide
const HW = 0.35; // player half width
const PH = { loading: 0, countdown: 1, live: 2, ended: 3, over: 4 };
const TAU = Math.PI * 2;

const now = () => performance.now();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const wrap = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
const modeId = (pl) => (pl.mode === 'slide' ? 2 : pl.mode === 'crouch' ? 1 : 0);

function makePlayer(client, seat, world) {
  const pl = new RV.Player(world);
  pl.frozen = true;
  return {
    cl: client,
    sid: client.session.id,
    name: client.name,
    seat,
    ready: false,
    rematch: false,
    pl,
    spawn: 0,
    turns: [], // recent view turn rates by input step (aim telemetry)
    slot: 0,
    hp: RV.MAX_HP,
    alive: false,
    away: false,
    awayAt: 0,
    hist: [],
    histAt: 0,
    visUntil: [0, 0],
    // input stream
    q: [],
    qSteps: 0,
    acts: [],
    recvSeq: 0,
    seqDone: 0,
    budget: 0,
    budgetT: 0,
    allowBase: 0, // the speed-hack limit counts from here: steps received so far at allowT0 ...
    allowT0: 0, // ... and the wall clock (ms) when counting began
    lastRun: null,
    lastActQ: 0,
    claims: [],
    fixId: 0,
    needFix: false,
    fixWhy: '',
    lastFixAt: 0,
    // weapons (times in simulation seconds)
    ammo: WEAPONS.map((w) => w.mag),
    reserve: WEAPONS.map((w) => w.reserve || 0), // spare rounds per slot
    protUntil: 0, // spawn protection: no damage until this wall-clock time (ms), or until the player attacks
    reload: null,
    lastFireSim: -9,
    fireDebt: 0,
    lastPunchSim: -9,
    switchUntilSim: 0,
    lastSwitchSim: -9,
    pinSim: -1,
    grenades: GW.maxCount,
    nadeAt: 0,
    tele: freshTele(),
  };
}

function freshTele() {
  return { shots: 0, hits: 0, heads: 0, minInt: 99, sumInt: 0, nInt: 0, maxTurn: 0, flickHits: 0, fixes: 0, mism: 0, stepsIn: 0, violations: 0, fireActs: 0, drops: {} };
}

class Room {
  /** onClosed(room) is called once, when the match is over and both players are free again. a, b = Clients (with a session). */
  constructor(id, mapId, a, b, onClosed) {
    this.id = id;
    this.mapId = mapId;
    this.map = RV.maps[mapId];
    this.world = S.worldFor(mapId);
    this.onClosed = onClosed;
    this.p = [makePlayer(a, 0, this.world), makePlayer(b, 1, this.world)];
    this.phase = 'loading';
    this.phaseAt = now();
    this.lastTickT = now();
    this.round = 0;
    this.score = [0, 0];
    this.flip = false;
    this.over = false;
    this.overAt = 0;
    this.result = null;
    this.grenades = [];
    this.closed = false;
    this.liveAt = 0;
    this.snapSeq = 0;
    this.cmd = { fwd: 0, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: false };
    this.fwd = { x: 0, y: 0, z: -1 };
    this.createdAt = Date.now();
    for (const p of this.p) {
      p.cl.room = this;
      p.cl.seat = p.seat;
    }
    this.announce();
  }

  /** Tell both players the match exists (also used for a rematch). */
  announce() {
    for (const p of this.p) p.cl.send({ t: 'match', room: this.id, map: this.mapId, seat: p.seat, opp: this.opp(p).name, to: CFG.TO, cd: CFG.COUNTDOWN });
  }

  opp(p) {
    return this.p[1 - p.seat];
  }
  playerOf(client) {
    return this.p[client.seat];
  }
  playerBySession(s) {
    return this.p.find((x) => x.sid === s.id);
  }
  violate(p, rule, detail) {
    p.tele.violations++;
    return p.cl.lobby.violate(p.cl, rule, detail);
  }

  // ---------------------------------------------------------------------------
  // messages (already validated and cleaned by schema.js)
  // ---------------------------------------------------------------------------
  onMessage(client, m) {
    if (this.closed) return;
    const p = this.playerOf(client);
    if (!p || p.cl !== client) return;
    const t = now();
    switch (m.t) {
      case 'ready':
        if (this.phase === 'loading') p.ready = true;
        break;
      case 'in':
        this.onInput(p, m, t);
        break;
      case 'act':
        this.onAct(p, m, t);
        break;
      case 'rematch':
        this.onRematch(p);
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
          p.cl.send({ t: 'dbg', a: p.seqDone, q: p.qSteps, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, slot: p.slot, am: p.ammo[p.slot], hp: p.hp, grounded: b.grounded ? 1 : 0, mode: p.pl.mode, st: p.pl.getState(), fx: p.fixId });
        }
        break;
    }
  }

  /** A batch of input: queued, then simulated as fast as real time allows. */
  onInput(p, m, t) {
    if (!p.alive || p.away) return;
    if (m.rn !== this.round || (this.phase !== 'live' && this.phase !== 'ended')) return; // a stale batch from the last round
    if (m.q !== p.recvSeq) {
      this.violate(p, m.q < p.recvSeq ? 'seq_dup' : 'seq_gap', { got: m.q, want: p.recvSeq });
      return;
    }
    // speed-hack limit: a real client produces 120 steps a second of real time, so what it has sent can never be
    // more than the round clock allows (plus a few seconds of slack that cover network stalls delivering a lump)
    const allowed = p.allowBase + ((t - p.allowT0) / 1000) * N.HZ + CFG.MOVE.INPUT_SLACK_STEPS;
    if (p.recvSeq + m.steps > allowed || p.qSteps + m.steps > CFG.MOVE.INPUT_QUEUE_MAX) {
      this.violate(p, 'input_overflow', { queued: p.qSteps, adding: m.steps, ahead: Math.round(p.recvSeq + m.steps - allowed) });
      return;
    }
    let tooFast = false;
    for (const r of m.runs) {
      const startSeq = p.recvSeq;
      let y = r.y,
        pt = r.p;
      const last = p.lastRun;
      if (last) {
        // the view may only turn as fast as a human can: anything beyond is clamped (and counted)
        const dt = Math.max(last.k, 1) * STEP;
        const maxD = CFG.MOVE.MAX_TURN_RATE * dt + CFG.MOVE.TURN_SLACK;
        const dy = wrap(y - last.y),
          dp = pt - last.p;
        const rate = Math.hypot(dy, dp) / dt;
        if (rate > p.tele.maxTurn) p.tele.maxTurn = rate;
        p.turns.push({ s: startSeq, r: rate });
        if (p.turns.length > 40) p.turns.shift();
        if (Math.abs(dy) > maxD) {
          y = wrap(last.y + Math.sign(dy) * maxD);
          tooFast = true;
        }
        if (Math.abs(dp) > maxD) {
          pt = last.p + Math.sign(dp) * maxD;
          tooFast = true;
        }
      }
      p.lastRun = { y, p: pt, k: r.k };
      p.q.push({ k: r.k, fw: r.fw, sd: r.sd, fl: r.fl, y, p: pt, w: r.w });
      p.qSteps += r.k;
      p.recvSeq += r.k;
      p.tele.stepsIn += r.k;
    }
    if (tooFast) this.violate(p, 'aim_rate', {});
    if (m.c) {
      p.claims.push({ seq: p.recvSeq, x: m.c.x, y: m.c.y, z: m.c.z, fx: m.c.fx });
      if (p.claims.length > 12) p.claims.shift();
    }
    this.advance(p, t);
    this.flushFix(p, t);
  }

  /** A discrete request. It is executed when the simulation has reached the step the client sent it at. */
  onAct(p, m, t) {
    if (m.a === 'fire') p.tele.fireActs++;
    if (m.rn !== this.round) {
      this.drop(p, 'stale_round');
      return;
    }
    if (!p.alive) {
      this.drop(p, 'dead');
      if (this.phase === 'live' || this.phase === 'ended') this.violate(p, 'fire_dead', { a: m.a }); // a dead player acting is impossible for an honest client
      return;
    }
    if (this.phase !== 'live' || p.away) {
      this.drop(p, 'not_live');
      return;
    }
    if (m.q > p.recvSeq) {
      this.drop(p, 'act_future');
      this.violate(p, 'act_future', { q: m.q, have: p.recvSeq });
      return;
    }
    if (m.q < p.lastActQ) {
      this.drop(p, 'act_order');
      this.violate(p, 'act_order', { q: m.q, last: p.lastActQ });
      return;
    }
    if (p.acts.length >= 64) {
      this.drop(p, 'queue_full');
      return;
    }
    p.lastActQ = m.q;
    p.acts.push({ q: m.q, a: m.a, s: m.s });
    this.advance(p, t);
    this.flushFix(p, t);
  }

  /** Count an action the server ignored (telemetry only: it shows why a click did nothing; see /debug/rooms). */
  drop(p, why) {
    p.tele.drops[why] = (p.tele.drops[why] || 0) + 1;
  }

  // ---------------------------------------------------------------------------
  // the movement simulation
  // ---------------------------------------------------------------------------
  /**
   * Step the player's own physics with queued input. A player earns 120 steps per real second (plus a short burst
   * allowance for a stall); steps beyond that wait in the queue, so input can never run faster than real time.
   */
  advance(p, t) {
    if (!p.alive || p.away || (this.phase !== 'live' && this.phase !== 'ended')) {
      p.budgetT = t;
      return;
    }
    // 120 steps per real second; a backlog (after a network or server stall) is worked off a bit faster than real time,
    // otherwise the player's avatar would stay late for the rest of the round. The speed-hack limit in onInput bounds
    // how much input can exist at all, so this cannot be used to run faster than the clock in total.
    const rate = N.HZ * (p.qSteps > CFG.MOVE.CATCHUP_MIN_STEPS ? CFG.MOVE.CATCHUP : 1);
    p.budget = Math.min(CFG.MOVE.INPUT_BURST_STEPS, p.budget + ((t - p.budgetT) / 1000) * rate);
    p.budgetT = t;
    this.runActs(p, t);
    this.checkClaim(p);
    while (p.q.length && p.budget >= 1 && p.alive && (this.phase === 'live' || this.phase === 'ended')) {
      const e = p.q[0];
      if (e.w !== p.slot && !e.swTried) {
        e.swTried = true; // one attempt per run (a refused switch must not be re-counted on every step)
        this.trySwitch(p, e.w, p.seqDone * STEP);
      }
      this.stepOne(p, e);
      p.budget -= 1;
      p.qSteps -= 1;
      if (--e.k <= 0) p.q.shift();
      this.runActs(p, t);
      this.checkClaim(p);
    }
    this.recordHist(p, t);
  }

  stepOne(p, e) {
    const pl = p.pl;
    N.cmdFrom(e.fw, e.sd, e.fl, this.cmd);
    pl.autoHop = (e.fl & N.F_AUTOHOP) !== 0;
    pl.yaw = e.y;
    pl.pitch = e.p;
    pl.djEnabled = !!WEAPONS[p.slot].doubleJump; // the extra jump exists only while the server says the Fists are in hand
    pl.step(STEP, this.cmd);
    p.seqDone++;
    const b = pl.b;
    if (p.reload && p.seqDone * STEP >= p.reload.doneSim) {
      const rs = p.reload.slot;
      const take = Math.min(WEAPONS[rs].mag - p.ammo[rs], p.reserve[rs]);
      p.ammo[rs] += take;
      p.reserve[rs] -= take;
      p.reload = null;
    }
    if (b.y < this.world.killY && this.phase === 'live') this.damage(p, 9999, null, { src: 'fall', from: b });
  }

  runActs(p, t) {
    while (p.acts.length && p.acts[0].q <= p.seqDone && p.alive) this.doAct(p, p.acts.shift(), t);
  }

  /** Compare the client's predicted position at a step with the simulation's; a difference triggers a correction. */
  checkClaim(p) {
    while (p.claims.length && p.claims[0].seq < p.seqDone) p.claims.shift();
    const c = p.claims[0];
    if (!c || c.seq !== p.seqDone) return;
    p.claims.shift();
    if (c.fx !== p.fixId) return; // made before the client applied my last correction: not comparable
    const b = p.pl.b;
    if (Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) > CFG.MOVE.CLAIM_EPS) {
      p.needFix = true;
      p.fixWhy = 'mismatch';
      p.tele.mism++;
      this.violate(p, 'prediction_mismatch', { d: r3(Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z)) });
    }
  }

  /** Send the full movement state so the client can snap to it and replay what the server has not simulated yet. */
  flushFix(p, t) {
    if (!p.needFix || p.away || !p.cl.alive()) return;
    if (t - p.lastFixAt < CFG.MOVE.FIX_MIN_MS) return;
    p.needFix = false;
    p.lastFixAt = t;
    p.fixId++;
    p.claims.length = 0;
    p.tele.fixes++;
    p.cl.send({ t: 'fix', id: p.fixId, a: p.seqDone, st: p.pl.getState(), why: p.fixWhy });
  }

  recordHist(p, t) {
    if (t - p.histAt < 8 && p.hist.length) return;
    p.histAt = t;
    const b = p.pl.b;
    p.hist.push({ t, x: b.x, y: b.y, z: b.z, h: b.h });
    while (p.hist.length > 2 && t - p.hist[0].t > CFG.LAG.HIST_MS) p.hist.shift();
  }

  /** Where `q` was at server time `t` (interpolated from its simulated history). */
  histAt(q, t) {
    const h = q.hist;
    const b = q.pl.b;
    if (!h.length) return { x: b.x, y: b.y, z: b.z, h: b.h };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1],
          c = h[i];
        const k = clamp((t - a.t) / (c.t - a.t || 1), 0, 1);
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, h: c.h };
      }
    }
    return h[h.length - 1];
  }

  /**
   * Lag compensation: the opponent as the shooter saw them when they clicked. The base estimate is the shooter's round trip plus the
   * interpolation delay of the clients; because that is only an estimate (jitter, a ping sample that is a little old) two neighbours in
   * time are tried as well, and the box is a little wider and taller than the body (CFG.LAG). The nearest hit along the ray wins.
   * Returns {t, qp} (hit distance along the ray and where the target was) or null.
   */
  lagHit(shooter, q, t, o, d, maxT, pad, yLo, yHi) {
    const L = CFG.LAG;
    const base = clamp(shooter.cl.rttLC + L.INTERP_MS, 0, L.MAX_REWIND_MS);
    const offs = L.JITTER_MS > 0 ? [0, L.JITTER_MS, -L.JITTER_MS] : [0];
    const px = HW + L.TOL_XZ + pad;
    const lo = yLo == null ? L.TOL_Y : yLo,
      hi = yHi == null ? L.TOL_Y : yHi;
    let best = null;
    for (const off of offs) {
      const qp = this.histAt(q, t - clamp(base + off, 0, L.MAX_REWIND_MS));
      const hit = RV.rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, qp.x - px, qp.y - lo, qp.z - px, qp.x + px, qp.y + qp.h + hi, qp.z + px, maxT);
      if (hit >= 0 && (!best || hit < best.t)) best = { t: hit, qp };
    }
    return best;
  }

  /** The fastest view turn (rad/s) in the last 0.1 s of the player's input. */
  recentTurn(p) {
    let m = 0;
    for (const x of p.turns) if (x.s >= p.seqDone - 12 && x.s <= p.seqDone + 1 && x.r > m) m = x.r;
    return m;
  }

  eye(p) {
    const b = p.pl.b;
    return { x: b.x, y: b.y + EYE[modeId(p.pl)], z: b.z };
  }

  /** The view the player's input stream describes right now (before any step: the first queued input). */
  aimOf(p, out) {
    const e = p.seqDone === 0 && p.q.length ? p.q[0] : null;
    const yaw = e ? e.y : p.pl.yaw,
      pitch = e ? e.p : p.pl.pitch;
    const cp = Math.cos(pitch);
    out.x = -Math.sin(yaw) * cp;
    out.y = Math.sin(pitch);
    out.z = -Math.cos(yaw) * cp;
    return out;
  }

  // ---------------------------------------------------------------------------
  // actions (all timing in simulation seconds)
  // ---------------------------------------------------------------------------
  trySwitch(p, slot, simT) {
    if (slot === p.slot) return true;
    if (simT - p.lastSwitchSim < 0.05) {
      this.violate(p, 'weapon_switch_rate', {});
      return false;
    }
    p.slot = slot;
    p.reload = null; // switching cancels a reload and a held grenade
    p.pinSim = -1;
    p.lastSwitchSim = simT;
    p.switchUntilSim = simT + WEAPONS[slot].switchTime * 0.8;
    return true;
  }

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

  startReload(p, simT, report) {
    const w = WEAPONS[p.slot];
    if (w.kind !== 'gun' || p.reload || p.ammo[p.slot] >= w.mag || simT < p.switchUntilSim || p.reserve[p.slot] <= 0) {
      if (report && (w.kind !== 'gun' || (!p.reload && p.ammo[p.slot] >= w.mag))) this.violate(p, 'reload_invalid', {});
      return; // (no spare rounds left: nothing to reload, not a violation)
    }
    p.reload = { slot: p.slot, doneSim: simT + w.reload };
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
    // the browser's reload timer runs on the wall clock, the server's in simulation steps: a shot a hair early still counts as after the reload
    if (p.reload && p.reload.slot === p.slot && simT >= p.reload.doneSim - CFG.RELOAD_TOLERANCE_S) {
      const rs = p.reload.slot;
      const take = Math.min(WEAPONS[rs].mag - p.ammo[rs], p.reserve[rs]);
      p.ammo[rs] += take;
      p.reserve[rs] -= take;
      p.reload = null;
    }
    if (p.reload) {
      this.drop(p, 'reloading');
      return; // (the client does not shoot while reloading either; see finishReloads for the small timing margin)
    }
    if (p.ammo[p.slot] <= 0) {
      this.drop(p, 'no_ammo');
      this.startReload(p, simT, false);
      this.violate(p, 'fire_no_ammo', {});
      return;
    }
    const gap = simT - p.lastFireSim;
    // fire rate = a leaky bucket of "owed" firing time: every shot adds one interval, time drains it. A long frame in the browser fires two
    // shots in one go (the same step number): that is forgiven up to CFG.FIRE_SLACK_S, but the average rate can never beat the interval.
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
    // the origin is the server's own simulated position; the direction is the view the player's inputs describe
    const d = this.aimOf(p, this.fwd);
    const o = this.eye(p);
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range, rh);
    const tW = hitW ? rh.t : w.range;
    let end = tW;
    const q = this.opp(p);
    if (q.alive && !q.away) {
      // the shooter saw the opponent about (their round trip + the interpolation delay) ago; never further back than the cap
      const lh = this.lagHit(p, q, t, o, d, tW, 0);
      if (lh) {
        const hit = lh.t;
        end = hit;
        const head = o.y + d.y * hit >= lh.qp.y + lh.qp.h - 0.3;
        const dmg = Math.round(RV.damageAt(w, hit) * (head ? w.headMul || 1 : 1));
        if (head) p.tele.heads++;
        if (this.recentTurn(p) > 25) p.tele.flickHits++; // a hit right after a very fast flick (telemetry only)
        this.damage(q, dmg, p, { head, src: w.id, from: o });
      }
    }
    this.shotFx(p, q, w.id, o, d, end, t);
  }

  /** Tell the target about a shot. If the shooter could not be seen the message carries no positions (just the sound). */
  shotFx(p, q, wid, o, d, end, t) {
    if (this.visible(q, p, t)) q.cl.send({ t: 'fx', k: 'shot', w: wid, o: [r3(o.x), r3(o.y), r3(o.z)], d: [r3(d.x), r3(d.y), r3(d.z)], e: [r3(o.x + d.x * end), r3(o.y + d.y * end), r3(o.z + d.z * end)] });
    else q.cl.send({ t: 'fx', k: 'shot', w: wid });
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
    const q = this.opp(p);
    q.cl.send({ t: 'fx', k: 'punch' });
    if (!q.alive || q.away) return;
    const range = FISTS.range + 0.4;
    const rh = {};
    const hitW = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, rh);
    const tW = hitW ? rh.t : range;
    const lh = this.lagHit(p, q, t, o, d, tW, FISTS.reach, 0.15, 0.1);
    const hit = lh ? lh.t : -1;
    if (hit >= 0) this.damage(q, FISTS.dmg, p, { head: false, src: 'fists', from: o });
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
    const g = { owner: p.seat, x: L.sx, y: L.sy, z: L.sz, vx: L.vx, vy: L.vy, vz: L.vz, rest: false, age: 0, rh: {} };
    this.grenades.push(g);
    p.grenades--;
    p.nadeAt = t + GW.regen * 1000;
    p.pinSim = -1;
    // the throw (start point and flight) is shown to the opponent only if they can see the thrower: a grenade thrown from
    // behind a wall must not reveal where the thrower stands. They still get the explosion (a loud, bright world event).
    for (const pl of this.p) {
      if (pl.seat === p.seat || this.visible(pl, p, t)) pl.cl.send({ t: 'nade', own: pl.seat === p.seat, p: [r3(g.x), r3(g.y), r3(g.z)], v: [r3(g.vx), r3(g.vy), r3(g.vz)] });
    }
  }

  /** The player held the grenade for the full hold time: it explodes on the thrower (a boost; damages only the enemy). */
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
    this.explode({ owner: p.seat, x: b.x, y: b.y, z: b.z });
  }

  explode(g) {
    const owner = this.p[g.owner];
    const target = this.opp(owner);
    const ex = g.x,
      ey = g.y + 0.12,
      ez = g.z;
    if (this.phase === 'live' && target.alive && !target.away) {
      const tb = target.pl.b;
      const d = Math.round(RV.grensim.damageAt(this.world, GW, ex, ey, ez, tb.x, tb.y, tb.z, tb.h));
      if (d >= 1) this.damage(target, d, owner, { head: false, src: 'grenade', from: { x: ex, z: ez } });
    }
    // the blast pushes anyone standing near it (own or enemy grenade): authoritative, then corrected on the client
    if (this.phase === 'live') {
      for (const p of this.p) {
        if (p.alive && !p.away && RV.grensim.boost(this.world, p.pl, GW, ex, ey, ez)) {
          p.needFix = true;
          p.fixWhy = 'boost';
        }
      }
    }
    for (const pl of this.p) pl.cl.send({ t: 'boom', own: pl.seat === g.owner, p: [r3(ex), r3(ey), r3(ez)] });
  }

  // ---------------------------------------------------------------------------
  // health, rounds, match
  // ---------------------------------------------------------------------------
  damage(victim, dmg, attacker, info) {
    if (!victim.alive || this.phase !== 'live' || dmg <= 0 || victim.away) return;
    if (info.src !== 'fall' && victim.protUntil > now()) {
      // spawn protection: the shot is absorbed (the void still kills)
      if (attacker) attacker.cl.send({ t: 'blk' });
      return;
    }
    victim.hp = Math.max(0, victim.hp - dmg);
    const kill = victim.hp <= 0;
    if (kill) victim.alive = false;
    const from = info.from || victim.pl.b;
    victim.cl.send({ t: 'hurt', dmg, hp: victim.hp, h: info.head ? 1 : 0, x: r3(from.x), z: r3(from.z), src: info.src });
    if (attacker) {
      attacker.tele.hits++;
      attacker.cl.send({ t: 'hit', dmg, head: !!info.head, kill, src: info.src });
    }
    if (kill) this.checkRound();
  }

  /** Seconds of spawn protection left for a player (0 = none). */
  protLeft(p, t) {
    return p.protUntil > t ? Math.round(((p.protUntil - t) / 1000) * 10) / 10 : 0;
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
      p.pinSim = -1;
      p.cl.send({ t: 'roundEnd', w: winner < 0 ? 'draw' : winner === p.seat ? 'you' : 'opp', sc: [this.score[p.seat], this.score[1 - p.seat]], over: this.over, n: this.round });
    }
  }

  startRound() {
    const sp = this.map.spawns;
    this.recentSpawns = this.recentSpawns || [];
    const [a, far] = RV.pickSpawnPair(sp, this.recentSpawns); // a different place than the last rounds, never next to the opponent
    this.flip = !this.flip;
    const idx = [this.flip ? a : far, this.flip ? far : a];
    this.round++;
    this.phase = 'countdown';
    this.phaseAt = now();
    this.grenades.length = 0;
    for (const p of this.p) {
      const s = sp[idx[p.seat]];
      p.spawn = idx[p.seat];
      p.pl.reset(s.x, s.y, s.z, s.yaw, 0);
      p.pl.frozen = true; // locked in the spawn for the countdown (the client mirrors this)
      p.hp = RV.MAX_HP;
      p.alive = true;
      p.hist = [{ t: this.phaseAt, x: s.x, y: s.y, z: s.z, h: p.pl.b.h }];
      p.histAt = this.phaseAt;
      p.visUntil = [0, 0];
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
      p.ammo = WEAPONS.map((w) => w.mag);
      p.reserve = WEAPONS.map((w) => w.reserve || 0);
      p.protUntil = 0;
      p.reload = null;
      p.lastFireSim = -9;
      p.fireDebt = 0;
      p.lastPunchSim = -9;
      p.switchUntilSim = 0;
      p.lastSwitchSim = -9;
      p.pinSim = -1;
      p.grenades = GW.maxCount;
      p.nadeAt = 0;
    }
    // (the opponent's spawn is deliberately not told: they may be anywhere behind the walls)
    for (const p of this.p) p.cl.send({ t: 'round', n: this.round, you: idx[p.seat], cd: CFG.COUNTDOWN, sc: [this.score[p.seat], this.score[1 - p.seat]] });
  }

  goLive(t) {
    this.phase = 'live';
    this.phaseAt = t;
    this.liveAt = t;
    for (const p of this.p) {
      p.pl.frozen = false;
      p.budget = 6;
      p.budgetT = t;
      p.allowBase = p.recvSeq;
      p.allowT0 = t;
      p.protUntil = CFG.SPAWN_PROTECT_S > 0 ? t + CFG.SPAWN_PROTECT_S * 1000 : 0;
    }
    this.broadcast(() => ({ t: 'live' }));
  }

  broadcast(fn) {
    for (const p of this.p) p.cl.send(fn(p));
  }

  /** End the match with a winner (seat) and a reason. Players may agree to a rematch for a while unless someone left. */
  finish(winner, reason, noRematch) {
    if (this.closed || this.phase === 'over') return;
    this.phase = 'over';
    this.over = true;
    this.overAt = now();
    this.result = { winner, reason: reason || 'score' };
    for (const p of this.p) {
      p.rematch = false;
      p.cl.send({ t: 'matchEnd', w: winner < 0 ? 'draw' : winner === p.seat ? 'you' : 'opp', sc: [this.score[p.seat], this.score[1 - p.seat]], reason: reason || 'score', shots: p.tele.shots, hits: p.tele.hits, rm: noRematch ? 0 : CFG.REMATCH_WINDOW_S });
    }
    this.logMatchEnd(winner, reason || 'score');
    if (noRematch) this.close();
  }

  logMatchEnd(winner, reason) {
    const players = this.p.map((p) => {
      const tl = p.tele;
      const hr = tl.hits ? tl.heads / tl.hits : 0;
      const suspicious = [];
      if (tl.hits >= 15 && hr > 0.85) suspicious.push('headshot_ratio');
      if (tl.hits >= 8 && tl.flickHits / tl.hits > 0.6) suspicious.push('flick_hits');
      if (tl.mism >= 20) suspicious.push('prediction_mismatch');
      return { sid: p.sid, shots: tl.shots, hits: tl.hits, heads: tl.heads, minFireInterval: tl.minInt === 99 ? null : r3(tl.minInt), maxTurnRate: r3(tl.maxTurn), flickHits: tl.flickHits, corrections: tl.fixes, mismatches: tl.mism, violations: tl.violations, rtt: Math.round(p.cl.rtt), suspicious };
    });
    const flagged = players.filter((x) => x.suspicious.length);
    (flagged.length ? log.sec : log.info)('match_end', { room: this.id, map: this.mapId, score: this.score.join('-'), winner, reason, rounds: this.round, players });
  }

  /** Someone left on purpose or never came back: the other one wins, no rematch. */
  forfeit(p, reason) {
    if (this.closed) return;
    const wasLoading = this.phase === 'loading';
    const other = this.opp(p);
    if (wasLoading) {
      if (other.cl.alive()) other.cl.send({ t: 'matchEnd', w: 'none', sc: [0, 0], reason: 'opponent left before the start', shots: 0, hits: 0, rm: 0 });
      this.phase = 'over';
      return this.close();
    }
    this.finish(other.seat, 'forfeit', true);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.grenades.length = 0;
    for (const p of this.p) if (p.cl.room === this) p.cl.room = null;
    if (this.onClosed) this.onClosed(this);
  }

  /** Something went wrong inside the room: tell the players plainly and shut it. */
  abort(reason) {
    if (this.closed) return;
    for (const p of this.p) p.cl.send({ t: 'matchEnd', w: 'none', sc: [this.score[p.seat], this.score[1 - p.seat]], reason, shots: 0, hits: 0, rm: 0 });
    this.phase = 'over';
    this.close();
  }

  /** Explicit leave. */
  onLeave(client, reason) {
    if (this.closed) return;
    const p = this.playerOf(client);
    if (!p) return;
    if (this.phase === 'over') {
      this.opp(p).cl.send({ t: 'rematch', st: 'left' });
      return this.close();
    }
    log.info('player_left', { room: this.id, sid: p.sid, reason, phase: this.phase });
    this.forfeit(p, reason);
  }

  // ---------------------------------------------------------------------------
  // disconnects, reconnection, rematch
  // ---------------------------------------------------------------------------
  /** The socket of a player dropped (not a deliberate leave). */
  onDisconnect(session) {
    if (this.closed) return;
    const p = this.playerBySession(session);
    if (!p) return;
    if (this.phase === 'loading') return this.forfeit(p, 'disconnected');
    if (this.phase === 'over') {
      this.opp(p).cl.send({ t: 'rematch', st: 'left' });
      return this.close();
    }
    p.away = true;
    p.awayAt = now();
    p.q.length = 0;
    p.qSteps = 0;
    p.acts.length = 0;
    log.info('player_away', { room: this.id, sid: p.sid, phase: this.phase, graceS: CFG.RECONNECT_GRACE_S });
    this.opp(p).cl.send({ t: 'opp', st: 'away', g: CFG.RECONNECT_GRACE_S });
  }

  /** A (new) connection takes over this session's seat: resume the match where it stands. */
  attach(session, client) {
    if (this.closed) return;
    const p = this.playerBySession(session);
    if (!p) return;
    const wasAway = p.away;
    p.cl = client;
    p.name = client.name;
    client.room = this;
    client.seat = p.seat;
    client.state = 'room';
    p.away = false;
    // the new connection starts from the server's state: nothing queued, no stale claims
    p.q.length = 0;
    p.qSteps = 0;
    p.acts.length = 0;
    p.recvSeq = p.seqDone;
    p.lastRun = null;
    p.lastActQ = p.seqDone;
    p.claims.length = 0;
    p.fixId++;
    p.budgetT = now();
    p.allowBase = p.recvSeq; // the speed-hack limit starts over from the server's state (the clocks stood still while away)
    p.allowT0 = p.budgetT;
    if (wasAway) {
      log.info('player_back', { room: this.id, sid: p.sid, awayMs: Math.round(now() - p.awayAt) });
      this.opp(p).cl.send({ t: 'opp', st: 'back' });
    }
    if (this.phase === 'loading') {
      p.ready = false;
      client.send({ t: 'match', room: this.id, map: this.mapId, seat: p.seat, opp: this.opp(p).name, to: CFG.TO, cd: CFG.COUNTDOWN });
    } else if (this.phase === 'over') {
      const w = this.result ? this.result.winner : -1;
      client.send({ t: 'matchEnd', w: w < 0 ? 'draw' : w === p.seat ? 'you' : 'opp', sc: [this.score[p.seat], this.score[1 - p.seat]], reason: this.result ? this.result.reason : 'score', shots: p.tele.shots, hits: p.tele.hits, rm: Math.max(0, Math.round(CFG.REMATCH_WINDOW_S - (now() - this.overAt) / 1000)) });
    } else client.send(this.resumeMessage(p));
  }

  resumeMessage(p) {
    const t = now();
    const q = this.opp(p);
    return {
      t: 'resume',
      map: this.mapId,
      seat: p.seat,
      opp: q.name,
      to: CFG.TO,
      n: this.round,
      ph: PH[this.phase],
      sc: [this.score[p.seat], this.score[q.seat]],
      you: p.spawn,
      hp: p.hp,
      am: p.ammo[p.slot],
      rs: p.reserve[p.slot],
      pr: this.protLeft(p, t),
      gr: p.grenades,
      slot: p.slot,
      alive: p.alive ? 1 : 0,
      ack: p.seqDone,
      fx: p.fixId,
      st: p.pl.getState(),
      rt: this.phase === 'live' ? Math.max(0, Math.round((CFG.ROUND_TIME - (t - this.liveAt) / 1000) * 10) / 10) : CFG.ROUND_TIME,
      cd: this.phase === 'countdown' ? Math.max(0, Math.round((CFG.COUNTDOWN - (t - this.phaseAt) / 1000) * 10) / 10) : 0,
    };
  }

  onRematch(p) {
    if (this.phase !== 'over' || this.closed || (this.result && this.result.reason === 'forfeit')) return;
    if (p.rematch) return;
    p.rematch = true;
    const q = this.opp(p);
    q.cl.send({ t: 'rematch', st: 'opp' });
    log.info('rematch_vote', { room: this.id, sid: p.sid });
    if (q.rematch) this.resetMatch();
  }

  /** Both players agreed: same room, same two players, scores back to 0. They load in again like a fresh match. */
  resetMatch() {
    this.round = 0;
    this.score = [0, 0];
    this.over = false;
    this.result = null;
    this.phase = 'loading';
    this.phaseAt = now();
    this.grenades.length = 0;
    for (const p of this.p) {
      p.ready = false;
      p.rematch = false;
      p.tele = freshTele();
      p.pl.frozen = true;
    }
    log.info('rematch_start', { room: this.id });
    this.announce();
  }

  // ---------------------------------------------------------------------------
  // information protection
  // ---------------------------------------------------------------------------
  /** Rays from (ax,ay,az) to five points on the body of a player standing at (tx,ty,tz): any clear one = visible. */
  los(ax, ay, az, tx, ty, tz, th) {
    const w = this.world;
    const cy = ty + th * 0.55;
    if (w.lineClear(ax, ay, az, tx, cy, tz)) return true;
    if (w.lineClear(ax, ay, az, tx, ty + th - 0.2, tz)) return true;
    if (w.lineClear(ax, ay, az, tx, ty + 0.3, tz)) return true;
    const dx = tx - ax,
      dz = tz - az;
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * HW,
      pz = (dx / l) * HW;
    return w.lineClear(ax, ay, az, tx + px, cy, tz + pz) || w.lineClear(ax, ay, az, tx - px, cy, tz - pz);
  }

  /**
   * May `viewer` be told where `target` is? Only if they could see them (line of sight now or within a short
   * look-ahead, so nobody pops into view late) or are very close; and for a moment after the line breaks.
   * Keeps hidden enemy positions off the wire (a client cannot draw what it never received).
   */
  visible(viewer, target, t) {
    if (!CFG.VIS.ENABLED) return true;
    if (t < target.visUntil[viewer.seat]) return true;
    const vb = viewer.pl.b,
      tb = target.pl.b;
    const ve = EYE[modeId(viewer.pl)];
    let see = Math.hypot(vb.x - tb.x, vb.y - tb.y, vb.z - tb.z) < CFG.VIS.NEAR || this.los(vb.x, vb.y + ve, vb.z, tb.x, tb.y, tb.z, tb.h);
    if (!see) {
      const L = CFG.VIS.LOOKAHEAD_S;
      see = this.los(vb.x + vb.vx * L, vb.y + ve + vb.vy * L * 0.5, vb.z + vb.vz * L, tb.x + tb.vx * L, tb.y + tb.vy * L * 0.5, tb.z + tb.vz * L, tb.h);
    }
    if (see) target.visUntil[viewer.seat] = t + CFG.VIS.HOLD_S * 1000;
    return see;
  }

  // ---------------------------------------------------------------------------
  // test support (only exists when TEST_MODE is on; see config.js)
  // ---------------------------------------------------------------------------
  onTeleport(p, m) {
    p.pl.reset(m.x, m.y, m.z, m.yaw, m.pitch);
    p.pl.frozen = false;
    p.lastRun = { y: m.yaw, p: m.pitch, k: 1 };
    if (m.slot >= 0) {
      p.slot = m.slot;
      p.switchUntilSim = 0;
    }
    if (m.hp > 0) p.hp = m.hp;
    p.hist.push({ t: now(), x: m.x, y: m.y, z: m.z, h: p.pl.b.h });
    p.needFix = true;
    p.fixWhy = 'tp';
  }

  // ---------------------------------------------------------------------------
  // the 30 Hz tick
  // ---------------------------------------------------------------------------
  tick(t, dt) {
    if (this.closed) return;
    const dtMs = t - this.lastTickT;
    this.lastTickT = t;
    // a dropped player has a short grace period to come back; the clocks stand still meanwhile
    let away = 0;
    for (const p of this.p) {
      if (!p.away) continue;
      away++;
      if (t - p.awayAt > CFG.RECONNECT_GRACE_S * 1000) {
        log.info('player_gone', { room: this.id, sid: p.sid });
        return this.forfeit(p, 'did not reconnect');
      }
    }
    if (away && this.phase !== 'over' && this.phase !== 'loading') {
      this.phaseAt += dtMs;
      this.liveAt += dtMs;
    }
    switch (this.phase) {
      case 'loading':
        if (this.p[0].ready && this.p[1].ready) this.startRound();
        else if (t - this.phaseAt > CFG.LOADING_TIMEOUT * 1000) {
          for (const p of this.p) p.cl.send({ t: 'matchEnd', w: 'none', sc: [0, 0], reason: 'the opponent did not load in time', shots: 0, hits: 0, rm: 0 });
          this.phase = 'over';
          this.close();
        }
        return;
      case 'over':
        if (t - this.overAt > CFG.REMATCH_WINDOW_S * 1000) {
          for (const p of this.p) p.cl.send({ t: 'rematch', st: 'closed' });
          this.close();
        }
        return;
      case 'countdown':
        if (t - this.phaseAt >= CFG.COUNTDOWN * 1000) this.goLive(t);
        break;
      case 'live': {
        this.stepGrenades(dt, t);
        for (const p of this.p) if (p.grenades < GW.maxCount && t >= p.nadeAt) p.grenades = GW.maxCount;
        if (t - this.liveAt >= CFG.ROUND_TIME * 1000) {
          const d = this.p[0].hp - this.p[1].hp;
          this.endRound(d > 0 ? 0 : d < 0 ? 1 : -1);
        }
        break;
      }
      case 'ended':
        if (t - this.phaseAt >= (this.over ? CFG.OVER_PAUSE : CFG.ENDED_PAUSE) * 1000) {
          if (this.over) return this.finish(this.score[0] > this.score[1] ? 0 : 1, 'score', false);
          this.startRound();
        }
        break;
    }
    if (this.phase === 'live' || this.phase === 'ended') {
      for (const p of this.p) {
        this.advance(p, t);
        this.flushFix(p, t);
      }
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
      if (p.away) continue;
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
        rs: p.reserve[p.slot],
        pr: this.protLeft(p, t),
        a: p.seqDone,
      };
      if (q.alive && !q.away && this.visible(p, q, t)) {
        const b = q.pl.b;
        m.o = { x: r3(b.x), y: r3(b.y), z: r3(b.z), yw: r3(q.pl.yaw), pt: r3(q.pl.pitch), sp: r3(q.pl.speedH), gr: b.grounded ? 1 : 0, m: modeId(q.pl), w: q.slot, al: 1, pr: this.protLeft(q, t) > 0 ? 1 : 0 };
      } else m.o = { hid: 1, al: q.alive ? 1 : 0 };
      p.cl.send(m);
    }
  }
}

module.exports = { Room, PH };
