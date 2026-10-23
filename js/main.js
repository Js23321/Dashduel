/* DASHDUEL - boot, main loop, quality governor. */
(function () {
  'use strict';
  const RV = window.RV;
  const params = new URLSearchParams(location.search);

  // -------------------------------------------------------------------- settings -> engine
  RV.applySettings = function () {
    const S = RV.settings;
    if (RV.render.ready) {
      if (RV.render.userScale !== S.renderScale) {
        RV.render.userScale = S.renderScale;
        RV.render.setScale(S.renderScale);
      }
      RV.render.setFov(S.fov);
      if (RV.render.shadowLevel !== S.shadows) RV.render.setShadows(S.shadows);
      RV.render.setDetail(S.quality);
      RV.render.setFx(S.effects);
      if (RV.perfReset) RV.perfReset();
    }
    RV.audio.setVolume(S.volume);
    RV.hud.applyCrosshair();
    RV.input.rebuild();
    if (RV.game.player) RV.game.player.autoHop = S.autoHop;
  };

  RV.toggleFullscreen = function () {
    if (document.fullscreenElement) {
      try {
        document.exitFullscreen();
      } catch (e) {
        /* ignore */
      }
    } else RV.enterFullscreen();
  };

  RV.enterFullscreen = function () {
    const el = document.documentElement;
    const lockKeys = () => {
      try {
        if (navigator.keyboard && navigator.keyboard.lock) {
          // lets Ctrl-based combos (Ctrl+W, Ctrl+T...) reach the game instead of the browser
          navigator.keyboard.lock(['ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyN', 'KeyQ', 'KeyR', 'Tab', 'AltLeft']);
        }
      } catch (e) {
        /* optional feature */
      }
    };
    try {
      if (document.fullscreenElement) return;
      const p = el.requestFullscreen ? el.requestFullscreen() : null;
      if (p && p.then) p.then(lockKeys).catch(() => {});
      else lockKeys();
    } catch (e) {
      /* ignore */
    }
  };
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      try {
        if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
      } catch (e) {
        /* ignore */
      }
    }
  });

  // -------------------------------------------------------------------- loop
  let last = performance.now();

  /**
   * Frame-time governor. It watches a rolling window of real frame times (average and the
   * slow 5%), because steady frames feel better than a high average with hitches. When the
   * window is bad for a while it removes the most expensive visuals one step at a time:
   * effects -> resolution -> shadows -> outlines/clouds. It never touches gameplay, the weapon
   * animations, or anything that could change a shot. If things stay smooth for a long time it
   * hands resolution back (and gives up on that if it makes the game stutter again).
   */
  const WIN = 120;
  const perf = {
    ft: new Float32Array(WIN),
    tmp: new Float32Array(WIN),
    n: 0,
    head: 0,
    ema: 0,
    p95: 0,
    fpsT: 0,
    frames: 0,
    bad: 0,
    good: 0,
    settle: 0,
    sessionT: 0,
    sinceChange: 0,
    noRecover: false,
    lastRecover: -1e9,
  };

  /** Forget everything measured so far (after any change that alters frame cost). */
  function perfClear() {
    perf.n = perf.head = 0;
    perf.bad = perf.good = 0;
    perf.settle = 1.5;
  }
  RV.perfReset = function () {
    perfClear();
    perf.sessionT = 0;
    perf.noRecover = false;
  };

  /** Next cheaper look; returns the message to show, or null when nothing is left to remove. */
  function degrade() {
    const R = RV.render;
    if (R.fxLevel === 'high') {
      R.setFx('low');
      return 'Low FPS: fewer particles and decals';
    }
    if (R.scale > 0.65) {
      R.setScale(Math.max(0.6, R.scale - 0.1));
      return 'Low FPS: render resolution reduced to ' + Math.round(R.scale * 100) + '%';
    }
    if (R.shadowLevel !== 'off') {
      R.setShadows('off');
      return 'Low FPS: shadows turned off';
    }
    if (R.outlines) {
      R.setDetail('low');
      return 'Low FPS: character outlines and clouds turned off';
    }
    if (R.scale > 0.5) {
      R.setScale(0.5);
      return 'Low FPS: render resolution reduced to 50%';
    }
    return null;
  }

  function governor(dt, rawDt) {
    const S = RV.settings;
    const playing = RV.game.state === 'playing' && RV.game.simActive;
    if (playing && rawDt < 0.5) {
      perf.ft[perf.head] = rawDt;
      perf.head = (perf.head + 1) % WIN;
      if (perf.n < WIN) perf.n++;
      perf.ema += (rawDt - perf.ema) * 0.05;
      perf.sinceChange += dt;
    }
    perf.fpsT += dt;
    perf.frames++;
    if (perf.fpsT < 0.5) return;

    const fps = perf.frames / perf.fpsT;
    const span = perf.fpsT;
    perf.frames = 0;
    perf.fpsT = 0;
    if (perf.n >= 20) {
      perf.tmp.set(perf.ft);
      const v = perf.tmp.subarray(0, perf.n).sort();
      perf.p95 = v[Math.min(perf.n - 1, Math.floor(perf.n * 0.95))];
    }
    if (S.showFps) {
      const st = RV.render.stats;
      RV.hud.setFps(Math.round(fps) + ' fps · ' + (perf.p95 * 1000).toFixed(0) + ' ms p95 · ' + st.calls + ' calls · ' + (st.tris / 1000).toFixed(1) + 'k tris · ' + RV.render.scale.toFixed(2) + 'x');
    } else RV.hud.setFps('');

    if (!S.autoQuality || !playing) return;
    perf.sessionT += span;
    if (perf.settle > 0) {
      perf.settle -= span;
      return;
    }
    if (perf.sessionT < 3 || perf.n < 60) return;

    const budget = 1 / (S.targetFps === 30 ? 30 : 60);
    const slow = perf.ema > budget * 1.25 || perf.p95 > budget * 1.8;
    const smooth = perf.ema < budget * 1.08 && perf.p95 < budget * 1.35;
    if (slow) {
      perf.bad += perf.ema > budget * 2 ? 2 : 1; // very slow: react twice as fast
      perf.good = 0;
    } else {
      perf.bad = Math.max(0, perf.bad - 1);
      perf.good = smooth ? perf.good + 1 : 0;
    }
    if (perf.bad >= 4) {
      const msg = degrade();
      if (msg) RV.hud.toast(msg);
      // a drop right after handing resolution back means it was too much: stop trying
      if (perf.sinceChange < 25 && perf.sessionT - perf.lastRecover < 25) perf.noRecover = true;
      perfClear();
      perf.sinceChange = 0;
      return;
    }
    // long smooth stretch: give a little resolution back
    const R = RV.render;
    if (!perf.noRecover && perf.good >= 40 && perf.sinceChange > 20 && R.scale < R.userScale - 0.01) {
      R.setScale(Math.min(R.userScale, R.scale + 0.05));
      perf.lastRecover = perf.sessionT;
      perfClear();
      perf.sinceChange = 0;
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    const rawDt = dt;
    const minDt = RV.settings.targetFps === 30 ? 1 / 30 - 0.004 : 0;
    if (dt < minDt) return; // 30 FPS mode: render every other frame
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    const g = RV.game;
    if (g.state === 'menu') {
      if (RV.menuBg) RV.menuBg.frame(dt); // the slow 3D arena behind the main menu
      return;
    }
    try {
      g.update(dt);
      RV.render.render(dt);
      governor(dt, rawDt);
    } catch (e) {
      console.error(e);
    }
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    const canvas = document.getElementById('game');
    if (typeof THREE === 'undefined' || !RV.render.init(canvas)) {
      document.getElementById('loading').classList.add('gone');
      RV.ui.init();
      RV.ui.show('error');
      return;
    }
    if (params.has('nolock')) RV.input.noLock = true;
    RV.input.init(canvas);
    RV.input.onLockChange = RV.game.onLockChange;
    RV.input.onBlur = () => {
      if (RV.game.state === 'playing') RV.game.pause();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || RV.input.capture) return;
      if (RV.game.state === 'playing') {
        // keyboard lock can swallow the browser's own Esc handling: pause explicitly
        RV.input.exitLock();
        if (RV.input.noLock) RV.game.pause();
        e.stopImmediatePropagation(); // this very key press must not also drive the pause menu (Esc = resume there)
      }
    });
    // sound off + paused while the tab is hidden, restored on return
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) RV.audio.suspend();
      else RV.audio.resume();
    });
    RV.hud.init();
    RV.ui.init();
    RV.render.userScale = RV.settings.renderScale;
    RV.render.setScale(RV.settings.renderScale);
    RV.applySettings();
    RV.ui.show(RV.profile.get() ? 'main' : 'name'); // first launch: choose a username
    document.getElementById('loading').classList.add('gone');
    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(loop);
    });
  }

  // Test / tooling hook (harmless in normal play)
  window.DASHDUEL = window.RIVEL = {
    RV,
    start(mode, map, opts) {
      RV.audio.init();
      RV.game.start(mode, map, opts || {});
    },
    pause: () => RV.game.pause(),
    resume: () => RV.game.resume(),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
