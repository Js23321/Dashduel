/* DASHDUEL - online 1v1 client (talks to the game server in server/; see docs/ONLINE_BACKEND.md).
 *
 * What the browser does, and what it does NOT do:
 *   - It simulates and sends ITS OWN movement (30 snapshots a second). The server checks every snapshot
 *     (speed, teleports, walls) and snaps a cheating client back.
 *   - It shows the opponent from the server's snapshots, drawn 100 ms in the past so it moves smoothly.
 *   - It does NOT decide hits, damage, health, deaths, rounds, score, the countdown, spawns, grenade flight or
 *     who wins. It only asks ("fire in this direction") and displays what the server says happened:
 *     hit markers, damage numbers and your health appear when the server confirms them.
 *   - There is no simulated opponent. If the server cannot be reached, online play says so and stops.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const R = () => RV.render;
  const NC = RV.netclient;
  const G = () => RV.game;

  const TO = 5; // rounds to win (the server enforces it; this is for display)
  const INTERP_MS = 100;
  const STATE_DT = 1 / 30;
  const SLOT_ID = ['rifle', 'pistol', 'fists', 'fists'];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const arr3 = (o) => [r3(o.x), r3(o.y), r3(o.z)];

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
    mapId: null,
    ui: null,
    sendAcc: 0,
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
      this.alive = false;
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

    /** Put the opponent at a spawn at the start of a round. */
    reset(sp) {
      this.buf.length = 0;
      this.alive = true;
      const b = this.body;
      b.x = sp.x;
      b.y = sp.y;
      b.z = sp.z;
      this.buf.push({ t: performance.now() - 500, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, sp: 0, gr: 1, m: 0, w: 0 });
    }

    push(o) {
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
      if (!this.alive || O.phase === 'wait') {
        m.group.visible = false;
        return;
      }
      const s = this.sample(performance.now() - INTERP_MS);
      if (!s) return;
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
        m.bodyMat.emissive.setHex(0x000000);
        m.headMat.emissive.setHex(0x000000);
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
  /** ui: {onStatus(text, phase), onMatched(opp), onReady(opp), onError(text)} */
  O.queue = async function (ui) {
    O.cancelQueue();
    O.ui = ui;
    O.queueing = true;
    O.matched = false;
    O.started = false;
    ui.onStatus('Connecting to the game server…', 'connecting');
    try {
      await NC.connect(RV.profile.get());
    } catch (e) {
      O.queueing = false;
      ui.onError(e.message);
      return;
    }
    if (!O.queueing) {
      NC.close();
      return;
    }
    NC.onmessage = O.onMessage;
    NC.onclose = O.onConnClose;
    NC.onstatus = O.refreshStatus;
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

  /** Called by "Enter match": the click lets the browser lock the mouse. */
  O.enter = function () {
    if (!O.matched || O.started) return;
    O.started = true;
    if (RV.settings.fullscreen) RV.enterFullscreen();
    RV.game.start('online', O.mapId, { to: TO });
    NC.send({ t: 'ready' });
  };

  /** Leave: tells the server (the opponent wins by forfeit) and drops the connection. */
  O.leave = function () {
    if (NC.state === 'open') NC.send({ t: 'leave' });
    NC.onclose = null;
    O.queueing = false;
    O.matched = false;
    O.started = false;
    O.phase = 'idle';
    setTimeout(() => NC.close(), 150);
  };
  window.addEventListener('pagehide', () => {
    if (NC.state === 'open') NC.send({ t: 'leave' });
  });

  // ---------------------------------------------------------------------------
  // the game mode
  // ---------------------------------------------------------------------------
  const ONLINE = {
    pvp: true,
    canLook: true,
    realtime: true,
    canShoot() {
      return O.phase === 'live';
    },
    botsActive() {
      return true;
    },
    init(g) {
      g.nav = null;
      g.clearBots();
      O.remote = new RemotePlayer(g, O.oppName);
      g.bots.push(O.remote);
      O.sendAcc = 0;
      O.netHudAcc = 0;
    },
    reset(g) {
      O.score = { you: 0, opp: 0 };
      O.top = 0;
      O.round = 0;
      O.over = false;
      O.phase = 'wait';
      O.t = 0;
      const sp = g.map.spawns[0];
      g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = true;
      if (O.remote) O.remote.alive = false;
    },
    hudSetup(g) {
      RV.hud.setTitle('Online 1v1 · ' + g.map.name);
      RV.hud.setSub('');
      RV.hud.hint('Waiting for the server to start the match…');
    },
    fixedStep() {
      // (falling out of the map is decided by the server)
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
        html += '<tr><td>' + O.oppName + '</td><td>' + O.score.opp + '</td></tr></table><div class="fine">first to ' + TO + ' · ' + NC.describe() + '</div>';
        RV.hud.scoreboard(true, html);
      } else RV.hud.scoreboard(false);
    },
    stop() {
      O.leave();
    },
  };
  RV.modes.online = ONLINE;

  O.tick = function (g, dt) {
    O.sendAcc += dt;
    if (O.sendAcc >= STATE_DT) {
      O.sendAcc = 0;
      O.sendState(g);
    }
    O.netHudAcc += dt;
    if (O.netHudAcc >= 1) {
      O.netHudAcc = 0;
      RV.hud.setNet(NC.describe());
    }
    if (O.phase === 'countdown') {
      O.t -= dt;
      const n = Math.ceil(Math.max(0, O.t));
      if (n >= 1 && n <= 3 && n !== O.lastCount) {
        O.lastCount = n;
        RV.hud.center(String(n), '#ffffff', true);
        RV.audio.play('beep');
      }
    } else if (O.phase === 'live') O.roundT = Math.max(0, O.roundT - dt);
  };

  O.sendState = function (g) {
    if (NC.state !== 'open' || (O.phase !== 'live' && O.phase !== 'ended')) return;
    const pl = g.player,
      b = pl.b;
    NC.send({
      t: 'st',
      x: r3(b.x),
      y: r3(b.y),
      z: r3(b.z),
      yw: r3(pl.yaw),
      pt: r3(pl.pitch),
      sp: r3(pl.speedH),
      gr: b.grounded ? 1 : 0,
      m: pl.mode === 'slide' ? 2 : pl.mode === 'crouch' ? 1 : 0,
      w: g.weapons.cur,
    });
  };

  // ---------------------------------------------------------------------------
  // server -> client
  // ---------------------------------------------------------------------------
  O.onMessage = function (m) {
    const g = G();
    switch (m.t) {
      case 'queued':
        O.refreshStatus();
        break;
      case 'match':
        O.oppName = RV.profile.clean(m.opp) || 'Opponent';
        O.mapId = m.map;
        O.matched = true;
        O.queueing = false;
        if (O.ui) {
          O.ui.onMatched(O.oppName);
          O.ui.onReady(O.oppName);
        }
        if (RV.input.noLock) O.enter(); // test / development mode has no pointer lock to wait for
        break;
      case 'round':
        if (g.mode === 'online') O.applyRound(m);
        break;
      case 'live':
        O.goLive();
        break;
      case 'snap':
        if (g.mode === 'online') O.onSnap(m);
        break;
      case 'hurt':
        if (g.mode === 'online') O.onHurt(m);
        break;
      case 'hit':
        if (g.mode === 'online') O.onHit(m);
        break;
      case 'fx':
        if (g.mode === 'online') O.onFx(m);
        break;
      case 'nade':
        if (g.mode === 'online' && RV.grenades.ready) RV.grenades.spawnServer(g, m.p, m.v, !!m.own);
        break;
      case 'boom':
        if (g.mode === 'online' && RV.grenades.ready) RV.grenades.serverBlast(g, m.p, !!m.own);
        break;
      case 'roundEnd':
        if (g.mode === 'online') O.applyEnd(m);
        break;
      case 'matchEnd':
        O.onMatchEnd(m);
        break;
      case 'fix':
        if (g.mode === 'online') O.onFix(m);
        break;
      case 'err':
        if (!O.started && O.ui) O.ui.onError(m.msg || 'The server refused the connection.');
        else if (g.mode === 'online') RV.hud.toast(m.msg || 'Server error', 3500);
        break;
    }
  };

  O.onConnClose = function (reason) {
    const g = G();
    if (O.started && g && g.mode === 'online' && O.phase !== 'over') {
      // the match is gone: the server awards the opponent the win by forfeit
      O.phase = 'over';
      O.showResult(g, false, 'connection to the server lost', false, 'Disconnected');
    } else if (O.queueing || (O.matched && !O.started)) {
      O.queueing = false;
      O.matched = false;
      if (O.ui) O.ui.onError('Lost the connection to the game server (' + (reason || 'closed') + ').');
    }
  };

  O.applyRound = function (m) {
    const g = G();
    const sp = g.map.spawns;
    const mine = sp[m.you],
      theirs = sp[m.opp];
    if (!mine || !theirs) return;
    O.round = Math.round(num(m.n, 1));
    O.phase = 'countdown';
    O.t = num(m.cd, 3);
    O.lastCount = 99;
    O.roundT = 90;
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
    O.remote.reset(theirs);
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

  /** 30 Hz snapshot: the opponent, my authoritative health, score, round clock, grenade stock. */
  O.onSnap = function (m) {
    const g = G();
    if (m.rn !== O.round) return;
    if (m.ph === 2 && O.phase === 'countdown') O.goLive();
    if (typeof m.rt === 'number') O.roundT = m.rt;
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
    if (m.o && O.remote) {
      O.remote.push(m.o);
      O.remote.alive = !!m.o.al && O.phase !== 'wait';
    }
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

  /** The opponent fired / punched: tracer + sound (the damage, if any, arrives as `hurt`). */
  O.onFx = function (m) {
    const g = G();
    if (m.k === 'punch') {
      RV.audio.play('swing');
      return;
    }
    const o = m.o,
      d = m.d,
      e = m.e;
    if (!Array.isArray(o) || !Array.isArray(d) || !Array.isArray(e) || ![...o, ...d, ...e].every((v) => typeof v === 'number' && isFinite(v))) return;
    const w = RV.WEAPON_BY_ID[m.w];
    R().addTracer(o[0] + d[0] * 0.6, o[1] - 0.25 + d[1] * 0.6, o[2] + d[2] * 0.6, e[0], e[1], e[2], (w && w.tracer) || 0xff6b5b, 0.05);
    const dist = O.remote ? O.remote.dist : 30;
    RV.audio.play('botShot', clamp(1.2 - dist / 60, 0.2, 1));
  };

  O.onFix = function (m) {
    const g = G();
    const b = g.player.b;
    b.x = num(m.x, b.x);
    b.y = num(m.y, b.y);
    b.z = num(m.z, b.z);
    b.vx = b.vy = b.vz = 0;
    g.player.prevX = b.x;
    g.player.prevY = b.y;
    g.player.prevZ = b.z;
    RV.hud.toast('Position corrected by the server', 1800);
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
    if (!O.started) {
      // cancelled before it began
      O.matched = false;
      if (O.ui) O.ui.onError('The match was cancelled: ' + (m.reason || 'the opponent left') + '.');
      return;
    }
    if (g.mode !== 'online' || O.phase === 'over') return;
    O.phase = 'over';
    O.over = true;
    if (Array.isArray(m.sc)) O.score = { you: m.sc[0] | 0, opp: m.sc[1] | 0 };
    const note = m.reason === 'forfeit' ? 'opponent left' : m.reason === 'score' ? '' : String(m.reason || '');
    O.showResult(g, m.w === 'you', note, m.w !== 'none');
  };

  O.showResult = function (g, won, note, record, title) {
    const s = g.session;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const res = record === false ? { streak: 0 } : RV.records.submitOnline(g.mapId, { won, you: O.score.you, opp: O.score.opp, shots: s.shots, hits: s.hits, topSpeed: Math.max(O.top || 0, g.player.maxSpeed) });
    g.menuOpen = false;
    g.setState('results');
    RV.input.exitLock();
    RV.audio.loop('wind', 0);
    RV.audio.loop('slide', 0);
    RV.audio.loop('wallrun', 0);
    RV.hud.deathScreen(false);
    RV.ui.showResults({
      online: true,
      title: title || (won ? 'Victory' : 'Defeat'),
      big: O.score.you + ' – ' + O.score.opp,
      bigClass: won ? 'pb' : '',
      sub: g.map.name + ' · vs ' + O.oppName + (note ? ' · ' + note : '') + (res.streak > 1 ? ' · ' + res.streak + ' win streak' : ''),
      rows: [
        ['Rounds', O.score.you + ' won, ' + O.score.opp + ' lost'],
        ['Accuracy', acc + '%  (' + s.hits + '/' + s.shots + ')'],
        ['Top speed', Math.max(O.top || 0, g.player.maxSpeed).toFixed(1) + ' m/s'],
        ['Server', NC.state === 'open' ? NC.describe() : 'disconnected'],
      ],
    });
  };

  // ---------------------------------------------------------------------------
  // client -> server (the game code calls these; they only REQUEST things)
  // ---------------------------------------------------------------------------
  const dirOf = (d) => [r3(d.x), r3(d.y), r3(d.z)];
  O.sendShot = function (w, o, d) {
    NC.send({ t: 'fire', s: G().weapons.cur, d: dirOf(d) });
  };
  O.sendPunch = function (w, o, d) {
    NC.send({ t: 'punch', d: dirOf(d) });
  };
  O.sendReload = function () {
    NC.send({ t: 'reload' });
  };
  O.sendNadePin = function () {
    NC.send({ t: 'nadepin' });
  };
  O.sendNadeCancel = function () {
    NC.send({ t: 'nadecancel' });
  };
  O.sendNade = function (fwd) {
    NC.send({ t: 'nade', d: dirOf(fwd) });
  };
  O.sendNadeSelf = function () {
    NC.send({ t: 'nadeself' });
  };
  /** (kept so the game code can ask whether damage may happen: the server decides, so never locally) */
  O.canDamage = function () {
    return false;
  };
})();
