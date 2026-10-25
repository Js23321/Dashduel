/* DASHDUEL - online 1v1 client (talks to the game server in server/; see docs/ONLINE_BACKEND.md).
 *
 * What the browser does, and what it does NOT do:
 *   - It runs the SAME movement physics as the server (js/player.js) so your own movement feels instant
 *     (client-side PREDICTION), and it sends its INPUT (keys + view angles) to the server in numbered runs.
 *   - The server simulates your movement from that input and is the authority. If the server's result differs
 *     from what was predicted it sends a correction; the client restores the server's state and REPLAYS the inputs
 *     the server has not simulated yet (RECONCILIATION), smoothing any visible jump.
 *   - It shows the opponent from the server's snapshots, drawn 100 ms in the past (interpolation). If the
 *     opponent is behind a wall the server sends no position at all, so there is nothing to draw.
 *   - It does NOT decide hits, damage, health, deaths, rounds, score, the countdown, spawns, grenade flight, ammo
 *     or who wins. It only asks ("fire", "reload", "throw": no direction, no damage) and displays what the server
 *     says happened: hit markers, damage numbers and your health appear when the server confirms them.
 *   - If the connection drops it keeps the match for you (the server waits a few seconds) and reconnects with its
 *     session token. There is no simulated opponent: without a server, online play says so and stops.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const R = () => RV.render;
  const NC = RV.netclient;
  const G = () => RV.game;
  const P = RV.PHYS;
  const N = RV.NETP;

  const TO = 5; // rounds to win (the server enforces it; this is for display)
  const INTERP_MS = 100;
  const FLUSH_DT = 1 / 30; // input batches per second
  const SLOT_ID = ['rifle', 'pistol', 'fists', 'fists'];
  const RECONNECT_MS = 16000;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const O = (RV.online = {
    TO,
    oppName: 'Opponent',
    remote: null,
    phase: 'idle', // idle | wait | countdown | live | ended | over
    score: { you: 0, opp: 0 },
    round: 0,
    t: 0,
    roundT: 90,
    over: false,
    matched: false,
    started: false,
    queueing: false,
    leaving: false,
    rematching: false,
    rematchWindow: 0,
    oppAway: false,
    oppAlive: true,
    prot: 0, // seconds of spawn protection I have left (the server decides; this only drives the HUD)
    mapId: null,
    ui: null,
    // input stream (prediction / reconciliation)
    seq: 0, // steps executed and recorded this round
    sent: 0, // steps already sent to the server
    runs: [], // recorded, not yet sent
    pending: [], // sent, not yet acknowledged: {from, k, fw, sd, fl, y, p, w}
    flushAcc: 0,
    fixApplied: 0, // id of the last server correction applied
    sx: 0, // visual smoothing offset after a correction (decays to 0)
    sy: 0,
    sz: 0,
    corrections: 0,
    // connection
    connLost: false,
    reconnecting: false,
    top: 0, // best speed of the whole match (the per-round reset must not wipe it)
  });

  // ---------------------------------------------------------------------------
  // the opponent as the rest of the game sees it (driven by server snapshots)
  // ---------------------------------------------------------------------------
  class RemotePlayer {
    constructor(g, name) {
      this.g = g;
      this.net = true;
      this.dummy = false;
      this.name = name;
      this.hp = RV.MAX_HP;
      this.armor = 0;
      this.alive = false; // alive AND currently replicated (visible); the real state is O.oppAlive
      this.hidden = true;
      this.prot = false;
      this.kills = 0;
      this.deaths = 0;
      this.weaponId = 'rifle';
      this.weapon = RV.WEAPON_BY_ID.rifle;
      this.slot = 0;
      this.dist = 30;
      this.walkPhase = 0;
      this.flash = 0;
      this.body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hw: 0.38, h: 1.85, grounded: true };
      this.buf = [];
      this.mesh = RV.render.createBotMesh(0x3ec5ff, 'rifle', 3);
      this.mesh.setName(name, '#ffffff');
      this.mesh.group.visible = false;
      this.mesh.bar.visible = false; // no health bar on a real opponent
    }

    /** New round: nothing is known about the opponent until the server says they can be seen. */
    reset() {
      this.buf.length = 0;
      this.hidden = true;
      this.alive = false;
      this.mesh.group.visible = false;
    }

    /** A snapshot of the opponent: either full state (visible) or just "hidden" (no position was sent). */
    push(o) {
      O.oppAlive = !!o.al;
      if (o.hid) {
        this.hidden = true;
        this.alive = false;
        return;
      }
      if (this.hidden) this.buf.length = 0; // coming back into view: the old samples are stale
      this.hidden = false;
      this.prot = !!o.pr;
      this.alive = !!o.al && O.phase !== 'wait';
      this.buf.push({ t: performance.now(), x: num(o.x), y: num(o.y), z: num(o.z), yaw: num(o.yw), pitch: num(o.pt), sp: num(o.sp), gr: o.gr ? 1 : 0, m: num(o.m), w: clamp(Math.round(num(o.w)), 0, 3) });
      if (this.buf.length > 40) this.buf.shift();
    }

    sample(t) {
      const b = this.buf;
      if (!b.length) return null;
      if (t <= b[0].t) return b[0];
      for (let i = b.length - 1; i > 0; i--) {
        if (b[i - 1].t <= t) {
          const a = b[i - 1],
            c = b[i];
          if (t >= c.t) return c;
          const k = (t - a.t) / (c.t - a.t || 1);
          return {
            x: a.x + (c.x - a.x) * k,
            y: a.y + (c.y - a.y) * k,
            z: a.z + (c.z - a.z) * k,
            yaw: a.yaw + RV.angleDiff(a.yaw, c.yaw) * k,
            pitch: a.pitch + (c.pitch - a.pitch) * k,
            sp: c.sp,
            gr: c.gr,
            m: c.m,
            w: c.w,
          };
        }
      }
      return b[b.length - 1];
    }

    update(dt, g) {
      const m = this.mesh;
      if (!this.alive || this.hidden || O.phase === 'wait') {
        m.group.visible = false;
        return;
      }
      const s = this.sample(performance.now() - INTERP_MS);
      if (!s) {
        m.group.visible = false;
        return;
      }
      m.group.visible = true;
      const b = this.body;
      b.x = s.x;
      b.y = s.y;
      b.z = s.z;
      b.grounded = !!s.gr;
      m.group.position.set(s.x, s.y, s.z);
      m.group.rotation.set(0, s.yaw, 0);
      this.walkPhase += s.sp * dt * 2.2;
      const sw = s.gr ? Math.sin(this.walkPhase) * Math.min(1, s.sp / 5) * 0.8 : 0.3;
      m.legL.rotation.x = sw;
      m.legR.rotation.x = -sw;
      if (s.w !== this.slot) {
        this.slot = s.w;
        this.weaponId = SLOT_ID[s.w];
        this.weapon = RV.WEAPONS[s.w];
        m.setWeapon(this.weaponId);
      }
      if (this.flash > 0) {
        this.flash -= dt;
        m.bodyMat.emissive.setHex(0xffffff);
        m.headMat.emissive.setHex(0xffffff);
      } else {
        const pc = this.prot ? 0x0c4f6e : 0x000000; // the opponent glows faintly teal while spawn-protected
        m.bodyMat.emissive.setHex(pc);
        m.headMat.emissive.setHex(pc);
      }
      const e = g.eye;
      this.dist = Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z);
    }

    /** Damage is decided by the server: nothing happens here. */
    damage() {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // queue + match start
  // ---------------------------------------------------------------------------
  function hookNet() {
    NC.onmessage = O.onMessage;
    NC.onclose = O.onConnClose;
    NC.onstatus = O.refreshStatus;
  }

  /** ui: {onStatus(text, phase), onMatched(opp), onReady(opp), onError(text)} */
  O.queue = async function (ui) {
    O.cancelQueue();
    O.ui = ui;
    O.queueing = true;
    O.matched = false;
    O.started = false;
    O.leaving = false;
    O.rematching = false;
    ui.onStatus('Connecting to the game server…', 'connecting');
    hookNet(); // before connecting: the server may answer the handshake with a resumed match straight away
    try {
      await NC.connect(RV.profile.get());
    } catch (e) {
      O.queueing = false;
      ui.onError(e.message);
      return;
    }
    if (!O.queueing && !O.started) {
      NC.close();
      return;
    }
    hookNet();
    // (a session that is still inside a match gets that match back from the server instead of a queue entry)
    NC.send({ t: 'queue' });
    O.refreshStatus();
  };

  O.refreshStatus = function () {
    if (O.queueing && O.ui && NC.state === 'open') O.ui.onStatus('Searching for an opponent… ' + NC.describe() + (NC.queued ? ' · ' + NC.queued + ' in queue' : ''), 'searching');
  };

  O.cancelQueue = function () {
    if (O.queueing) NC.send({ t: 'unqueue' });
    O.queueing = false;
    if (O.phase === 'idle') {
      NC.onclose = null;
      NC.close();
    }
  };

  /** Start the match (called as soon as the server announces it; there is no confirm step). */
  O.enter = function () {
    if (!O.matched || O.started) return;
    O.started = true;
    O.leaving = false;
    O.rematchWindow = 0;
    const gesture = !!(navigator.userActivation && navigator.userActivation.isActive); // (a click is only fresh for a few seconds)
    if (RV.settings.fullscreen && gesture) RV.enterFullscreen();
    const begin = () => {
      if (!O.started || !O.matched) return; // (left or closed while the map was loading)
      RV.game.start('online', O.mapId, { to: TO });
      // started without a click: the browser may refuse the pointer lock, then "click to capture the mouse" is shown
      RV.game.awaitLock = !RV.input.noLock;
      NC.send({ t: 'ready' });
    };
    // the map's picture first (normally already loaded in the background); if it cannot be fetched the match still starts
    if (RV.loadMeshes) RV.loadMeshes(O.mapId).then(begin, begin);
    else begin();
  };

  /** Leave: tells the server (the opponent wins by forfeit) and drops the connection. */
  O.leave = function () {
    O.leaving = true;
    O.reconnecting = false;
    O.connLost = false;
    O.rematching = false;
    clearTimeout(O.resumeWatch);
    if (NC.state === 'open') NC.send({ t: 'leave' });
    NC.onclose = null;
    O.queueing = false;
    O.matched = false;
    O.started = false;
    O.phase = 'idle';
    O.sx = O.sy = O.sz = 0;
    setTimeout(() => NC.close(), 150);
  };
  window.addEventListener('pagehide', () => {
    if (NC.state === 'open' && O.started && O.phase !== 'over') NC.send({ t: 'leave' });
  });

  /** After a finished match: ask for a rematch with the same opponent (the server needs both players to agree). */
  O.rematch = function (ui) {
    if (NC.state !== 'open') {
      ui.onError('The connection to the game server is closed, so a rematch is not possible.');
      return;
    }
    O.ui = ui;
    O.rematching = true;
    O.matched = false;
    O.started = false;
    NC.send({ t: 'rematch' });
    ui.onStatus('Waiting for ' + O.oppName + ' to accept the rematch…', 'rematch');
  };

  // ---------------------------------------------------------------------------
  // the game mode
  // ---------------------------------------------------------------------------
  const ONLINE = {
    pvp: true,
    canLook: true,
    realtime: true,
    canShoot() {
      return O.phase === 'live' && !O.connLost;
    },
    botsActive() {
      return true;
    },
    init(g) {
      g.nav = null;
      g.clearBots();
      O.remote = new RemotePlayer(g, O.oppName);
      g.bots.push(O.remote);
      O.flushAcc = 0;
      O.netHudAcc = 0;
      O.oppAlive = true;
      O.oppAway = false;
      O.top = 0;
      O.corrections = 0;
      // the eye position carries the smoothing offset that hides a server correction (a new Player per match)
      const pl = g.player;
      const orig = pl.getEye.bind(pl);
      pl.getEye = (a, out) => {
        orig(a, out);
        out.x += O.sx;
        out.y += O.sy;
        out.z += O.sz;
        return out;
      };
    },
    reset(g) {
      O.score = { you: 0, opp: 0 };
      O.top = 0;
      O.round = 0;
      O.over = false;
      O.phase = 'wait';
      O.t = 0;
      O.resetStream();
      const sp = g.map.spawns[0];
      g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = true;
      if (O.remote) O.remote.reset();
    },
    hudSetup(g) {
      RV.hud.setTitle('Online 1v1 · ' + g.map.name);
      RV.hud.setSub('');
      RV.hud.hint('Waiting for the server to start the match…');
    },
    /** After every 1/120 s physics step: record the input that was just simulated. */
    fixedStep(g) {
      O.recordStep(g);
    },
    onPlayerDeath() {},
    frame(g, dt) {
      O.tick(g, dt);
    },
    hud(g) {
      const t = O.phase === 'live' ? Math.max(0, O.roundT) : 90;
      RV.hud.setTimer(Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'));
      RV.hud.setSub('');
      RV.hud.duel(true, O.score.you, O.score.opp, O.oppName, TO, Math.max(1, O.round));
      RV.hud.markerHide();
      const sb = RV.input.isDown('scoreboard');
      if (sb) {
        let html = '<table><tr><th>Player</th><th>Rounds</th></tr>';
        html += '<tr class="me"><td>' + RV.profile.display() + '</td><td>' + O.score.you + '</td></tr>';
        html += '<tr><td>' + O.oppName + '</td><td>' + O.score.opp + '</td></tr></table><div class="fine">first to ' + TO + ' · ' + (O.connLost ? 'reconnecting…' : NC.describe()) + '</div>';
        RV.hud.scoreboard(true, html);
      } else RV.hud.scoreboard(false);
    },
    stop() {
      O.leave();
    },
  };
  RV.modes.online = ONLINE;

  O.tick = function (g, dt) {
    O.flushAcc += dt;
    if (O.flushAcc >= FLUSH_DT) {
      O.flushAcc = 0;
      O.flushInputs();
    }
    // a correction's visual offset melts away in about a tenth of a second
    if (O.sx || O.sy || O.sz) {
      const k = Math.exp(-dt * 14);
      O.sx *= k;
      O.sy *= k;
      O.sz *= k;
      if (Math.abs(O.sx) + Math.abs(O.sy) + Math.abs(O.sz) < 0.001) O.sx = O.sy = O.sz = 0;
    }
    if (O.prot > 0) O.prot = Math.max(0, O.prot - dt);
    O.netHudAcc += dt;
    if (O.netHudAcc >= 1) {
      O.netHudAcc = 0;
      RV.hud.setNet(O.connLost ? 'Reconnecting…' : NC.describe());
    }
    if (O.phase === 'countdown') {
      O.t -= dt;
      const n = Math.ceil(Math.max(0, O.t));
      if (n >= 1 && n <= 3 && n !== O.lastCount) {
        O.lastCount = n;
        RV.hud.center(String(n), '#ffffff', true);
        RV.audio.play('beep');
      }
    } else if (O.phase === 'live' && !O.oppAway) O.roundT = Math.max(0, O.roundT - dt);
    if (g.player.maxSpeed > O.top) O.top = g.player.maxSpeed;
  };

  // ---------------------------------------------------------------------------
  // input stream: record -> send -> acknowledge -> (on a correction) restore + replay
  // ---------------------------------------------------------------------------
  O.resetStream = function () {
    O.seq = 0;
    O.sent = 0;
    O.runs = [];
    O.pending = [];
    O.flushAcc = 0;
    O.sx = O.sy = O.sz = 0;
  };

  O.recordStep = function (g) {
    if ((O.phase !== 'live' && O.phase !== 'ended') || g.playerDead || g.player.frozen || O.connLost || NC.state !== 'open') return;
    const pl = g.player,
      c = g.cmd;
    const fl = N.flags(c, pl.autoHop),
      w = g.weapons.cur;
    const last = O.runs[O.runs.length - 1];
    if (last && last.fw === c.fwd && last.sd === c.side && last.fl === fl && last.y === pl.yaw && last.p === pl.pitch && last.w === w && last.k < N.MAX_RUN_STEPS) last.k++;
    else O.runs.push({ k: 1, fw: c.fwd, sd: c.side, fl, y: pl.yaw, p: pl.pitch, w });
    O.seq++;
  };

  /** Send everything recorded since the last batch (the server never needs more than ~30 batches a second). */
  O.flushInputs = function () {
    if (!O.runs.length || NC.state !== 'open') return;
    const runs = O.runs;
    O.runs = [];
    const b = G().player.b;
    let i = 0;
    while (i < runs.length) {
      const chunk = [];
      let steps = 0;
      while (i < runs.length && chunk.length < 24 && steps + runs[i].k <= 200) {
        steps += runs[i].k;
        chunk.push(runs[i++]);
      }
      const msg = { t: 'in', rn: O.round, q: O.sent, r: chunk.map((r) => [r.k, r.fw, r.sd, r.fl, r.y, r.p, r.w]) };
      // my prediction of where I am after the last step: the server compares it with its own simulation
      if (i >= runs.length) msg.c = [r3(b.x), r3(b.y), r3(b.z), O.fixApplied];
      NC.send(msg);
      let from = O.sent;
      for (const r of chunk) {
        O.pending.push({ from, k: r.k, fw: r.fw, sd: r.sd, fl: r.fl, y: r.y, p: r.p, w: r.w });
        from += r.k;
      }
      O.sent = from;
    }
  };

  /** A discrete request. It carries no direction: the server aims with the view the input describes. */
  O.sendAct = function (a) {
    if (NC.state !== 'open' || O.connLost || O.phase !== 'live') return;
    O.flushInputs();
    NC.send({ t: 'act', rn: O.round, q: O.sent, a, s: G().weapons.cur });
  };

  /** The server has simulated my input up to step `a`: forget what is acknowledged. */
  O.ack = function (a) {
    while (O.pending.length && O.pending[0].from + O.pending[0].k <= a) O.pending.shift();
  };

  /**
   * The server's simulation differs from my prediction (or something happened to me that only the server knows:
   * a grenade push). Restore its movement state at step `m.a`, then replay every input it has not simulated yet,
   * so I end up where I would be had I been right all along; any visible jump is smoothed out.
   */
  O.onFix = function (m) {
    const g = G();
    const pl = g.player;
    if (!pl || !Array.isArray(m.st) || m.st.length !== RV.PLAYER_STATE_LEN || typeof m.a !== 'number') return;
    const b = pl.b;
    const px = b.x,
      py = b.y,
      pz = b.z,
      yaw = pl.yaw,
      pitch = pl.pitch,
      onEvent = pl.onEvent,
      dj = pl.djEnabled,
      ah = pl.autoHop,
      frozen = pl.frozen;
    if (!pl.setState(m.st)) return;
    O.fixApplied = m.id | 0;
    O.corrections++;
    O.ack(m.a);
    pl.onEvent = null; // replays make no sounds, no particles
    pl.frozen = false;
    const cmd = {};
    const replay = (r, skip) => {
      pl.yaw = r.y;
      pl.pitch = r.p;
      pl.autoHop = (r.fl & N.F_AUTOHOP) !== 0;
      pl.djEnabled = !!RV.WEAPONS[r.w].doubleJump;
      N.cmdFrom(r.fw, r.sd, r.fl, cmd);
      for (let i = skip; i < r.k; i++) pl.step(P.STEP, cmd);
    };
    for (const r of O.pending) replay(r, Math.max(0, m.a - r.from));
    for (const r of O.runs) replay(r, 0);
    pl.onEvent = onEvent;
    pl.frozen = frozen;
    pl.yaw = yaw;
    pl.pitch = pitch;
    pl.djEnabled = dj;
    pl.autoHop = ah;
    pl.prevX = b.x;
    pl.prevY = b.y;
    pl.prevZ = b.z;
    const ex = px - b.x,
      ey = py - b.y,
      ez = pz - b.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 0.01 && err < 3) {
      // small error: keep drawing from where I was and let the offset melt away
      O.sx = ex;
      O.sy = ey;
      O.sz = ez;
    } else O.sx = O.sy = O.sz = 0;
    if (m.why !== 'boost' && err > 1.5) RV.hud.toast('Position corrected by the server', 1200);
  };

  // ---------------------------------------------------------------------------
  // server -> client
  // ---------------------------------------------------------------------------
  O.onMessage = function (m) {
    const g = G();
    const online = g && g.mode === 'online';
    switch (m.t) {
      case 'queued':
        O.refreshStatus();
        break;
      case 'match':
        O.onMatch(m);
        break;
      case 'resume':
        O.onResume(m);
        break;
      case 'round':
        if (online) O.applyRound(m);
        break;
      case 'live':
        if (online) O.goLive();
        break;
      case 'snap':
        if (online) O.onSnap(m);
        break;
      case 'hurt':
        if (online) O.onHurt(m);
        break;
      case 'hit':
        if (online) O.onHit(m);
        break;
      case 'blk':
        if (online && performance.now() - (O.blkAt || 0) > 400) {
          O.blkAt = performance.now();
          RV.hud.toast('Spawn protected', 500);
        }
        break;
      case 'fx':
        if (online) O.onFx(m);
        break;
      case 'nade':
        if (online && RV.grenades.ready) RV.grenades.spawnServer(g, m.p, m.v, !!m.own);
        break;
      case 'boom':
        if (online && RV.grenades.ready) RV.grenades.serverBlast(g, m.p, !!m.own);
        break;
      case 'roundEnd':
        if (online) O.applyEnd(m);
        break;
      case 'matchEnd':
        O.onMatchEnd(m);
        break;
      case 'fix':
        if (online) O.onFix(m);
        break;
      case 'opp':
        if (online) O.onOpp(m);
        break;
      case 'rematch':
        // while I am waiting on the queue screen the answer goes there, otherwise it updates the results screen
        if (O.rematching && O.ui && O.ui.onRematch) O.ui.onRematch(m.st);
        else if (RV.ui.rematchMsg) RV.ui.rematchMsg(m.st);
        break;
      case 'warn':
        if (online) RV.hud.toast(m.msg || 'Warning from the server', 3500);
        break;
      case 'err':
        if (!O.started && O.ui) O.ui.onError(m.msg || 'The server refused the connection.');
        else if (online) RV.hud.toast(m.msg || 'Server error', 3500);
        break;
    }
  };

  O.onMatch = function (m) {
    const g = G();
    if (O.started && g && g.mode === 'online' && !O.rematching) {
      // the server re-announced the match (we reconnected while it was still waiting for everyone to load): confirm again
      O.reconnecting = false;
      O.connLost = false;
      clearTimeout(O.resumeWatch);
      NC.send({ t: 'ready' });
      return;
    }
    O.oppName = RV.profile.clean(m.opp) || 'Opponent';
    O.mapId = m.map;
    O.matched = true;
    O.queueing = false;
    if (O.rematching) {
      // a rematch: the old game is over, a fresh one is loaded straight away
      O.rematching = false;
      O.started = false;
      O.phase = 'idle';
    }
    if (O.ui) O.ui.onMatched(O.oppName);
    O.enter(); // no "Enter match" button: the match simply starts
  };

  /** The connection closed. During a match: hold the place and reconnect; otherwise tell the player. */
  O.onConnClose = function (reason) {
    const g = G();
    if (O.leaving) return;
    if (O.started && g && g.mode === 'online' && O.phase !== 'over') {
      O.beginReconnect(reason);
    } else if (O.queueing || O.rematching || (O.matched && !O.started)) {
      O.queueing = false;
      O.rematching = false;
      O.matched = false;
      if (O.ui) O.ui.onError('Lost the connection to the game server (' + (reason || 'closed') + ').');
    }
  };

  /** Keep trying to come back with the session token; the server keeps the match for a few seconds. */
  O.beginReconnect = function (reason) {
    const g = G();
    if (O.reconnecting) return;
    O.reconnecting = true;
    O.connLost = true;
    g.player.frozen = true; // stand still locally: the server holds the avatar in place too
    O.runs = [];
    RV.hud.hint('Connection lost (' + (reason || 'closed') + '). Reconnecting…');
    RV.hud.setNet('Reconnecting…');
    const t0 = performance.now();
    const attempt = async () => {
      if (!O.reconnecting || O.leaving) return;
      if (performance.now() - t0 > RECONNECT_MS) return O.reconnectFailed('The server did not answer in time.');
      hookNet();
      try {
        await NC.connect(RV.profile.get());
      } catch (e) {
        setTimeout(attempt, 1000);
        return;
      }
      hookNet();
      // the server now sends `resume` (still in the match) or `matchEnd`; if neither comes the match is gone
      clearTimeout(O.resumeWatch);
      O.resumeWatch = setTimeout(() => {
        if (O.reconnecting) O.reconnectFailed('The server no longer has this match.');
      }, 4000);
    };
    attempt();
  };

  O.reconnectFailed = function (note) {
    const g = G();
    clearTimeout(O.resumeWatch);
    O.reconnecting = false;
    O.connLost = false;
    if (O.phase === 'over') return;
    O.phase = 'over';
    O.rematchWindow = 0;
    O.showResult(g, false, note, false, 'Disconnected');
  };

  /** The server gives the match back: adopt its state exactly. */
  O.onResume = function (m) {
    clearTimeout(O.resumeWatch);
    const wasLost = O.reconnecting || O.connLost;
    if (!O.started) {
      // a fresh page that asked for a queue and was told "you are still in a match": start that match
      O.oppName = RV.profile.clean(m.opp) || 'Opponent';
      O.mapId = m.map;
      O.matched = true;
      O.queueing = false;
      O.started = true;
      O.leaving = false;
      if (O.ui) O.ui.onStatus('Rejoining your match…', 'resume');
      RV.game.start('online', m.map, { to: TO });
      RV.game.awaitLock = !RV.input.noLock;
    }
    const g = G();
    if (g.mode !== 'online') return;
    const pl = g.player;
    O.reconnecting = false;
    O.connLost = false;
    O.round = m.n | 0;
    O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    O.phase = m.ph === 1 ? 'countdown' : m.ph === 3 ? 'ended' : 'live';
    O.t = num(m.cd, 0);
    O.roundT = num(m.rt, 90);
    O.lastCount = 99;
    O.oppAway = false;
    O.prot = num(m.pr, 0);
    O.resetStream();
    O.seq = O.sent = m.ack | 0;
    O.fixApplied = m.fx | 0;
    if (m.st && pl.setState(m.st)) {
      pl.prevX = pl.b.x;
      pl.prevY = pl.b.y;
      pl.prevZ = pl.b.z;
    }
    pl.frozen = m.ph === 1 || !m.alive;
    g.hp = clamp(num(m.hp, RV.MAX_HP), 0, RV.MAX_HP);
    g.playerDead = !m.alive;
    const w = g.weapons;
    const slot = clamp(m.slot | 0, 0, 3);
    if (slot !== w.cur) w.select(slot);
    w.slots[2].ammo = RV.WEAPONS[2].mag;
    if (w.weapon.kind === 'gun') {
      w.ammo = clamp(m.am | 0, 0, w.weapon.mag);
      if (typeof m.rs === 'number') w.reserve = clamp(m.rs | 0, 0, w.weapon.reserve || 0);
    }
    w.grenades = clamp(m.gr | 0, 0, 1);
    O.remote.reset();
    RV.hud.centerHide();
    RV.hud.hint(wasLost ? 'Reconnected' : '');
    if (wasLost) setTimeout(() => RV.hud.hint(''), 1500);
    if (NC.onstatus) NC.onstatus();
  };

  O.onOpp = function (m) {
    if (m.st === 'away') {
      O.oppAway = true;
      RV.hud.hint(O.oppName + ' lost connection. Waiting up to ' + Math.round(num(m.g, 15)) + ' s for them to return…');
    } else if (m.st === 'back') {
      O.oppAway = false;
      RV.hud.hint(O.oppName + ' is back');
      setTimeout(() => RV.hud.hint(''), 1500);
    }
  };

  O.applyRound = function (m) {
    const g = G();
    const mine = g.map.spawns[m.you];
    if (!mine) return;
    O.round = Math.round(num(m.n, 1));
    O.phase = 'countdown';
    O.t = num(m.cd, 3);
    O.lastCount = 99;
    O.roundT = 90;
    O.oppAway = false;
    if (Array.isArray(m.sc)) O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    g.refreshVitals();
    g.playerDead = false;
    g.killedBy = null;
    g.hist.length = 0;
    g.weapons.refill();
    RV.grenades.clear();
    O.top = Math.max(O.top || 0, g.player.maxSpeed || 0); // the per-round reset must not wipe the match's top speed
    g.player.reset(mine.x, mine.y, mine.z, mine.yaw, 0);
    g.player.autoHop = RV.settings.autoHop;
    g.player.frozen = true; // locked in your own spawn for the countdown
    g.acc = 0;
    O.resetStream();
    O.oppAlive = true;
    O.prot = 0;
    O.remote.reset(); // where the opponent stands is not told to anyone until they can actually be seen
    RV.hud.centerHide();
    RV.hud.hint('Round ' + O.round + ' · ' + O.oppName);
    RV.hud.deathScreen(false);
  };

  O.goLive = function () {
    if (O.phase !== 'countdown') return;
    const g = G();
    O.phase = 'live';
    g.player.frozen = false;
    RV.audio.play('go');
    RV.hud.center('FIGHT', '#ffffff', true, 650);
    RV.hud.hint('');
  };

  /** 30 Hz snapshot: the opponent (if visible), my authoritative health, score, round clock, grenade stock. */
  O.onSnap = function (m) {
    const g = G();
    if (m.rn !== O.round) return;
    if (typeof m.a === 'number') O.ack(m.a);
    O.prot = typeof m.pr === 'number' ? Math.max(0, m.pr) : 0;
    if (m.ph === 2 && O.phase === 'countdown') O.goLive();
    if (typeof m.rt === 'number' && !O.oppAway) O.roundT = m.rt;
    if (Array.isArray(m.sc) && O.phase !== 'ended') O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    if (typeof m.hp === 'number' && !g.playerDead) {
      g.hp = clamp(m.hp, 0, RV.MAX_HP);
      if (g.hp <= 0) O.die(g, null, null);
    }
    const w = g.weapons;
    if (typeof m.gr === 'number') {
      w.grenades = m.gr;
      if (m.gr === 0 && typeof m.gc === 'number') w.gregen = m.gc;
    }
    if (m.o && O.remote) O.remote.push(m.o);
  };

  O.die = function (g, name, src) {
    if (g.playerDead) return;
    g.playerDead = true;
    g.hp = 0;
    g.session.deaths++;
    g.player.frozen = true;
    RV.audio.play('die');
    g.killedBy = { name: name || O.oppName, weapon: '', weaponId: null };
    RV.hud.killfeed(name || O.oppName, null, RV.profile.display(), 'd');
  };

  /** The server says I was hit. */
  O.onHurt = function (m) {
    const g = G();
    if (g.playerDead) return;
    g.hp = clamp(num(m.hp), 0, RV.MAX_HP);
    g.lastDamageT = g.time;
    RV.hud.damageFlash();
    RV.hud.addDamageSource(num(m.x), num(m.z));
    RV.audio.play('hurt');
    if (g.hp <= 0) O.die(g, m.src === 'fall' ? 'the void' : null, m.src);
  };

  /** The server confirms a hit I made: now (and only now) the hit marker + number appear. */
  O.onHit = function (m) {
    const g = G();
    const dmg = Math.round(clamp(num(m.dmg), 0, 200));
    if (dmg <= 0) return;
    const head = !!m.head,
      kill = !!m.kill;
    g.weapons.hits++;
    g.session.hits++;
    if (O.remote) O.remote.flash = 0.07;
    RV.hud.hitMarker(kill);
    RV.hud.damageNumber(dmg, head, kill);
    RV.audio.play(kill ? 'kill' : head ? 'headshot' : 'hit');
    if (kill) {
      g.session.kills++;
      RV.hud.killfeed(RV.profile.display(), typeof m.src === 'string' ? m.src : null, O.oppName, 'k');
      RV.hud.eliminated(O.oppName);
    }
  };

  /** The opponent fired / punched: tracer + sound (the damage, if any, arrives as `hurt`). A hidden shooter's position is not sent. */
  O.onFx = function (m) {
    if (m.k === 'punch') {
      RV.audio.play('swing');
      return;
    }
    const o = m.o,
      d = m.d,
      e = m.e;
    if (!Array.isArray(o) || !Array.isArray(d) || !Array.isArray(e) || ![...o, ...d, ...e].every((v) => typeof v === 'number' && isFinite(v))) {
      RV.audio.play('botShot', 0.35); // heard, not seen
      return;
    }
    const w = RV.WEAPON_BY_ID[m.w];
    R().addTracer(o[0] + d[0] * 0.6, o[1] - 0.25 + d[1] * 0.6, o[2] + d[2] * 0.6, e[0], e[1], e[2], (w && w.tracer) || 0xff6b5b, 0.05);
    const dist = O.remote ? O.remote.dist : 30;
    RV.audio.play('botShot', clamp(1.2 - dist / 60, 0.2, 1));
  };

  O.applyEnd = function (m) {
    if (O.phase === 'ended' || O.phase === 'over') return;
    if (Array.isArray(m.sc)) O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    O.phase = 'ended';
    O.over = !!m.over;
    const mine = m.w === 'you';
    const txt = m.w === 'draw' ? 'DRAW' : mine ? 'ROUND WON' : 'ROUND LOST';
    RV.hud.center(O.over ? (mine ? 'MATCH WON' : 'MATCH LOST') : txt, '#ffffff', true);
    RV.audio.play(mine ? 'finish' : 'die');
    // nobody is frozen between rounds: you keep moving until the next countdown
  };

  O.onMatchEnd = function (m) {
    const g = G();
    O.reconnecting = false;
    O.connLost = false;
    clearTimeout(O.resumeWatch);
    if (!O.started) {
      // cancelled before it began
      O.matched = false;
      O.rematching = false;
      if (O.ui) O.ui.onError('The match was cancelled: ' + (m.reason || 'the opponent left') + '.');
      return;
    }
    if (g.mode !== 'online' || O.phase === 'over') return;
    O.phase = 'over';
    O.over = true;
    O.rematchWindow = num(m.rm, 0);
    if (Array.isArray(m.sc)) O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    const note = m.reason === 'forfeit' ? 'opponent left' : m.reason === 'score' ? '' : String(m.reason || '');
    O.showResult(g, m.w === 'you', note, m.w !== 'none');
  };

  O.showResult = function (g, won, note, record, title) {
    const s = g.session;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const top = Math.max(O.top || 0, g.player.maxSpeed);
    const res = record === false ? { streak: 0 } : RV.records.submitOnline(g.mapId, { won, you: O.score.you, opp: O.score.opp, shots: s.shots, hits: s.hits, topSpeed: top });
    g.menuOpen = false;
    g.setState('results');
    RV.input.exitLock();
    RV.audio.loop('wind', 0);
    RV.audio.loop('slide', 0);
    RV.audio.loop('wallrun', 0);
    RV.hud.deathScreen(false);
    RV.ui.showResults({
      online: true,
      rematch: O.rematchWindow > 0 && NC.state === 'open',
      rematchSeconds: O.rematchWindow,
      title: title || (won ? 'Victory' : 'Defeat'),
      big: O.score.you + ' – ' + O.score.opp,
      bigClass: won ? 'pb' : '',
      sub: g.map.name + ' · vs ' + O.oppName + (note ? ' · ' + note : '') + (res.streak > 1 ? ' · ' + res.streak + ' win streak' : ''),
      rows: [
        ['Rounds', O.score.you + ' won, ' + O.score.opp + ' lost'],
        ['Accuracy', acc + '%  (' + s.hits + '/' + s.shots + ')'],
        ['Top speed', top.toFixed(1) + ' m/s'],
        ['Server', NC.state === 'open' ? NC.describe() : 'disconnected'],
      ],
    });
  };

  // ---------------------------------------------------------------------------
  // client -> server (the game code calls these; they only REQUEST things, and any direction argument is ignored)
  // ---------------------------------------------------------------------------
  O.sendShot = () => O.sendAct('fire');
  O.sendPunch = () => O.sendAct('punch');
  O.sendReload = () => O.sendAct('reload');
  O.sendNadePin = () => O.sendAct('nadepin');
  O.sendNadeCancel = () => O.sendAct('nadecancel');
  O.sendNade = () => O.sendAct('nade');
  O.sendNadeSelf = () => O.sendAct('nadeself');
  /** (kept so the game code can ask whether damage may happen: the server decides, so never locally) */
  O.canDamage = function () {
    return false;
  };
})();
