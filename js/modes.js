/* DASHDUEL - game session, simulation loop glue and the game modes (Duel, Deathmatch, Practice, Time Trial). */
(function () {
  'use strict';
  const RV = window.RV;
  const P = RV.PHYS;
  const R = () => RV.render;

  const worlds = {};
  const CP_RADIUS = 3.4;

  const G = (RV.game = {
    state: 'menu', // menu | playing | paused | results
    mode: null,
    mapId: null,
    map: null,
    world: null,
    player: null,
    weapons: null,
    zoom: 0,
    hfov: 100,
    bots: [],
    nav: null,
    time: 0,
    acc: 0,
    eye: { x: 0, y: 0, z: 0 },
    fwd: { x: 0, y: 0, z: -1 },
    cmd: { fwd: 0, side: 0, jumpDown: false, jumpPressed: false, crouch: false, sprint: false },
    session: null,
    hist: [],
    hp: 150,
    armor: 0,
    playerDead: false,
    killedBy: null,
    modeImpl: null,
    fovBoost: 0,
    simActive: false,
  });

  const rng = RV.makeRng(4242);

  // ---------------------------------------------------------------------------
  // Session control
  // ---------------------------------------------------------------------------
  /** All state changes go through here so input is only live while actually playing. */
  G.setState = function (st) {
    G.state = st;
    RV.input.enabled = st === 'playing';
    if (st !== 'playing') RV.input.clear();
  };

  G.start = function (mode, mapId, opts) {
    G.mode = mode;
    G.mapId = mapId;
    G.opts = opts || {};
    G.map = RV.maps[mapId];
    G.world = worlds[mapId] || (worlds[mapId] = new RV.World(G.map));
    G.menuOpen = false;
    R().buildMap(G.map, G.world);
    if (!RV.grenades.ready) RV.grenades.build(R());
    RV.grenades.clear();
    G.clearBots();
    G.adsToggled = false;
    G.nav = null;
    G.player = new RV.Player(G.world);
    G.player.onEvent = G.onPlayerEvent;
    G.weapons = new RV.Loadout(G);
    G.zoom = 0;
    RV.input.onFire = G.onFirePress;
    RV.input.onUnlockedClick = G.onUnlockedClick;
    G.awaitLock = false;
    RV.input.onWheel = G.onWheel;
    G.modeImpl = RV.modes[mode];
    G.modeImpl.init(G);
    G.setState('playing');
    RV.ui.hideAll();
    RV.hud.show();
    R().warmup();
    G.beginRun();
    RV.input.requestLock();
    G.lockWait = 0;
    RV.audio.init();
    window.addEventListener('beforeunload', G.unloadGuard);
  };

  G.unloadGuard = function (e) {
    if (G.state === 'playing' || G.state === 'paused') {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  /** (Re)start the current run from scratch without rebuilding the map. */
  G.beginRun = function () {
    G.session = { shots: 0, hits: 0, kills: 0, deaths: 0, jumps: 0, startedAt: G.time, wallRunTime: 0 };
    G.refreshVitals();
    G.playerDead = false;
    G.killedBy = null;
    RV.grenades.clear();
    G.lastDamageT = -99;
    G.protUntil = 0;
    G.acc = 0;
    G.hist.length = 0;
    G.fovBoost = 0;
    G.weapons.reset();
    G.zoom = 0;
    G.adsToggled = false;
    G.player.autoHop = RV.settings.autoHop;
    G.player.maxSpeed = 0;
    for (const b of G.bots) b.alive = false;
    G.modeImpl.reset(G);
    RV.input.clear();
    RV.hud.reset();
    G.modeImpl.hudSetup && G.modeImpl.hudSetup(G);
  };

  /** Everyone has 150 health and no shield. */
  G.refreshVitals = function () {
    G.hp = RV.MAX_HP;
    G.armor = 0;
  };

  G.restart = function () {
    if (!G.modeImpl || G.modeImpl.realtime) return; // an online match cannot be restarted
    G.beginRun();
    if (G.state === 'results') G.setState('playing');
  };

  G.pause = function () {
    if (G.state !== 'playing') return;
    if (G.modeImpl && G.modeImpl.realtime) {
      // online: opponents do not wait for you. The menu opens over the live match, your keys are released.
      if (G.menuOpen) return;
      G.menuOpen = true;
      G.adsToggled = false;
      RV.input.enabled = false;
      RV.input.clear();
      RV.input.exitLock();
      RV.audio.loop('wind', 0);
      RV.audio.loop('slide', 0);
      RV.audio.loop('wallrun', 0);
      RV.ui.showPause();
      return;
    }
    G.setState('paused');
    G.adsToggled = false;
    RV.input.exitLock(); // make sure the cursor is free to click the pause menu
    RV.audio.loop('wind', 0);
    RV.audio.loop('slide', 0);
    RV.audio.loop('wallrun', 0);
    RV.ui.showPause();
  };

  G.resume = function () {
    if (G.menuOpen) {
      G.menuOpen = false;
      RV.input.enabled = G.state === 'playing';
      RV.input.clear();
      RV.ui.hideAll();
      G.acc = 0;
      return;
    }
    if (G.state !== 'paused') return;
    G.setState('playing');
    RV.ui.hideAll();
    G.acc = 0;
  };

  G.stop = function () {
    window.removeEventListener('beforeunload', G.unloadGuard);
    if (G.modeImpl && G.modeImpl.stop) G.modeImpl.stop(G);
    RV.grenades.clear();
    G.menuOpen = false;
    G.setState('menu');
    RV.input.exitLock();
    RV.audio.loop('wind', 0);
    RV.audio.loop('slide', 0);
    RV.audio.loop('wallrun', 0);
    RV.hud.hide();
    G.clearBots();
    if (R().rings) R().setCheckpointStates(99);
  };

  G.clearBots = function () {
    for (const b of G.bots) RV.render.removeBotMesh(b.mesh);
    G.bots = [];
  };

  /** Lock changes: Esc releases the mouse -> pause; clicking Resume re-locks -> resume. */
  G.onLockChange = function (locked, error) {
    if (RV.input.noLock) return;
    if (locked) G.awaitLock = false;
    // an online match that started by itself (no click on "Enter match") cannot lock the mouse until the player clicks:
    // that refusal is expected, so show "click to capture the mouse" instead of opening the pause menu
    else if (error && G.awaitLock && G.state === 'playing' && !G.menuOpen) return;
    if (G.state === 'playing' && !G.menuOpen && (!locked || error)) G.pause();
    else if ((G.state === 'paused' || G.menuOpen) && locked && !RV.ui.settingsOpenFromPause) G.resume();
  };

  /** A click while the mouse is not captured: this is the user gesture the browser wants for the pointer lock. */
  G.onUnlockedClick = function () {
    if (G.awaitLock && G.state === 'playing' && !G.menuOpen) RV.input.requestLock();
  };
  // Esc while the mouse was never captured (no pointer-lock change fires then): open the menu by hand
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && G.awaitLock && G.state === 'playing' && !G.menuOpen && !RV.input.isLocked()) G.pause();
  });

  // ---------------------------------------------------------------------------
  // Shooting + weapon switching input
  // ---------------------------------------------------------------------------
  /** May the player pull the trigger right now? */
  G.canShoot = function () {
    const m = G.modeImpl;
    if (!m || G.playerDead) return false;
    return typeof m.canShoot === 'function' ? m.canShoot(G) : m.canShoot !== false;
  };

  /**
   * A fire press is resolved inside the click event itself, using the exact pose
   * that is on screen. The per-frame path then only handles holding auto fire.
   */
  G.onFirePress = function () {
    if (G.state !== 'playing' || !RV.input.isLocked() || !G.weapons || !G.canShoot()) return;
    if (G.weapons.tryShotNow({ eye: G.eye, fwd: G.fwd })) RV.input.consume('fire');
  };

  G.onWheel = function (dir) {
    if (G.state !== 'playing' || !RV.settings.wheelSwitch || G.playerDead || !G.weapons) return;
    G.weapons.cycle(dir);
  };

  /** Weighted random weapon for an AI opponent. */
  G.pickBotWeapon = function (avoidId) {
    const wt = { rifle: 3, pistol: 2, fists: 0.9 };
    let tot = 0;
    for (const k in wt) if (k !== avoidId) tot += wt[k];
    let r = rng() * tot;
    for (const k in wt) {
      if (k === avoidId) continue;
      r -= wt[k];
      if (r <= 0) return k;
    }
    return 'rifle';
  };

  // ---------------------------------------------------------------------------
  // Player events
  // ---------------------------------------------------------------------------
  G.onPlayerEvent = function (type, data) {
    const A = RV.audio;
    switch (type) {
      case 'jump':
        A.play('jump');
        G.session.jumps++;
        RV.viewmodel.onJump();
        break;
      case 'land':
        A.play('land', data.impact);
        RV.viewmodel.onLand(data.impact);
        break;
      case 'slide':
        A.play('slide');
        break;
      case 'walljump':
        A.play('walljump');
        G.session.jumps++;
        RV.viewmodel.onJump();
        break;
      case 'doublejump':
        A.play('djump');
        G.session.jumps++;
        G.session.doubleJumps = (G.session.doubleJumps || 0) + 1;
        RV.viewmodel.onDoubleJump();
        RV.fx.ring(data.x, data.y, data.z);
        RV.hud.doubleJump();
        break;
      case 'wallrun':
        A.play('wallrun');
        break;
      case 'pad':
        A.play('pad');
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // Combat helpers
  // ---------------------------------------------------------------------------
  /** cause: 'grenade' for the player's own blast; bot = the attacker (null for the void / own grenade). */
  G.hurtPlayer = function (dmg, sx, sz, bot, cause) {
    if (G.playerDead || !G.modeImpl.pvp || G.state !== 'playing') return;
    if (cause !== 'void' && G.time < G.protUntil) return; // spawn protection (falling out of the map still kills)
    RV.takeDamage(G, dmg);
    G.lastDamageT = G.time;
    RV.hud.damageFlash();
    RV.hud.addDamageSource(sx, sz);
    RV.audio.play('hurt');
    if (G.hp <= 0) {
      G.hp = 0;
      G.playerDead = true;
      G.session.deaths++;
      G.deadAt = G.time;
      G.player.frozen = true;
      RV.audio.play('die');
      const wname = bot ? bot.weapon.name : cause === 'grenade' ? 'Grenade' : 'Fall';
      G.killedBy = { name: bot ? bot.name : 'the void', weapon: wname, weaponId: bot ? bot.weaponId : null };
      RV.hud.killfeed(bot ? bot.name : 'World', null, RV.profile.display(), 'd'); // no weapon icon: opponents' weapons stay private
      if (bot) bot.kills++;
      G.modeImpl.onPlayerDeath && G.modeImpl.onPlayerDeath(G, bot);
    }
  };

  G.onBotKilled = function (bot, w) {
    G.session.kills++;
    RV.hud.killfeed(RV.profile.display(), w ? w.id : null, bot.dummy ? 'Target' : bot.name, 'k');
    RV.hud.eliminated(bot.dummy ? 'Target down' : bot.name);
    G.modeImpl.onBotKilled && G.modeImpl.onBotKilled(G, bot);
  };

  /** Pick the spawn that is furthest from everything in `avoid` (+ a little randomness). */
  G.pickSpawn = function (avoid) {
    let best = null,
      bd = -1;
    for (const s of G.map.spawns) {
      let d = 1e9;
      for (const a of avoid) d = Math.min(d, Math.hypot(a.x - s.x, a.z - s.z, (a.y - s.y) * 0.5));
      d += rng() * 6;
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  /** Spawn protection for the player (bot = null) or a bot: no damage for RV.SPAWN_PROTECT_S, until they attack. */
  G.protect = function (bot) {
    if (bot) bot.protUntil = G.time + RV.SPAWN_PROTECT_S;
    else G.protUntil = G.time + RV.SPAWN_PROTECT_S;
  };

  G.respawnBot = function (bot) {
    const avoid = [{ x: G.player.b.x, y: G.player.b.y, z: G.player.b.z }];
    for (const o of G.bots) if (o !== bot && o.alive) avoid.push(o.body);
    if (bot.dummy) {
      bot.spawn(bot.home.x, bot.home.y, bot.home.z, bot.yaw);
      return;
    }
    const s = G.pickSpawn(avoid);
    bot.setWeapon(G.pickBotWeapon(bot.weaponId));
    bot.spawn(s.x, s.y, s.z, s.yaw);
    if (G.modeImpl.pvp) G.protect(bot);
  };

  G.sampleHistory = function (t) {
    const h = G.hist;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i];
    return h[0] || { x: G.player.b.x, y: G.player.b.y, z: G.player.b.z, vx: 0, vz: 0 };
  };

  // ---------------------------------------------------------------------------
  // Frame update (variable dt) with fixed-step player simulation inside
  // ---------------------------------------------------------------------------
  G.update = function (dtReal) {
    const inp = RV.input,
      S = RV.settings,
      pl = G.player;
    if (!pl) return;
    // (an online match runs in real time: it keeps simulating even while the menu is open)
    const live = G.state === 'playing' && (inp.isLocked() || !!(G.modeImpl && G.modeImpl.realtime));
    if (G.menuOpen) inp.clear();
    G.simActive = live;

    if (live) {
      G.time += dtReal;

      // mouse look: applied directly so aiming has no added latency.
      // While scoped the look speed scales with the zoom so aiming stays 1:1.
      const zr = S.scopeSens ? Math.tan((G.hfov * Math.PI) / 360) / Math.tan((S.fov * Math.PI) / 360) : 1;
      const sens = 0.0022 * S.sens * RV.lerp(1, zr * S.adsSens, G.zoom);
      if (!G.playerDead && G.modeImpl.canLook !== false) {
        pl.yaw -= inp.lookDX * sens;
        pl.pitch -= inp.lookDY * sens * (S.invertY ? -1 : 1);
        if (pl.pitch > 1.553) pl.pitch = 1.553;
        else if (pl.pitch < -1.553) pl.pitch = -1.553;
        if (pl.yaw > Math.PI) pl.yaw -= RV.TAU;
        else if (pl.yaw < -Math.PI) pl.yaw += RV.TAU;
      }
      inp.lookDX = 0;
      inp.lookDY = 0;

      // one-shot actions
      if (inp.consume('restart')) {
        G.restart();
        return;
      }
      // weapon switching (number keys, previous-weapon key; wheel is handled by the input layer)
      if (!G.playerDead) {
        for (let i = 0; i < RV.WEAPONS.length; i++) if (inp.consume('weapon' + (i + 1))) G.weapons.select(i);
        if (inp.consume('lastweapon')) G.weapons.selectLast();
      }
      if (inp.consume('respawn')) G.modeImpl.onRespawnKey && G.modeImpl.onRespawnKey(G);
      if (inp.consume('setspawn')) G.modeImpl.onSetSpawnKey && G.modeImpl.onSetSpawnKey(G);

      // the double jump exists only while the Fists are equipped
      pl.djEnabled = !!G.weapons.weapon.doubleJump && !G.playerDead;

      // fixed-step movement
      G.acc += dtReal;
      let steps = 0;
      const cmd = G.cmd;
      while (G.acc >= P.STEP && steps < 12) {
        inp.getCmd(cmd);
        if (G.playerDead || pl.frozen) {
          cmd.fwd = cmd.side = 0;
          cmd.jumpDown = cmd.jumpPressed = cmd.crouch = false;
        }
        pl.step(P.STEP, cmd);
        G.modeImpl.fixedStep(G, P.STEP);
        G.acc -= P.STEP;
        steps++;
        if (G.state !== 'playing') break;
      }
      if (steps >= 12) G.acc = 0;
    }

    const alpha = live ? G.acc / P.STEP : 1;
    pl.getEye(alpha, G.eye);
    pl.getForward(G.fwd);

    // aim down sights: hold (default) or toggle. Only the picture changes (field of view and
    // weapon position); the shot always leaves the centre of the view along the crosshair.
    const speed = pl.speedH;
    let wantAds = false;
    if (live && !G.playerDead) {
      const pressed = inp.consume('aim');
      G.aimEdge = pressed;
      if (S.adsToggle) {
        if (pressed) G.adsToggled = !G.adsToggled;
        wantAds = G.adsToggled;
      } else {
        wantAds = inp.isDown('aim');
        G.adsToggled = false;
      }
    } else {
      G.adsToggled = false;
      G.aimEdge = false;
      inp.consume('aim');
    }
    if (G.weapons.reloading || G.weapons.switchT > 0) G.adsToggled = false;
    G.zoom = G.weapons.updateAds(live ? dtReal : 0, wantAds);
    const kickTarget = S.fovKick ? RV.clamp((speed - 10) * 0.5, 0, 12) : 0;
    G.fovBoost = RV.damp(G.fovBoost, kickTarget, 5, dtReal);
    const baseH = S.fov + G.fovBoost * (1 - G.zoom);
    G.hfov = G.zoom > 0 ? RV.lerp(baseH, G.weapons.adsTargetFov(S.fov), G.zoom) : baseH;
    const rr = R();
    rr.updateCamera(G.eye.x, G.eye.y, G.eye.z, pl.yaw, pl.pitch, S.cameraTilt ? pl.roll * (1 - G.zoom) : 0, Math.round(G.hfov * 4) / 4);
    rr.camera.updateMatrixWorld(true);
    rr.camera.matrixWorldInverse.copy(rr.camera.matrixWorld).invert();

    if (live) {
      // history for bot reaction delay
      const pb = pl.b;
      G.hist.push({ t: G.time, x: pb.x, y: pb.y, z: pb.z, vx: pb.vx, vz: pb.vz });
      while (G.hist.length > 90) G.hist.shift();

      // weapon (uses the exact camera pose that is being displayed)
      const firePress = inp.consume('fire');
      G.weapons.update(dtReal, {
        eye: G.eye,
        fwd: G.fwd,
        vel: pl.b,
        // with the grenade out, EITHER mouse button holds it (R cancels)
        fireHeld: inp.isDown('fire') || (G.weapons.weapon.kind === 'grenade' && inp.isDown('aim')),
        firePressed: firePress || (G.weapons.weapon.kind === 'grenade' && !!G.aimEdge),
        reloadPressed: inp.consume('reload'),
        canFire: G.canShoot(),
      });

      // thrown grenades fly, bounce and explode; a held one shows its path and landing circle
      RV.grenades.update(dtReal, G);
      RV.grenades.preview(G, G.weapons.holding ? { eye: G.eye, fwd: G.fwd, vel: pl.b, holdT: G.weapons.holdT, dt: dtReal } : null);
      RV.hud.nadeHold(G.weapons.holding, G.weapons.holdT / RV.WEAPON_BY_ID.grenade.hold.total, G.weapons.holdT > RV.WEAPON_BY_ID.grenade.hold.still);

      // footsteps (distance based, quiet; none while sliding / airborne)
      if (pl.b.grounded && pl.mode !== 'slide' && speed > 1.5) {
        G.stepAcc = (G.stepAcc || 0) + speed * dtReal;
        const iv = speed > 9 ? 2.4 : 1.75;
        if (G.stepAcc >= iv) {
          G.stepAcc -= iv;
          RV.audio.play('step', RV.clamp(speed / 11, 0.35, 1));
        }
      } else G.stepAcc = 0;

      // first-person weapon pose (cosmetic only: it reads state, it never feeds anything back)
      const vs = G.vmState || (G.vmState = {});
      G.weapons.viewState(vs);
      vs.speed = pl.speedH;
      vs.grounded = pl.b.grounded;
      vs.sliding = pl.mode === 'slide' && pl.b.grounded;
      vs.wallrun = pl.wallRunning;
      vs.wallSide = pl.wallSide;
      vs.sprint = G.cmd.sprint && G.cmd.fwd > 0;
      vs.vy = pl.b.vy;
      vs.firing = inp.isDown('fire') && G.canShoot();
      vs.fx = R().fxLevel || S.effects;
      RV.viewmodel.update(dtReal, vs);

      // opponents
      const bdt = Math.min(dtReal, 0.05);
      const botsOn = !G.modeImpl.botsActive || G.modeImpl.botsActive(G);
      for (let i = 0; i < G.bots.length; i++) if (botsOn || !G.bots[i].alive) G.bots[i].update(bdt, G);

      G.modeImpl.frame(G, dtReal);

      // health regen (arena)
      if (G.mode === 'arena' && !G.playerDead && G.hp < RV.MAX_HP && G.time - G.lastDamageT > 4) {
        G.hp = Math.min(RV.MAX_HP, G.hp + 25 * dtReal);
      }

      // ambient sound
      const A = RV.audio;
      if (A.ready) {
        A.loop('wind', RV.clamp((speed - 9) / 36, 0, 0.45) * (pl.b.grounded && speed < 14 ? 0.4 : 1), 0.7 + speed / 40);
        A.loop('slide', pl.mode === 'slide' && pl.b.grounded ? RV.clamp(speed / 30, 0.1, 0.4) : 0, 0.8 + speed / 40);
        A.loop('wallrun', pl.wallRunning ? 0.22 : 0);
      }
    }

    // HUD (also while paused so the last state stays visible)
    const hud = RV.hud;
    hud.setSpeed(speed, pl.maxSpeed, pl.stateLabel);
    hud.setVitals(G.hp);
    const wp = G.weapons;
    hud.setWeapon(wp.weapon, wp.ammo, wp.reloading, wp.grenades, wp.grenadeCharge(), wp.grenades < RV.WEAPON_BY_ID.grenade.maxCount ? wp.gregen : 0, wp.reserve);
    hud.setProtect(G.mode === 'online' ? RV.online.prot : Math.max(0, G.protUntil - G.time));
    hud.setLockPrompt(G.awaitLock && G.state === 'playing' && !G.menuOpen && !RV.input.isLocked());
    hud.setWeaponBar(wp.cur, wp.grenades, wp.grenadeCharge(), wp.weapon.doubleJump ? (pl.djUsed ? 2 : 1) : 0);
    rr.vm.hidden = false;
    hud.setAdsFade(G.zoom);
    hud.deathScreen(G.playerDead && G.state === 'playing', G.killedBy, G.modeImpl.respawnIn ? G.modeImpl.respawnIn(G) : -1);
    hud.updateDamage(dtReal, pl.b.x, pl.b.z, pl.yaw);
    G.modeImpl.hud && G.modeImpl.hud(G);
  };

  // ===========================================================================
  // Mode: Time Trial
  // ===========================================================================
  const TT = {
    canLook: true,
    init(g) {
      g.player.frozen = true;
    },
    reset(g) {
      const m = g.map,
        sp = m.spawns[0];
      g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = true;
      this.cp = 0;
      this.time = 0;
      this.running = false;
      this.finished = false;
      this.countdown = 1.35;
      this.lastCount = 9;
      this.splits = [];
      this.respawns = 0;
      this.finishDelay = 0;
      this.pb = RV.records.tt(g.mapId);
      this.topSpeed = 0;
      this.hintT = 6;
      R().setCheckpointStates(0);
    },
    hudSetup(g) {
      RV.hud.setTitle('Time Trial · ' + g.map.name);
      RV.hud.setTimer('0:00.00');
      RV.hud.hint('Follow the marker · <b>Ctrl/C</b> slide · <b>Q</b> back to checkpoint · <b>T</b> restart');
    },
    canShoot: true,
    fixedStep(g, dt) {
      if (!this.running) return;
      const b = g.player.b;
      this.time += dt;
      if (g.player.speedH > this.topSpeed) this.topSpeed = g.player.speedH;
      const cps = g.map.checkpoints;
      const cp = cps[this.cp];
      if (cp) {
        const dx = b.x - cp.x,
          dy = b.y + 0.9 - cp.y,
          dz = b.z - cp.z;
        if (dx * dx + dy * dy + dz * dz < CP_RADIUS * CP_RADIUS) this.passCheckpoint(g);
      }
      if (this.running && b.y < g.map.killY) this.respawnAtCheckpoint(g);
    },
    passCheckpoint(g) {
      const idx = this.cp;
      const t = this.time;
      this.splits[idx] = t;
      const last = idx === g.map.checkpoints.length - 1;
      const pbSplit = this.pb.splits && this.pb.splits[idx];
      if (pbSplit != null && !last) {
        const d = t - pbSplit;
        RV.hud.split(RV.fmtDelta(d), d <= 0 ? 'good' : 'bad');
      } else if (!last) {
        RV.hud.split(RV.fmtTime(t), '');
      }
      this.cp++;
      R().setCheckpointStates(this.cp);
      if (last) {
        this.running = false;
        this.finished = true;
        this.finishDelay = 0.9;
        RV.audio.play('finish');
        RV.hud.center('FINISH', '#facc15', true, 1200);
      } else {
        RV.audio.play('checkpoint');
      }
    },
    respawnAtCheckpoint(g) {
      const cps = g.map.checkpoints;
      let x, y, z, yaw;
      if (this.cp === 0) {
        const sp = g.map.spawns[0];
        x = sp.x;
        y = sp.y;
        z = sp.z;
        yaw = sp.yaw;
      } else {
        const c = cps[this.cp - 1];
        x = c.x;
        y = c.y - 1.8;
        z = c.z;
        const n = cps[this.cp];
        yaw = n ? Math.atan2(-(n.x - c.x), -(n.z - c.z)) : 0;
      }
      g.player.reset(x, y, z, yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.maxSpeed = this.topSpeed;
      this.respawns++;
      RV.audio.play('respawn');
    },
    onRespawnKey(g) {
      if (this.running) this.respawnAtCheckpoint(g);
    },
    frame(g, dt) {
      if (this.countdown > 0) {
        this.countdown -= dt;
        const n = Math.ceil(Math.max(0, this.countdown) / 0.45);
        if (this.countdown > 0 && n !== this.lastCount) {
          this.lastCount = n;
          RV.hud.center(String(n), '#fff', true);
          RV.audio.play('beep');
        }
        if (this.countdown <= 0) {
          this.running = true;
          g.player.frozen = false;
          g.player.maxSpeed = 0;
          RV.audio.play('go');
          RV.hud.center('GO', '#a3e635', true, 600);
        }
      }
      if (this.hintT > 0 && this.running) {
        this.hintT -= dt;
        if (this.hintT <= 0) RV.hud.hint('');
      }
      if (this.finished) {
        this.finishDelay -= dt;
        if (this.finishDelay <= 0) {
          this.finished = false;
          this.showResults(g);
        }
      }
    },
    hud(g) {
      const total = g.map.checkpoints.length;
      RV.hud.setTimer(RV.fmtTime(this.time));
      const best = this.pb.best != null ? '  ·  PB ' + RV.fmtTime(this.pb.best) : '';
      RV.hud.setSub('Checkpoint ' + Math.min(this.cp, total) + ' / ' + total + best);
      const next = g.map.checkpoints[this.cp];
      if (next && g.state === 'playing') {
        const p = g.player.b;
        const d = Math.hypot(next.x - p.x, next.y - (p.y + 0.9), next.z - p.z);
        RV.hud.marker(R().camera, next.x, next.y, next.z, d.toFixed(0) + ' m', this.cp === total - 1);
      } else RV.hud.markerHide();
    },
    showResults(g) {
      const res = RV.records.submitRun(g.mapId, this.time, this.splits, this.topSpeed);
      g.setState('results');
      RV.input.exitLock();
      RV.audio.loop('wind', 0);
      RV.audio.loop('slide', 0);
      RV.audio.loop('wallrun', 0);
      RV.ui.showResults({
        title: res.pb ? 'New personal best!' : 'Run complete',
        big: RV.fmtTime(this.time),
        bigClass: res.pb ? 'pb' : '',
        sub: g.map.name + (res.delta != null ? '  ·  ' + (res.delta <= 0 ? '' : '+') + res.delta.toFixed(2) + ' vs previous best' : '  ·  first finish'),
        rows: [
          ['Top speed', this.topSpeed.toFixed(1) + ' m/s'],
          ['Checkpoint respawns', String(this.respawns)],
          ['Personal best', RV.fmtTime(Math.min(this.time, res.prevBest == null ? this.time : res.prevBest))],
        ],
        splits: this.splits,
      });
    },
    stop(g) {
      RV.hud.markerHide();
    },
  };

  // ===========================================================================
  // Mode: Arena Combat
  // ===========================================================================
  const ARENA = {
    pvp: true,
    canLook: true,
    canShoot: true,
    botsActive() {
      return this.countdown <= 0 && !this.over;
    },
    init(g) {
      g.nav = new RV.Nav(g.world, g.map.spawns);
      g.clearBots();
      const n = g.opts.bots || RV.settings.botCount;
      for (let i = 0; i < n; i++) g.bots.push(new RV.Bot(g, i, g.opts.diff || RV.settings.difficulty, false));
    },
    reset(g) {
      this.killLimit = g.opts.kills || RV.settings.killLimit;
      this.timeLeft = 300;
      this.over = false;
      this.bannerT = 0;
      this.matchTime = 0;
      this.countdown = 1.0;
      this.respawnT = 0;
      this.deathShown = false;
      this.hintT = 7;
      g.player.frozen = true;
      const sp = g.pickSpawn([]);
      g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = true;
      for (const b of g.bots) {
        b.kills = 0;
        b.deaths = 0;
      }
      // spread bots out
      const avoid = [{ x: sp.x, y: sp.y, z: sp.z }];
      for (const b of g.bots) {
        const s = g.pickSpawn(avoid);
        b.setWeapon(g.pickBotWeapon());
        b.spawn(s.x, s.y, s.z, s.yaw);
        b.respawnAt = 0;
        avoid.push({ x: s.x, y: s.y, z: s.z });
      }
    },
    hudSetup(g) {
      RV.hud.setTitle('Deathmatch · ' + g.map.name + ' · ' + (g.opts.diff || RV.settings.difficulty));
      RV.hud.hint('First to <b>' + this.killLimit + '</b> eliminations · <b>1-4</b> or wheel to switch weapons · <b>Fists</b> unlock the double jump');
    },
    fixedStep(g, dt) {
      if (g.player.b.y < g.map.killY && !g.playerDead) {
        g.hp = 1;
        g.hurtPlayer(10, g.player.b.x, g.player.b.z, null, 'void');
      }
    },
    onPlayerDeath(g, bot) {
      this.respawnT = 1.2;
    },
    onBotKilled(g, bot) {
      if (!this.over && g.session.kills >= this.killLimit) this.end(g, true);
    },
    frame(g, dt) {
      if (this.hintT > 0) {
        this.hintT -= dt;
        if (this.hintT <= 0) RV.hud.hint('');
      }
      if (this.countdown > 0) {
        this.countdown -= dt;
        if (this.countdown <= 0) {
          g.player.frozen = false;
          g.protect(null);
          for (const b of g.bots) g.protect(b);
          RV.audio.play('go');
          RV.hud.center('FIGHT', '#f87171', true, 700);
        }
        return;
      }
      if (this.over) {
        // match finished: show the summary card over the live game, then start the next match.
        // (Nothing pauses and the mouse stays locked.)
        if (this.bannerT > 0) {
          this.bannerT -= dt;
          if (this.bannerT <= 0) {
            RV.hud.matchBanner(false);
            g.restart();
          }
        }
        return;
      }
      this.matchTime += dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.end(g, false);
        return;
      }
      if (g.playerDead) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) {
          const avoid = g.bots.filter((b) => b.alive).map((b) => b.body);
          const s = g.pickSpawn(avoid);
          g.player.reset(s.x, s.y, s.z, s.yaw, 0);
          g.player.autoHop = RV.settings.autoHop;
          g.refreshVitals();
          g.playerDead = false;
          this.deathShown = false;
          g.weapons.refill();
          g.protect(null);
          RV.audio.play('respawn');
          RV.hud.centerHide();
        } else if (!this.deathShown) {
          this.deathShown = true;
        }
      }
    },
    respawnIn(g) {
      return Math.max(0, this.respawnT);
    },
    hud(g) {
      const tl = Math.max(0, this.timeLeft);
      RV.hud.setTimer(Math.floor(tl / 60) + ':' + String(Math.floor(tl % 60)).padStart(2, '0'));
      RV.hud.setSub('Eliminations ' + g.session.kills + ' / ' + this.killLimit + '   ·   Deaths ' + g.session.deaths);
      RV.hud.markerHide();
      const sb = RV.input.isDown('scoreboard');
      if (sb) {
        let html = '<table><tr><th>Player</th><th>Elims</th><th>Deaths</th></tr>';
        html += '<tr class="me"><td>' + RV.profile.display() + '</td><td>' + g.session.kills + '</td><td>' + g.session.deaths + '</td></tr>';
        for (const b of g.bots) html += '<tr><td>' + b.name + '</td><td>' + b.kills + '</td><td>' + b.deaths + '</td></tr>';
        html += '</table>';
        RV.hud.scoreboard(true, html);
      } else RV.hud.scoreboard(false);
    },
    end(g, won) {
      this.over = true;
      RV.audio.play(won ? 'finish' : 'die');
      RV.hud.center(won ? 'VICTORY' : "TIME'S UP", won ? '#a3e635' : '#facc15', true, 1500);
      const s = g.session;
      const dur = Math.min(300, this.matchTime);
      const res = RV.records.submitArena(g.mapId, {
        kills: s.kills,
        deaths: s.deaths,
        won,
        time: dur,
        shots: s.shots,
        hits: s.hits,
        topSpeed: g.player.maxSpeed,
      });
      const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
      const summary = {
        title: won ? 'Victory' : "Time's up",
        big: s.kills + ' elims',
        bigClass: won ? 'pb' : '',
        sub: g.map.name + (res.newBest ? '  ·  new personal best' : ''),
        rows: [
          ['Deaths', String(s.deaths)],
          ['K / D', (s.deaths ? s.kills / s.deaths : s.kills).toFixed(2)],
          ['Accuracy', acc + '%  (' + s.hits + '/' + s.shots + ')'],
          ['Top speed', g.player.maxSpeed.toFixed(1) + ' m/s'],
          ['Match time', RV.fmtTime(dur, 1)],
        ],
      };
      if (RV.settings.resultsScreen) {
        // optional old behaviour: pause on a results screen
        setTimeout(() => {
          if (g.state !== 'playing' && g.state !== 'paused') return;
          g.setState('results');
          RV.input.exitLock();
          RV.audio.loop('wind', 0);
          RV.audio.loop('slide', 0);
          RV.audio.loop('wallrun', 0);
          RV.ui.showResults(summary);
        }, 1400);
      } else {
        // (the player keeps full control while the summary card is up)
        this.bannerT = 4.2;
        setTimeout(() => {
          if (this.over && g.state === 'playing') RV.hud.matchBanner(true, summary);
        }, 900);
      }
    },
    stop(g) {},
  };

  // ===========================================================================
  // Mode: Practice
  // ===========================================================================
  const PRACTICE = {
    canLook: true,
    canShoot: true,
    init(g) {
      g.clearBots();
      const list = g.map.dummies || [];
      list.forEach((d, i) => {
        const b = new RV.Bot(g, i, 'normal', true);
        b.pace = d.pace || null;
        g.bots.push(b);
        b._dummyDef = d;
      });
      this.marked = null;
      this.startedAt = 0;
    },
    reset(g) {
      const sp = g.map.spawns[0];
      g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = false;
      this.marked = this.marked || null;
      this.sessionTop = 0;
      this.air = 0;
      this.bestChain = 0;
      for (const b of g.bots) {
        const d = b._dummyDef;
        b.spawn(d.x, d.y, d.z, d.yaw || 0);
        b.respawnAt = 0;
      }
      this.noted = false;
    },
    hudSetup(g) {
      RV.hud.setTitle('Practice · ' + g.map.name);
      RV.hud.setTimer('');
      RV.hud.setSub('');
      RV.hud.hint('Free play · <b>1-4</b> weapons · <b>Q</b> spawn · <b>E</b> set spawn · <b>T</b> reset · <b>Esc</b> menu');
      setTimeout(() => RV.hud.hint(''), 7000);
    },
    fixedStep(g, dt) {
      const p = g.player;
      if (p.b.y < g.map.killY) this.toSpawn(g);
      if (p.hopChain > this.bestChain) this.bestChain = p.hopChain;
    },
    toSpawn(g) {
      const m = this.marked;
      if (m) g.player.reset(m.x, m.y, m.z, m.yaw, m.pitch);
      else {
        const sp = g.map.spawns[0];
        g.player.reset(sp.x, sp.y, sp.z, sp.yaw, 0);
      }
      g.player.autoHop = RV.settings.autoHop;
      g.player.maxSpeed = this.sessionTop;
      RV.audio.play('respawn');
    },
    onRespawnKey(g) {
      this.toSpawn(g);
    },
    onSetSpawnKey(g) {
      const b = g.player.b;
      if (!b.grounded) {
        RV.hud.toast('Land first to set a spawn');
        return;
      }
      this.marked = { x: b.x, y: b.y, z: b.z, yaw: g.player.yaw, pitch: g.player.pitch };
      RV.audio.play('checkpoint');
      RV.hud.toast('Spawn point set · Q returns here');
    },
    frame(g, dt) {
      const p = g.player;
      if (p.maxSpeed > this.sessionTop) this.sessionTop = p.maxSpeed;
    },
    hud(g) {
      const p = g.player;
      RV.hud.markerHide();
      RV.hud.practice(
        true,
        'speed ' + p.speedH.toFixed(1) + ' · vertical ' + p.b.vy.toFixed(1) + ' · hop chain ' + p.hopChain + ' · best chain ' + this.bestChain
      );
    },
    stop(g) {
      if (!this.noted) {
        this.noted = true;
        RV.records.notePractice(this.sessionTop || 0, g.time);
      }
      RV.hud.practice(false);
    },
  };

  // ===========================================================================
  // Mode: Duel - 1v1 against an AI opponent. Rounds end on an elimination, then
  // everything resets automatically. First to N round wins takes the match.
  // ===========================================================================
  const DUEL = {
    pvp: true,
    canLook: true,
    canShoot(g) {
      return this.phase !== 'countdown';
    },
    botsActive() {
      return this.phase === 'live';
    },
    init(g) {
      g.nav = new RV.Nav(g.world, g.map.spawns);
      g.clearBots();
      const bot = new RV.Bot(g, g.opts.botIndex != null ? g.opts.botIndex : Math.floor(rng() * 8), g.opts.diff || RV.settings.difficulty, false);
      bot.noAutoRespawn = true;
      g.bots.push(bot);
      this.lastWeapon = null;
    },
    reset(g) {
      this.to = g.opts.duelTo || RV.settings.duelTo;
      this.flip = false;
      this.startMatch(g);
    },
    /** (Re)start a whole match: scores and per-match stats go back to zero. */
    startMatch(g) {
      this.score = { you: 0, bot: 0 };
      this.round = 0;
      this.over = false;
      this.matchTime = 0;
      this.lastWeapon = null;
      const s = g.session;
      s.shots = s.hits = s.kills = s.deaths = 0;
      g.player.maxSpeed = 0;
      g.weapons.shots = g.weapons.hits = 0;
      this.startRound(g);
    },
    startRound(g) {
      this.round++;
      this.phase = 'countdown';
      this.phaseT = 3.0;
      this.lastCount = 9;
      this.roundT = 75;
      const bot = g.bots[0];
      // spawn on opposite sides; the side alternates every round
      const sp = g.map.spawns;
      const a = sp[Math.floor(rng() * sp.length)];
      let far = a,
        fd = -1;
      for (const s of sp) {
        const d = Math.hypot(s.x - a.x, s.z - a.z, (s.y - a.y) * 0.5) + rng() * 3;
        if (d > fd) {
          fd = d;
          far = s;
        }
      }
      this.flip = !this.flip;
      const ps = this.flip ? a : far,
        bs = this.flip ? far : a;
      g.player.reset(ps.x, ps.y, ps.z, ps.yaw, 0);
      g.player.autoHop = RV.settings.autoHop;
      g.player.frozen = true; // 3 s locked in your own spawn; after a round you are never frozen, only at the start
      g.refreshVitals();
      g.playerDead = false;
      g.killedBy = null;
      g.hist.length = 0;
      g.weapons.refill();
      RV.grenades.clear();
      g.acc = 0;
      bot.hp = RV.MAX_HP;
      const wid = g.pickBotWeapon(this.lastWeapon);
      this.lastWeapon = wid;
      bot.setWeapon(wid);
      bot.spawn(bs.x, bs.y, bs.z, bs.yaw);
      bot.respawnAt = 0;
      RV.hud.centerHide();
      RV.hud.hint('Round ' + this.round + ' \u00b7 opponent <b>' + bot.name + '</b>');
    },
    hudSetup(g) {
      RV.hud.setTitle('Duel · ' + g.map.name + ' · ' + (g.opts.diff || RV.settings.difficulty));
    },
    fixedStep(g, dt) {
      if (this.phase === 'live' && g.player.b.y < g.map.killY && !g.playerDead) g.hurtPlayer(999, g.player.b.x, g.player.b.z, null, 'void');
    },
    onPlayerDeath(g, bot) {
      if (this.phase === 'live') this.endRound(g, 'bot');
    },
    onBotKilled(g, bot) {
      if (this.phase === 'live') this.endRound(g, 'you');
    },
    endRound(g, winner) {
      this.phase = 'ended';
      this.phaseT = 1.9;
      if (winner === 'you') this.score.you++;
      else if (winner === 'bot') this.score.bot++;
      const done = this.score.you >= this.to || this.score.bot >= this.to;
      this.over = done;
      if (done) this.phaseT = 1.6;
      const txt = winner === 'you' ? 'ROUND WON' : winner === 'bot' ? 'ROUND LOST' : 'DRAW';
      const col = winner === 'you' ? '#7dff5a' : winner === 'bot' ? '#ff6b6b' : '#ffd23f';
      RV.hud.center(done ? (winner === 'you' ? 'MATCH WON' : 'MATCH LOST') : txt, col, true);
      RV.audio.play(winner === 'you' ? 'finish' : 'die');
      // no freeze: after a win you can keep moving, jumping and sliding until the next round
    },
    frame(g, dt) {
      if (this.phase === 'countdown') {
        this.phaseT -= dt;
        const n = Math.ceil(Math.max(0, this.phaseT));
        if (n >= 1 && n <= 3 && n !== this.lastCount) {
          this.lastCount = n;
          RV.hud.center(String(n), '#ffffff', true);
          RV.audio.play('beep');
        }
        if (this.phaseT <= 0) {
          this.phase = 'live';
          g.player.frozen = false;
          g.protect(null);
          g.protect(g.bots[0]);
          RV.audio.play('go');
          RV.hud.center('FIGHT', '#ffd23f', true, 650);
        }
      } else if (this.phase === 'live') {
        this.matchTime += dt;
        this.roundT -= dt;
        if (this.roundT <= 0) {
          const bot = g.bots[0];
          const diff = g.hp - bot.hp;
          this.endRound(g, diff > 0.5 ? 'you' : diff < -0.5 ? 'bot' : 'draw');
          RV.hud.toast("Time's up: most health wins");
        }
      } else if (this.phase === 'ended') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.over) this.finish(g);
          else this.startRound(g);
        }
      } else if (this.phase === 'banner') {
        // match summary is showing over the live game; the next match starts by itself
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          RV.hud.matchBanner(false);
          this.startMatch(g);
        }
      }
    },
    hud(g) {
      const t = Math.max(0, this.roundT);
      RV.hud.setTimer(Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'));
      RV.hud.setSub('');
      RV.hud.duel(true, this.score.you, this.score.bot, g.bots[0].name, this.to, this.round);
      RV.hud.markerHide();
    },
    finish(g) {
      this.phase = 'over';
      const s = g.session;
      const won = this.score.you > this.score.bot;
      const bot = g.bots[0];
      const res = RV.records.submitDuel(g.mapId, { won, you: this.score.you, bot: this.score.bot, shots: s.shots, hits: s.hits, topSpeed: g.player.maxSpeed, diff: g.opts.diff || RV.settings.difficulty });
      const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
      const summary = {
        title: won ? 'Victory!' : 'Defeat',
        big: this.score.you + ' – ' + this.score.bot,
        bigClass: won ? 'pb' : '',
        sub: g.map.name + ' · vs ' + bot.name + ' (' + (g.opts.diff || RV.settings.difficulty) + ')' + (res.streak > 1 ? ' · ' + res.streak + ' win streak' : ''),
        rows: [
          ['Rounds played', String(this.round)],
          ['Accuracy', acc + '%  (' + s.hits + '/' + s.shots + ')'],
          ['Top speed', g.player.maxSpeed.toFixed(1) + ' m/s'],
          ['Match time', RV.fmtTime(this.matchTime, 1)],
        ],
      };
      if (RV.settings.resultsScreen) {
        // optional old behaviour: pause on a results screen
        g.setState('results');
        RV.input.exitLock();
        RV.audio.loop('wind', 0);
        RV.audio.loop('slide', 0);
        RV.audio.loop('wallrun', 0);
        RV.ui.showResults(summary);
      } else {
        // keep playing: summary card over the live game, then a fresh match with the mouse still locked
        this.phase = 'banner';
        this.phaseT = 4.0;
        RV.hud.centerHide();
        RV.hud.matchBanner(true, summary);
      }
    },
    stop(g) {
      RV.hud.duel(false);
    },
  };

  RV.modes = { duel: DUEL, timetrial: TT, arena: ARENA, practice: PRACTICE };
})();
