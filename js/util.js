/* DASHDUEL - shared helpers. Everything lives under the global RV namespace. */
(function () {
  'use strict';
  const RV = (window.RV = window.RV || {});

  RV.VERSION = '1.0.0';
  RV.TAU = Math.PI * 2;

  RV.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  RV.lerp = (a, b, t) => a + (b - a) * t;
  RV.approach = (v, target, delta) =>
    v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);
  /** Frame-rate independent exponential smoothing. */
  RV.damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  RV.angleDiff = (a, b) => {
    let d = (b - a) % RV.TAU;
    if (d > Math.PI) d -= RV.TAU;
    if (d < -Math.PI) d += RV.TAU;
    return d;
  };

  /** 1:02.34 style time. */
  RV.fmtTime = (t, digits) => {
    if (t == null || !isFinite(t)) return '--:--.--';
    digits = digits == null ? 2 : digits;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(digits);
  };
  RV.fmtDelta = (d) => {
    if (d == null || !isFinite(d)) return '';
    return (d <= 0 ? '-' : '+') + Math.abs(d).toFixed(2);
  };

  /** Small deterministic PRNG (used for decoration + bot decisions, never for shots). */
  RV.makeRng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** localStorage wrapper that never throws (private windows, blocked storage...). */
  RV.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('rivel.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('rivel.' + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('rivel.' + key);
      } catch (e) {
        /* ignore */
      }
    },
  };

  /**
   * Pick the two spawn points of a round (shared by the offline duel and the online server): one at random that was NOT used in the last
   * round or two, and a partner from the far end of the map (any of the points at least 80% as far away as the furthest one, also avoiding
   * recent ones), so consecutive rounds start in different places but never next to each other. `recent` is a list of spawn indices that
   * this function keeps up to date; `rnd` is Math.random (or any 0..1 generator). Returns [a, b] (indices into `spawns`).
   */
  RV.pickSpawnPair = function (spawns, recent, rnd) {
    const n = spawns.length;
    if (n < 2) return [0, 0];
    rnd = rnd || Math.random;
    const fresh = [];
    for (let i = 0; i < n; i++) if (recent.indexOf(i) < 0) fresh.push(i);
    const poolA = fresh.length >= 2 ? fresh : Array.from({ length: n }, (_, i) => i);
    const a = poolA[Math.floor(rnd() * poolA.length)];
    const dist = (i) => Math.hypot(spawns[i].x - spawns[a].x, spawns[i].z - spawns[a].z, (spawns[i].y - spawns[a].y) * 0.5);
    let max = 0;
    for (let i = 0; i < n; i++) if (i !== a) max = Math.max(max, dist(i));
    let far = [];
    for (let i = 0; i < n; i++) if (i !== a && dist(i) >= max * 0.8 && recent.indexOf(i) < 0) far.push(i);
    if (!far.length) for (let i = 0; i < n; i++) if (i !== a && dist(i) >= max * 0.8) far.push(i);
    const b = far[Math.floor(rnd() * far.length)];
    recent.push(a, b);
    while (recent.length > Math.min(4, n - 2)) recent.shift(); // remember the last two rounds' points
    return [a, b];
  };

  /** Tiny event emitter. */
  RV.Emitter = class {
    constructor() {
      this._h = {};
    }
    on(name, fn) {
      (this._h[name] = this._h[name] || []).push(fn);
      return this;
    }
    emit(name, a, b, c) {
      const l = this._h[name];
      if (l) for (let i = 0; i < l.length; i++) l[i](a, b, c);
    }
  };
})();
