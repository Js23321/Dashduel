/* DASHDUEL - keyboard / mouse input, pointer lock and key binding capture. */
(function () {
  'use strict';
  const RV = window.RV;

  const input = (RV.input = {
    down: new Set(),
    latches: {},
    lookDX: 0,
    lookDY: 0,
    locked: false,
    enabled: false, // true while a game session is in progress
    capture: null, // function(code) while rebinding
    canvas: null,
    onLockChange: null,
    onUnlockedClick: null, // (event) a click while the mouse is not captured
    onBlur: null,
    onFire: null, // called synchronously on a fire press
    onWheel: null, // called with the wheel direction (-1 / +1)
    noLock: false, // test hook: behave as if pointer lock were granted
    _map: {},
    lockFailedAt: 0,
    _lastWheel: 0,
  });

  /** code -> [actions] lookup, rebuilt whenever bindings change. */
  input.rebuild = function () {
    const m = {};
    const binds = RV.settings.binds;
    for (const act in binds) {
      for (const code of binds[act]) {
        if (!code) continue;
        (m[code] = m[code] || []).push(act);
      }
    }
    input._map = m;
  };

  function press(code, repeat) {
    if (repeat) return;
    if (input.down.has(code)) return;
    input.down.add(code);
    const acts = input._map[code];
    if (acts) {
      for (let i = 0; i < acts.length; i++) {
        input.latches[acts[i]] = true;
        // a click is resolved inside the click event itself, not on the next frame
        if (acts[i] === 'fire' && input.onFire) input.onFire();
      }
    }
  }
  function release(code) {
    input.down.delete(code);
  }
  input.press = press;
  input.release = release;

  input.isDown = function (action) {
    const binds = RV.settings.binds[action];
    if (!binds) return false;
    return (binds[0] && input.down.has(binds[0])) || (binds[1] && input.down.has(binds[1])) || false;
  };

  /** True once per press (edge), then clears. */
  input.consume = function (action) {
    if (input.latches[action]) {
      input.latches[action] = false;
      return true;
    }
    return false;
  };

  input.clear = function () {
    input.down.clear();
    input.latches = {};
    input.lookDX = 0;
    input.lookDY = 0;
  };

  /** Fill the per-step command for the player simulation. */
  input.getCmd = function (cmd) {
    cmd.fwd = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    cmd.side = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    cmd.jumpDown = input.isDown('jump');
    cmd.jumpPressed = input.consume('jump');
    cmd.crouch = input.isDown('slide');
    cmd.sprint = true; // always running: there is no sprint key (the flag stays in the input format; the simulation ignores it)
    return cmd;
  };

  input.isLocked = function () {
    return input.noLock || input.locked;
  };

  input.requestLock = function () {
    const el = input.canvas;
    if (input.noLock || !el || !el.requestPointerLock) return;
    // newer Chrome returns a promise that rejects when the lock is refused (e.g. the user just pressed Esc):
    // that is normal, so every request swallows its own rejection
    const plain = () => {
      try {
        const q = el.requestPointerLock();
        if (q && q.catch) q.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch (e) {
      plain();
    }
  };

  input.exitLock = function () {
    try {
      if (document.exitPointerLock) document.exitPointerLock();
    } catch (e) {
      /* ignore */
    }
  };

  /** Listen for the next key/mouse press (used by the key binding UI). */
  input.beginCapture = function (cb) {
    input.capture = cb;
  };
  input.cancelCapture = function () {
    input.capture = null;
  };

  input.init = function (canvas) {
    input.canvas = canvas;
    input.rebuild();

    window.addEventListener(
      'keydown',
      (e) => {
        if (input.capture) {
          e.preventDefault();
          e.stopPropagation();
          const cb = input.capture;
          input.capture = null;
          cb(e.code === 'Escape' ? null : e.code, e.code === 'Escape');
          return;
        }
        if (!input.enabled) return;
        // keep browser shortcuts (Ctrl+R reload, Ctrl+S, Tab focus, Space scroll...) out of the game
        const acts = input._map[e.code];
        if (acts || e.ctrlKey || e.code === 'Space' || e.code === 'Tab') {
          if (e.code !== 'F5' && e.code !== 'F11' && e.code !== 'F12') e.preventDefault();
        }
        press(e.code, e.repeat);
      },
      { capture: true }
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (input.capture) return;
        if (input.enabled && (input._map[e.code] || e.ctrlKey)) e.preventDefault();
        release(e.code);
      },
      { capture: true }
    );
    window.addEventListener('mousedown', (e) => {
      if (input.capture) {
        e.preventDefault();
        const cb = input.capture;
        input.capture = null;
        cb('Mouse' + e.button, false);
        return;
      }
      if (input.enabled && !input.isLocked() && input.onUnlockedClick) input.onUnlockedClick(e);
      if (!input.enabled || !input.isLocked()) return;
      e.preventDefault();
      press('Mouse' + e.button, false);
    });
    window.addEventListener('mouseup', (e) => {
      release('Mouse' + e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!input.enabled || !input.isLocked()) return;
      const dx = e.movementX || 0,
        dy = e.movementY || 0;
      // some drivers emit one giant bogus delta right after pointer lock engages
      if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return;
      input.lookDX += dx;
      input.lookDY += dy;
    });
    window.addEventListener('contextmenu', (e) => {
      if (input.enabled) e.preventDefault();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!input.enabled || !input.isLocked()) return;
        e.preventDefault(); // never scroll the page while playing
        const now = performance.now();
        if (now - input._lastWheel < 90 || !e.deltaY) return;
        input._lastWheel = now;
        if (input.onWheel) input.onWheel(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
    // never leave a key "stuck" when focus moves away or comes back
    window.addEventListener('focus', () => input.clear());
    window.addEventListener('blur', () => {
      input.clear();
      if (input.onBlur) input.onBlur();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        input.clear();
        if (input.onBlur) input.onBlur();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      input.locked = document.pointerLockElement === canvas;
      if (!input.locked) input.clear();
      if (input.onLockChange) input.onLockChange(input.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      input.lockFailedAt = performance.now();
      if (input.onLockChange) input.onLockChange(false, true);
    });
  };
})();
