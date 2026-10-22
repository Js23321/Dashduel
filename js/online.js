/* DASHDUEL - online 1v1 (real players, first to 5 rounds).
 *
 * Model (peer to peer, see net.js for the connection):
 *   - Everyone simulates and owns THEIR OWN movement and health. 30 times a second you send a snapshot
 *     (position, look direction, speed, weapon, health); the opponent is drawn 100 ms in the past from a
 *     small buffer so it moves smoothly.
 *   - Hits are decided by the VICTIM's client with lag compensation: a shot message carries the shooter's
 *     ray; the victim rewinds its own recent positions by (half the round trip + the 100 ms interpolation
 *     delay), tests that ray against its own body (and the world for walls), applies the damage and sends a
 *     confirmation back. So "what you saw is what you hit", and nobody can hurt you from nowhere.
 *   - The player who was found first (the initiator) is the HOST of the match flow only: it chooses the map,
 *     the spawns, runs the round clock and announces who won each round. Rounds start with a 3 second
 *     countdown during which both players are locked in their own spawn.
 *   - Grenades: the throw is mirrored on the other side; each client damages only itself.
 * It is not cheat-proof (it is peer to peer between browsers); it is meant for friendly matches.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const R = () => RV.render;

  const TO = 5; // rounds to win
  const COUNTDOWN = 3; // seconds locked in the spawn at the start of every round
  const ROUND_TIME = 90; // seconds per round (then most health wins)
  const INTERP_MS = 100;
  const STATE_DT = 1 / 30;
  const SLOT_ID = ['rifle', 'pistol', 'fists', 'fists'];
  const MAPS = ['toybox', 'skybridge', 'pinwheel', 'vertigo'];

  const O = (RV.online = {
    TO,
    link: null,
    isHost: false,
    oppName: 'Opponent',
    remote: null,
    phase: 'idle', // idle | wait | countdown | live | ended | over
    ticket: null,
    score: { you: 0, opp: 0 },
    round: 0,
    t: 0,
    roundT: ROUND_TIME,
    over: false,
    hist: [],
  });

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && isFinite(x)) ? { x: a[0], y: a[1], z: a[2] } : null);
  const G = () => RV.game;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------------------
  // the opponent as the rest of the game sees it (a "bot" that other people drive)
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
      this.mesh.bar.visible = false; // no health bars on a real opponent
    }

    /** Put the opponent at a spawn at the start of a round. */
    reset(sp) {
      this.buf.length = 0;
      this.alive = true;
      this.hp = RV.MAX_HP;
      const b = this.body;
      b.x = sp.x;
      b.y = sp.y;
      b.z = sp.z;
      this.buf.push({ t: performance.now() - 500, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, sp: 0, gr: 1, m: 0, w: 0 });
    }

    push(s) {
      this.buf.push({ t: performance.now(), x: num(s.x), y: num(s.y), z: num(s.z), yaw: num(s.yaw), pitch: num(s.pitch), sp: num(s.sp), gr: s.gr ? 1 : 0, m: num(s.m), w: clamp(Math.round(num(s.w)), 0, 3) });
      if (this.buf.length > 40) this.buf.shift();
    }

    /** Interpolated snapshot for `t` (ms, local clock). */
    sample(t) {
      const b = this.buf;
      if (!b.length) return null;
      if (t <= b[0].t) return b[0];
      for (let i = b.length - 1; i > 0; i--) {
        if (b[i - 1].t <= t) {
          const a = b[i - 1],
            c = b[i];
          if (t >= c.t) return c; // beyond the newest: hold it
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
      // the weapon they carry (a slot number in the snapshot)
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

    /** Damage to a remote player is decided on THEIR machine: nothing happens here. */
    damage() {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // queue + handshake
  // ---------------------------------------------------------------------------
  /** ui: {onStatus(text, phase), onError(text), onMatched(oppName, isHost)} */
  O.queue = function (ui) {
    O.cancelQueue();
    O.ticket = RV.net.queue({
      name: RV.profile.get(),
      onStatus: ui.onStatus,
      onError: (m) => {
        O.ticket = null;
        ui.onError(m);
      },
      onMatched: (link, isHost, oppName) => {
        O.ticket = null;
        O.begin(link, isHost, oppName, ui);
      },
    });
  };
  O.cancelQueue = function () {
    if (O.ticket) {
      O.ticket.cancel();
      O.ticket = null;
    }
  };

  O.begin = function (link, isHost, oppName, ui) {
    O.link = link;
    O.isHost = isHost;
    O.oppName = RV.profile.clean(oppName) || 'Opponent';
    O.ui = ui;
    O.started = false;
    O.guestReady = false;
    O.over = false;
    O.phase = 'idle';
    link.onmessage = O.onEvent;
    link.onstate = O.onState;
    link.onclose = O.onClose;
    if (ui && ui.onMatched) ui.onMatched(O.oppName, isHost);
    link.send('hello', { name: RV.profile.get(), v: RV.net.VERSION });
    // if the other side never completes the handshake (or never clicks "Enter match"), give up cleanly
    O.pendingMap = null;
    O.hsTimer = setTimeout(() => {
      if (!O.started && O.link === link) {
        O.closeLink();
        if (ui && ui.onError) ui.onError('The match did not start (the opponent left or did not enter).');
      }
    }, 60000);
  };

  /** Both sides know the map: the player must click once (pointer lock needs a user gesture). */
  O.notifyReady = function () {
    if (O.ui && O.ui.onReady) O.ui.onReady(O.oppName);
    if (RV.input.noLock) O.enter(); // test / development mode has no pointer lock to wait for
  };

  /** Called from the "Enter match" click. */
  O.enter = function () {
    if (O.started || !O.pendingMap || !O.link) return;
    O.startGame(O.pendingMap);
    if (O.isHost) O.maybeFirstRound();
    else O.link.send('ready', {});
  };

  O.startGame = function (mapId) {
    if (!RV.maps[mapId]) return;
    O.started = true;
    clearTimeout(O.hsTimer);
    if (RV.settings.fullscreen) RV.enterFullscreen();
    RV.game.start('online', mapId, { to: TO });
  };

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
      O.hist.length = 0;
      O.sendAcc = 0;
      O.seq = 0;
      O.lastShotRx = 0;
      O.shotRate = [];
    },
    reset(g) {
      O.score = { you: 0, opp: 0 };
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
      RV.hud.hint('Waiting for the match to start…');
    },
    fixedStep(g) {
      if (O.phase === 'live' && g.player.b.y < g.map.killY && !g.playerDead) g.hurtPlayer(999, g.player.b.x, g.player.b.z, null);
    },
    onPlayerDeath() {
      O.onLocalDeath();
    },
    frame(g, dt) {
      O.tick(g, dt);
    },
    hud(g) {
      const t = O.phase === 'live' ? Math.max(0, O.roundT) : ROUND_TIME;
      RV.hud.setTimer(Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'));
      RV.hud.setSub('');
      RV.hud.duel(true, O.score.you, O.score.opp, O.oppName, TO, Math.max(1, O.round));
      RV.hud.markerHide();
      const sb = RV.input.isDown('scoreboard');
      if (sb) {
        const ping = O.link ? Math.round(O.link.rtt * 1000) : 0;
        let html = '<table><tr><th>Player</th><th>Rounds</th></tr>';
        html += '<tr class="me"><td>' + RV.profile.display() + '</td><td>' + O.score.you + '</td></tr>';
        html += '<tr><td>' + O.oppName + '</td><td>' + O.score.opp + '</td></tr></table><div class="fine">first to ' + TO + ' · ping ' + ping + ' ms</div>';
        RV.hud.scoreboard(true, html);
      } else RV.hud.scoreboard(false);
    },
    stop() {
      O.leave();
    },
  };
  RV.modes.online = ONLINE;

  // ---------------------------------------------------------------------------
  // per-frame work
  // ---------------------------------------------------------------------------
  O.tick = function (g, dt) {
    const pl = g.player;
    const now = performance.now();
    O.hist.push({ t: now, x: pl.b.x, y: pl.b.y, z: pl.b.z, h: pl.b.h });
    while (O.hist.length > 90) O.hist.shift();
    O.sendAcc += dt;
    if (O.sendAcc >= STATE_DT) {
      O.sendAcc = 0;
      O.sendState(g);
    }
    if (O.phase === 'countdown') {
      O.t -= dt;
      const n = Math.ceil(Math.max(0, O.t));
      if (n >= 1 && n <= COUNTDOWN && n !== O.lastCount) {
        O.lastCount = n;
        RV.hud.center(String(n), '#ffffff', true);
        RV.audio.play('beep');
      }
      if (O.t <= 0 && O.isHost) O.goLive(true);
      else if (O.t <= -1.5) O.goLive(false); // the host's "live" never arrived
    } else if (O.phase === 'live') {
      O.roundT -= dt;
      if (O.isHost && O.roundT <= 0) {
        const diff = g.hp - O.remote.hp;
        O.hostEnd(diff > 0.5 ? 'host' : diff < -0.5 ? 'guest' : 'draw');
      }
    } else if (O.phase === 'ended') {
      O.t -= dt;
      if (O.t <= 0) {
        if (O.over) O.finish(g);
        else if (O.isHost) O.hostRound(g);
      }
    }
  };

  O.sendState = function (g) {
    if (!O.link || !O.link.open) return;
    const pl = g.player,
      b = pl.b;
    O.link.sendState({
      rn: O.round,
      x: r3(b.x),
      y: r3(b.y),
      z: r3(b.z),
      yaw: r3(pl.yaw),
      pitch: r3(pl.pitch),
      sp: r3(pl.speedH),
      gr: b.grounded ? 1 : 0,
      m: pl.mode === 'slide' ? 2 : pl.mode === 'crouch' ? 1 : 0,
      w: g.weapons.cur,
      hp: Math.ceil(g.hp),
      al: g.playerDead ? 0 : 1,
    });
  };

  O.onState = function (s) {
    if (!O.remote || !s || typeof s !== 'object') return;
    if (s.rn !== O.round) return; // a snapshot from another round
    O.remote.push(s);
    O.remote.hp = clamp(num(s.hp, RV.MAX_HP), 0, RV.MAX_HP);
    O.remote.alive = !!s.al && O.phase !== 'wait';
  };

  // ---------------------------------------------------------------------------
  // match + round flow (the host decides, both apply)
  // ---------------------------------------------------------------------------
  O.canDamage = function () {
    return O.phase === 'live';
  };

  O.maybeFirstRound = function () {
    if (O.isHost && O.started && O.guestReady && O.phase === 'wait' && O.round === 0) O.hostRound(G());
  };

  O.hostRound = function (g) {
    const sp = g.map.spawns;
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
    O.flip = !O.flip;
    const msg = { n: O.round + 1, hs: O.flip ? a : far, gs: O.flip ? far : a };
    O.link.send('round', msg);
    O.applyRound(msg);
  };

  O.applyRound = function (msg) {
    const g = G();
    const n = Math.round(num(msg.n, 1));
    const mine = O.isHost ? msg.hs : msg.gs,
      theirs = O.isHost ? msg.gs : msg.hs;
    const sp = g.map.spawns;
    if (!sp[mine] || !sp[theirs]) return;
    O.round = n;
    O.phase = 'countdown';
    O.t = COUNTDOWN;
    O.lastCount = 99;
    O.roundT = ROUND_TIME;
    g.refreshVitals();
    g.playerDead = false;
    g.killedBy = null;
    g.hist.length = 0;
    g.weapons.refill();
    RV.grenades.clear();
    const s = sp[mine];
    g.player.reset(s.x, s.y, s.z, s.yaw, 0);
    g.player.autoHop = RV.settings.autoHop;
    g.player.frozen = true; // locked in your own spawn for the countdown
    g.acc = 0;
    O.remote.reset(sp[theirs]);
    RV.hud.centerHide();
    RV.hud.hint('Round ' + n + ' · ' + O.oppName);
    RV.hud.deathScreen(false);
  };

  O.goLive = function (broadcast) {
    if (O.phase !== 'countdown') return;
    O.phase = 'live';
    O.roundT = ROUND_TIME;
    const g = G();
    g.player.frozen = false;
    RV.audio.play('go');
    RV.hud.center('FIGHT', '#ffffff', true, 650);
    RV.hud.hint('');
    if (broadcast && O.link) O.link.send('live', {});
  };

  O.onLocalDeath = function () {
    if (O.phase !== 'live') return;
    if (O.isHost) O.hostEnd('guest');
    else if (O.link) O.link.send('dead', { n: O.round });
  };

  O.hostEnd = function (winner) {
    if (O.phase !== 'live') return;
    let sh = O.isHost ? O.score.you : O.score.opp,
      sg = O.isHost ? O.score.opp : O.score.you;
    if (winner === 'host') sh++;
    else if (winner === 'guest') sg++;
    const msg = { w: winner, sh, sg, over: sh >= TO || sg >= TO, n: O.round };
    O.link.send('end', msg);
    O.applyEnd(msg);
  };

  O.applyEnd = function (msg) {
    if (O.phase === 'ended' || O.phase === 'over') return;
    const sh = Math.round(num(msg.sh)),
      sg = Math.round(num(msg.sg));
    O.score = O.isHost ? { you: sh, opp: sg } : { you: sg, opp: sh };
    O.phase = 'ended';
    O.over = !!msg.over;
    O.t = O.over ? 1.6 : 1.9;
    const mine = (O.isHost && msg.w === 'host') || (!O.isHost && msg.w === 'guest');
    const draw = msg.w === 'draw';
    const txt = draw ? 'DRAW' : mine ? 'ROUND WON' : 'ROUND LOST';
    RV.hud.center(O.over ? (mine ? 'MATCH WON' : 'MATCH LOST') : txt, '#ffffff', true);
    RV.audio.play(mine ? 'finish' : 'die');
    // no freeze: you keep moving between rounds
  };

  O.finish = function (g) {
    if (O.phase === 'over') return;
    O.phase = 'over';
    O.over = true;
    const won = O.score.you > O.score.opp;
    O.showResult(g, won, '');
  };

  /** forfeit = the opponent left / dropped: the match ends and you win it. */
  O.forfeit = function (reason) {
    const g = G();
    if (!g || g.mode !== 'online' || O.over || O.phase === 'over' || (g.state !== 'playing' && g.state !== 'paused')) return;
    O.phase = 'over';
    O.over = true;
    if (O.score.you <= O.score.opp) O.score = { you: Math.max(O.score.you, TO), opp: O.score.opp };
    O.showResult(g, true, reason);
  };

  O.showResult = function (g, won, note) {
    const s = g.session;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const res = RV.records.submitOnline(g.mapId, { won, you: O.score.you, opp: O.score.opp, shots: s.shots, hits: s.hits, topSpeed: g.player.maxSpeed });
    g.menuOpen = false;
    g.setState('results');
    RV.input.exitLock();
    RV.audio.loop('wind', 0);
    RV.audio.loop('slide', 0);
    RV.audio.loop('wallrun', 0);
    RV.hud.deathScreen(false);
    RV.ui.showResults({
      online: true,
      title: won ? 'Victory' : 'Defeat',
      big: O.score.you + ' – ' + O.score.opp,
      bigClass: won ? 'pb' : '',
      sub: g.map.name + ' · vs ' + O.oppName + (note ? ' · ' + note : '') + (res.streak > 1 ? ' · ' + res.streak + ' win streak' : ''),
      rows: [
        ['Rounds', O.score.you + ' won, ' + O.score.opp + ' lost'],
        ['Accuracy', acc + '%  (' + s.hits + '/' + s.shots + ')'],
        ['Top speed', g.player.maxSpeed.toFixed(1) + ' m/s'],
        ['Ping', O.link ? Math.round(O.link.rtt * 1000) + ' ms' : '--'],
      ],
    });
    // the link stays open until you leave the results screen: the other side may still be showing its own
    // last round, and a closing link would look like a disconnect to it
  };

  O.onClose = function (reason) {
    const g = G();
    if (!O.link) return;
    if (O.over || O.phase === 'over') return; // the match was already decided
    if (!O.started) {
      clearTimeout(O.hsTimer);
      O.closeLink();
      if (O.ui && O.ui.onError) O.ui.onError('The opponent disconnected.');
      return;
    }
    if (O.phase !== 'over' && g && g.mode === 'online') O.forfeit('opponent disconnected');
  };

  /** quietly tell the opponent we are leaving and drop the connection */
  O.leave = function () {
    const l = O.link;
    O.link = null;
    clearTimeout(O.hsTimer);
    if (l) {
      l.onclose = null;
      l.send('leave', {});
      setTimeout(() => l.close('left'), 250);
    }
    O.phase = 'idle';
  };
  O.closeLink = function (keepPhase) {
    const l = O.link;
    O.link = null;
    clearTimeout(O.hsTimer);
    if (l) {
      l.onclose = null;
      setTimeout(() => l.close('done'), 250);
    }
    if (!keepPhase) O.phase = 'idle';
  };
  window.addEventListener('pagehide', () => {
    if (O.link) O.leave();
  });

  // ---------------------------------------------------------------------------
  // events from the opponent
  // ---------------------------------------------------------------------------
  O.onEvent = function (type, d) {
    const g = G();
    switch (type) {
      case 'hello':
        if (d.name) O.oppName = RV.profile.clean(d.name) || O.oppName;
        if (O.isHost && !O.started && !O.pendingMap) {
          const map = MAPS[Math.floor(Math.random() * MAPS.length)];
          O.pendingMap = map;
          O.link.send('start', { map, to: TO });
          O.notifyReady();
        }
        break;
      case 'start':
        if (!O.isHost && !O.started && !O.pendingMap && typeof d.map === 'string' && MAPS.indexOf(d.map) >= 0) {
          O.pendingMap = d.map;
          O.notifyReady();
        }
        break;
      case 'ready':
        O.guestReady = true;
        O.maybeFirstRound();
        break;
      case 'round':
        if (!O.isHost && g.mode === 'online' && (O.phase === 'wait' || O.phase === 'ended')) O.applyRound(d);
        break;
      case 'live':
        if (!O.isHost) O.goLive(false);
        break;
      case 'dead':
        if (O.isHost && O.phase === 'live') O.hostEnd('host');
        break;
      case 'end':
        if (!O.isHost && g.mode === 'online') O.applyEnd(d);
        break;
      case 'shot':
        O.handleShot(d);
        break;
      case 'punch':
        O.handlePunch(d);
        break;
      case 'nade':
        O.onNade(d);
        break;
      case 'boom':
        O.onBoom(d);
        break;
      case 'dmg':
        O.onDmgAck(d);
        break;
      case 'leave':
        if (O.link) O.forfeit('opponent left');
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // combat messages
  // ---------------------------------------------------------------------------
  const arr3 = (o) => [r3(o.x), r3(o.y), r3(o.z)];

  O.sendShot = function (w, o, d) {
    if (O.link) O.link.send('shot', { w: w.id, o: arr3(o), d: arr3(d) });
  };
  O.sendPunch = function (w, o, d) {
    if (O.link) O.link.send('punch', { o: arr3(o), d: arr3(d) });
  };
  O.sendNade = function (x, y, z, vx, vy, vz) {
    if (O.link) O.link.send('nade', { p: [r3(x), r3(y), r3(z)], v: [r3(vx), r3(vy), r3(vz)] });
  };
  O.sendBoom = function (x, y, z) {
    if (O.link) O.link.send('boom', { p: [r3(x), r3(y), r3(z)] });
  };
  O.sendDmg = function (d) {
    if (O.link) O.link.send('dmg', d);
  };

  /** My position `ms` ago (for lag compensation). */
  O.histAt = function (t) {
    const h = O.hist;
    if (!h.length) return null;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1],
          b = h[i];
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, h: b.h };
      }
    }
    return h[h.length - 1];
  };

  /** Plausibility: the shooter really is near where its snapshots say it is. */
  function originOk(o) {
    const r = O.remote;
    return !r || Math.hypot(o.x - r.body.x, o.z - r.body.z) < 6 && Math.abs(o.y - (r.body.y + 1.62)) < 4;
  }

  O.handleShot = function (d) {
    const g = G();
    if (g.mode !== 'online' || !O.remote) return;
    const w = RV.WEAPON_BY_ID[d.w];
    const o = vec(d.o);
    let dir = vec(d.d);
    if (!w || w.kind !== 'gun' || !o || !dir) return;
    const l = Math.hypot(dir.x, dir.y, dir.z);
    if (l < 0.5 || l > 1.5) return;
    dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    // the shot is always shown (tracer + sound), hit or miss
    const range = Math.min(w.range, 180);
    const rh = {};
    const hitW = g.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range, rh);
    const tW = hitW ? rh.t : range;
    R().addTracer(o.x + dir.x * 0.6, o.y - 0.25 + dir.y * 0.6, o.z + dir.z * 0.6, o.x + dir.x * tW, o.y + dir.y * tW, o.z + dir.z * tW, w.tracer || 0xff6b5b, 0.05);
    if (hitW && tW < 70) RV.fx.impact(o.x + dir.x * tW, o.y + dir.y * tW, o.z + dir.z * tW, rh.nx, rh.ny, rh.nz, 'wall');
    RV.audio.play('botShot', clamp(1.2 - O.remote.dist / 60, 0.2, 1));
    // damage is decided here, only while a round is live, with a fire-rate and origin sanity check
    if (O.phase !== 'live' || g.playerDead) return;
    const now = performance.now();
    if (now - O.lastShotRx < w.interval * 1000 * 0.6) return;
    O.lastShotRx = now;
    if (!originOk(o)) return;
    const rewind = clamp((O.link ? O.link.rtt : 0.08) / 2 + INTERP_MS / 1000, 0.03, 0.3);
    const p = O.histAt(now - rewind * 1000);
    if (!p) return;
    const t = RV.rayAABB(o.x, o.y, o.z, dir.x, dir.y, dir.z, p.x - 0.35, p.y, p.z - 0.35, p.x + 0.35, p.y + p.h, p.z + 0.35, tW);
    if (t < 0) return;
    const head = o.y + dir.y * t >= p.y + p.h - 0.3;
    const dmg = Math.round(w.dmg * (head ? w.headMul || 1 : 1));
    g.hurtPlayer(dmg, o.x, o.z, O.remote);
    if (O.link) O.link.send('dmg', { kind: 'gun', dmg, head, kill: g.playerDead });
  };

  O.handlePunch = function (d) {
    const g = G();
    if (g.mode !== 'online' || !O.remote) return;
    const w = RV.WEAPON_BY_ID.fists;
    const o = vec(d.o);
    let dir = vec(d.d);
    if (!o || !dir) return;
    const l = Math.hypot(dir.x, dir.y, dir.z);
    if (l < 0.5 || l > 1.5) return;
    dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    RV.audio.play('swing');
    if (O.phase !== 'live' || g.playerDead) return;
    const now = performance.now();
    if (now - (O.lastPunchRx || 0) < w.interval * 1000 * 0.6) return;
    O.lastPunchRx = now;
    if (!originOk(o)) return;
    const rewind = clamp((O.link ? O.link.rtt : 0.08) / 2 + INTERP_MS / 1000, 0.03, 0.3);
    const p = O.histAt(now - rewind * 1000);
    if (!p) return;
    const rh = {};
    const range = w.range + 0.4;
    const hitW = g.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range, rh);
    const tW = hitW ? rh.t : range;
    const pad = w.reach;
    const t = RV.rayAABB(o.x, o.y, o.z, dir.x, dir.y, dir.z, p.x - 0.35 - pad, p.y - 0.15, p.z - 0.35 - pad, p.x + 0.35 + pad, p.y + p.h + 0.1, p.z + 0.35 + pad, tW);
    if (t < 0) return;
    g.hurtPlayer(w.dmg, o.x, o.z, O.remote);
    RV.audio.play('punchHit');
    if (O.link) O.link.send('dmg', { kind: 'fists', dmg: w.dmg, head: false, kill: g.playerDead });
  };

  O.onNade = function (d) {
    const g = G();
    if (g.mode !== 'online') return;
    const p = vec(d.p),
      v = vec(d.v);
    if (!p || !v || Math.hypot(v.x, v.y, v.z) > 60) return;
    RV.grenades.spawnRemote(g, p.x, p.y, p.z, v.x, v.y, v.z, RV.WEAPON_BY_ID.grenade);
    RV.audio.play('throw');
  };

  O.onBoom = function (d) {
    const g = G();
    const p = vec(d.p);
    if (g.mode !== 'online' || !p) return;
    RV.grenades.remoteBlast(g, p.x, p.y, p.z);
  };

  /** The opponent confirmed a hit I made: now (and only now) the hit marker + number appear. */
  O.onDmgAck = function (d) {
    const g = G();
    if (g.mode !== 'online' || !O.remote) return;
    const dmg = Math.round(clamp(num(d.dmg), 0, 200));
    const head = !!d.head,
      kill = !!d.kill;
    if (dmg <= 0) return;
    g.weapons.hits++;
    g.session.hits++;
    O.remote.flash = 0.07;
    RV.hud.hitMarker(kill);
    RV.hud.damageNumber(dmg, head, kill);
    RV.audio.play(kill ? 'kill' : head ? 'headshot' : 'hit');
    if (kill) {
      g.session.kills++;
      RV.hud.killfeed(RV.profile.display(), d.kind === 'gun' ? g.weapons.weapon.id : d.kind, O.oppName, 'k');
      RV.hud.eliminated(O.oppName);
    }
  };
})();
