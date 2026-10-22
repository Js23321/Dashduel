/* DASHDUEL - first-person weapon + hands animation core (pure maths, no WebGL).
 *
 * Everything here is COSMETIC. It produces a pose for the weapon model, its moving
 * parts and both hands; it never touches the camera, the aim direction or the hit ray.
 * Rules it follows:
 *   - no weapon kick on firing (zero recoil): firing only animates the trigger, bolt /
 *     slide, the muzzle flash and the ejected casing (fists punch, grenades are thrown)
 *   - every motion is time based (dt), so it looks identical at 30, 60 or 144 FPS
 *   - every state change is blended (damped weights, eased progress), nothing snaps
 *   - at full ADS all movement is faded out and the sight sits exactly on the
 *     centre line of the view, i.e. on the shooting ray
 *   - one shared animator drives all four weapons (rifle, handgun, fists, grenade)
 */
(function () {
  'use strict';
  const RV = window.RV;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (t) => {
    t = clamp01(t);
    return t * t * (3 - 2 * t);
  };
  /** eased 0..1 progress of t inside [a,b] */
  const seg = (t, a, b) => smooth((t - a) / (b - a));
  /** rise over `up` seconds then fall back to 0 at `total` seconds */
  const pulse = (t, up, total) => (t < 0 || t >= total ? 0 : t < up ? smooth(t / up) : 1 - smooth((t - up) / (total - up)));
  /** Critically damped spring towards `target` (continuous velocity, no overshoot). */
  function spring(o, key, target, omega, dt) {
    const vk = key + 'V';
    const x = o[key] - target;
    const v = o[vk] || 0;
    const e = Math.exp(-omega * dt);
    const t = v + omega * x;
    o[key] = (x + t * dt) * e + target;
    o[vk] = (v - omega * t * dt) * e;
  }

  /** Grenade throw timing (shared with weapons.js, which spawns the projectile at `release`). */
  const THROW = { total: 0.8, release: 0.47, hold: 0.3 }; // `hold`: the pin is out, the grenade waits here while aiming
  /** Punch timing. */
  const PUNCH = { dur: 0.36 };

  /**
   * Per-weapon presentation spec (model units are ~metres before `scale`).
   *   hip     : root position in camera space when hip-firing
   *   sight   : aperture centre in model space (ring / dot)
   *   er      : eye relief, distance from the eye to that aperture while aiming
   *   muzzle / eject : model-space points for the flash and the ejected casing
   *   fire    : which part cycles after a shot
   *   reload  : reload choreography
   *   lhMag   : where the supporting hand travels to for a magazine change (view units)
   */
  const SPEC = {
    rifle: { scale: 0.5, hip: [0.16, -0.138, -0.4], sight: [0, 0.1, 0.11], er: 0.4, muzzle: [0, 0.015, -0.62], eject: [0.04, 0.05, 0.03], fire: 'bolt', reload: 'mag', sprintPose: 1, cas: 'rifle', lhMag: [0.0, -0.05, 0.14] },
    pistol: { scale: 0.62, hip: [0.145, -0.122, -0.38], sight: [0, 0.088, 0.095], er: 0.36, muzzle: [0, 0.045, -0.2], eject: [0.03, 0.062, -0.01], fire: 'slide', reload: 'slidemag', sprintPose: 0.8, cas: 'pistol', lhMag: [0.0, -0.04, 0.0] },
    fists: { scale: 1, hip: [0, 0, 0], sight: [0, 0, 0], er: 0.3, muzzle: [0, 0, -0.3], eject: null, fire: 'punch', reload: 'none', sprintPose: 0.6, cas: null, noAds: true },
    grenade: { scale: 1, hip: [0, 0, 0], sight: [0, 0, 0], er: 0.3, muzzle: [0, 0, -0.3], eject: null, fire: 'throw', reload: 'none', sprintPose: 0.7, cas: null, noAds: true },
  };

  /** Root position (camera space) that puts the sight aperture dead centre. */
  function adsPos(spec, out) {
    const s = spec.scale;
    out = out || [0, 0, 0];
    out[0] = -s * spec.sight[0];
    out[1] = -s * spec.sight[1];
    out[2] = -spec.er - s * spec.sight[2];
    return out;
  }

  /**
   * Advance the ADS progress. Linear in time (so the transition lasts exactly
   * tin / tout seconds at any frame rate); the eased value is returned for use.
   */
  function stepAds(t, want, dt, tin, tout) {
    t += (want ? 1 / tin : -1 / tout) * dt;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // -------------------------------------------------------------------------
  // reload choreography: returns offsets for the whole weapon and its parts.
  // p = 0..1 progress through the reload.
  // -------------------------------------------------------------------------
  function reloadPose(kind, p, o) {
    o.rdy = o.rrx = o.rrz = o.rry = o.rdx = 0;
    o.magY = o.magZ = o.magRx = 0;
    o.magVis = 1;
    o.boltZ = 0;
    o.slideZ = 0;
    o.reach = 0; // 0..1: supporting hand travelling to the magazine well
    o.dip = 0; // 0..1: supporting hand dropping out of view to fetch a fresh magazine
    if (kind === 'none' || p < 0) return o;

    const tilt = seg(p, 0, 0.14) - seg(p, 0.86, 1);
    // magazine: out (0.14-0.36), away, in (0.52-0.74)
    const out = seg(p, 0.14, 0.36);
    const inn = seg(p, 0.52, 0.74);
    const magOffY = p < 0.5 ? -0.26 * out : -0.26 * (1 - inn);
    const magHidden = p > 0.4 && p < 0.5;
    const bump = pulse(p, 0.7, 0.8); // little rock as the mag seats

    // cant the weapon so its magazine side faces the player, keep it clear of the crosshair
    o.rdy = -0.03 * tilt;
    o.rdx = -0.05 * tilt;
    o.rrz = -0.55 * tilt;
    o.rrx = 0.24 * tilt - 0.06 * bump;
    o.rry = 0.16 * tilt;
    o.magY = magOffY;
    o.magZ = 0.04 * out * (1 - inn);
    o.magRx = 0.5 * out * (p < 0.5 ? 1 : 1 - inn);
    o.magVis = magHidden ? 0 : 1;
    o.reach = seg(p, 0.04, 0.16) - seg(p, 0.78, 0.9);
    o.dip = seg(p, 0.34, 0.42) - seg(p, 0.5, 0.58);

    if (kind === 'mag') o.boltZ = 0.07 * (seg(p, 0.8, 0.87) - seg(p, 0.87, 0.94)); // charging handle
    else if (kind === 'slidemag') o.slideZ = 0.045 * (seg(p, 0.78, 0.83) - seg(p, 0.83, 0.88)); // slide release
    return o;
  }

  const newHand = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const zeroHand = (h) => {
    h.x = h.y = h.z = h.rx = h.ry = h.rz = 0;
  };

  // -------------------------------------------------------------------------
  class Animator {
    constructor() {
      this.t = 0;
      this.bobPhase = 0;
      this.w = { move: 0, sprint: 0, slide: 0, air: 0, wall: 0 };
      this.sp = { y: 0, vy: 0, r: 0, vr: 0 }; // landing / take-off spring
      this.vyF = 0;
      this.fireT = 99; // seconds since the last shot
      this.trigT = 99;
      this.punchT = 99; // seconds since the last punch
      this.punchSide = -1; // the hand of the NEXT punch alternates: -1 left, +1 right
      this.punchHand = 1;
      this.hitT = 99; // seconds since a punch connected
      this.djT = 99; // seconds since a double jump
      this.flashT = 99;
      this.casingQ = 0; // casings waiting to be spawned by the renderer
      this.casingAt = -1; // delayed ejection
      this.nadeGone = false; // the grenade left the hand and a new one is being produced
      this.nadeT = 99;
      this.lastThrowP = -1;
      this.lastId = null;
      this.out = {
        id: 'rifle',
        x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0,
        magY: 0, magZ: 0, magRx: 0, magVis: 1,
        boltZ: 0, slideZ: 0, trigRx: 0, flash: 0,
        lower: 0, ads: 0,
        lh: newHand(), rh: newHand(), // hand offsets from their rest pose (view units / radians)
        nade: 1, // grenade in the hand: 0 hidden .. 1 full size
        pin: 0, // 0 pin in .. 1 pin pulled out
        spoon: 0, // lever opening
      };
      this._rl = {};
    }

    /** A shot / punch was fired (cosmetic reaction only). */
    onFire(id) {
      const sp = SPEC[id];
      this.fireT = 0;
      this.trigT = 0;
      this.flashT = 0;
      if (!sp) return;
      if (sp.fire === 'punch') {
        this.punchT = 0;
        this.punchSide = -this.punchSide;
        this.punchHand = this.punchSide; // +1 right hand, -1 left hand
        this.hitT = 99;
        return;
      }
      if (sp.eject) this.casingQ++;
    }

    /** The punch that was just thrown connected with something. */
    onPunchHit() {
      this.hitT = 0;
    }

    onLand(impact) {
      const k = clamp01((impact - 3) / 18);
      this.sp.vy -= 0.9 + 2.4 * k;
      this.sp.vr -= 0.5 + 1.2 * k;
    }

    onJump() {
      this.sp.vy -= 0.55;
      this.sp.vr += 0.3;
    }

    onDoubleJump() {
      this.djT = 0;
      this.sp.vy -= 0.4;
    }

    /**
     * st: {id, prevId, ads, switchT, switchDur, reload, throwP, grenades, speed, grounded,
     *      sliding, wallrun, wallSide, sprint, vy, firing, ammo, mag}
     * returns the shared `out` pose.
     */
    update(dt, st) {
      if (dt > 0.05) dt = 0.05;
      if (dt <= 0) return this.out;
      const o = this.out;
      const spec = SPEC[st.id] || SPEC.rifle;
      this.t += dt;
      this.fireT += dt;
      this.trigT += dt;
      this.flashT += dt;
      this.punchT += dt;
      this.hitT += dt;
      this.djT += dt;
      this.nadeT += dt;
      if (st.id !== this.lastId) {
        this.lastId = st.id;
        this.casingAt = -1;
        this.punchT = 99;
      }

      // --- ADS (already eased by the caller) ---------------------------------
      const a = clamp01(st.ads);
      const free = 1 - a; // how much cosmetic motion is allowed

      // --- switching: lower the old weapon, then raise the new one ----------
      let lower = 0;
      let shown = st.id;
      if (st.switchDur > 0 && st.switchT > 0) {
        const sw = 1 - st.switchT / st.switchDur;
        if (sw < 0.45) {
          shown = st.prevId || st.id;
          lower = smooth(sw / 0.45);
        } else {
          lower = 1 - smooth((sw - 0.45) / 0.55);
        }
      }
      const shownSpec = SPEC[shown] || spec;

      // --- blend weights -------------------------------------------------------
      const reloading = st.reload >= 0;
      const throwing = st.throwP >= 0;
      const w = this.w;
      const moving = st.grounded && st.speed > 0.6;
      spring(w, 'move', moving ? 1 : 0, 10, dt);
      const sprintOn = st.sprint && st.grounded && st.speed > 7.2 && a < 0.05 && !reloading && !st.firing && !throwing;
      spring(w, 'sprint', sprintOn ? 1 : 0, sprintOn ? 10 : 14, dt);
      spring(w, 'slide', st.sliding ? 1 : 0, 13, dt);
      spring(w, 'air', !st.grounded && !st.wallrun ? 1 : 0, 8, dt);
      spring(w, 'wall', st.wallrun ? 1 : 0, 11, dt);

      // bob phase advances with distance travelled, not with frames
      if (moving) this.bobPhase += st.speed * dt * (w.sprint > 0.5 ? 1.55 : 1.3);

      // --- spring (landing dip / take-off) ----------------------------------------
      const sp = this.sp;
      const K = 190,
        C = 15;
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        sp.vy += (-K * sp.y - C * sp.vy) * h;
        sp.y += sp.vy * h;
        sp.vr += (-K * sp.r - C * sp.vr) * h;
        sp.r += sp.vr * h;
      }

      // --- compose the pose --------------------------------------------------------
      let x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0;

      // idle breathing (only while still)
      const idleW = (1 - w.move) * (1 - w.sprint) * free;
      x += Math.sin(this.t * 1.1) * 0.0018 * idleW;
      y += Math.sin(this.t * 1.7 + 1.0) * 0.0024 * idleW;
      rz += Math.sin(this.t * 0.9) * 0.0035 * idleW;
      rx += Math.sin(this.t * 1.5 + 0.6) * 0.0025 * idleW;

      // walking bob
      const amp = w.move * Math.min(1, st.speed / 8) * free * (1 + 0.5 * w.sprint);
      x += Math.sin(this.bobPhase) * 0.011 * amp;
      y += (0.004 - Math.abs(Math.cos(this.bobPhase)) * 0.013) * amp;
      rz += Math.sin(this.bobPhase) * 0.02 * amp;
      ry += Math.sin(this.bobPhase + 0.5) * 0.014 * amp;
      rx += Math.sin(this.bobPhase * 2) * 0.006 * amp;

      // sprint pose
      const S = smooth(w.sprint) * shownSpec.sprintPose;
      x += 0.05 * S;
      y += -0.06 * S;
      z += 0.02 * S;
      rx += 0.3 * S;
      ry += 0.64 * S;
      rz += -0.32 * S;

      // slide pose
      const L = smooth(w.slide);
      x += 0.03 * L;
      y += -0.032 * L;
      z += 0.035 * L;
      rx += 0.1 * L;
      ry += 0.22 * L;
      rz += 0.55 * L;

      // wall run: lean the weapon away from the wall
      rz += -st.wallSide * 0.18 * w.wall;
      x += -st.wallSide * 0.02 * w.wall;

      // airborne drift (rising: weapon sags, falling: it floats up)
      // low-pass the vertical speed: it changes abruptly on take-off / landing, the weapon must not
      this.vyF += ((st.vy || 0) - this.vyF) * (1 - Math.exp(-12 * dt));
      const vy = Math.max(-18, Math.min(14, this.vyF));
      y += Math.max(-0.035, Math.min(0.035, -vy * 0.0035)) * w.air * free;
      rx += Math.max(-0.14, Math.min(0.14, vy * 0.0065)) * w.air * free;

      // landing / take-off spring (a little survives in ADS so landings still read)
      const sk = 0.3 + 0.7 * free;
      y += sp.y * 0.05 * sk;
      rx += sp.r * 0.06 * sk;

      // reload (guns)
      const rl = reloadPose(shownSpec.reload, reloading && shown === st.id ? st.reload : -1, this._rl);
      x += rl.rdx;
      y += rl.rdy;
      rx += rl.rrx;
      ry += rl.rry;
      rz += rl.rrz;

      // double jump: the whole view-model flicks upward and settles
      const dj = pulse(this.djT, 0.1, 0.42);
      y += 0.03 * dj;
      rx += 0.12 * dj;

      // switching
      y += -0.34 * lower;
      rx += -0.95 * lower;
      x += 0.07 * lower;

      // --- final root pose: hip position blended with the ADS position ------------
      const hip = shownSpec.hip;
      const ap = adsPos(shownSpec, this._ap || (this._ap = [0, 0, 0]));
      const ae = shownSpec.noAds ? 0 : a; // only weapons with sights can aim
      o.id = shown;
      o.x = hip[0] + (ap[0] - hip[0]) * ae + x;
      o.y = hip[1] + (ap[1] - hip[1]) * ae + y;
      o.z = hip[2] + (ap[2] - hip[2]) * ae + z;
      o.rx = rx;
      o.ry = ry;
      o.rz = rz;
      o.lower = lower;
      o.ads = ae;

      // --- hands ------------------------------------------------------------------------
      const lh = o.lh,
        rh = o.rh;
      zeroHand(lh);
      zeroHand(rh);
      o.nade = 0;
      o.pin = 0;
      o.spoon = 0;
      const bph = this.bobPhase;
      const stride = Math.sin(bph) * amp;
      if (shown === 'fists') this._fists(o, lh, rh, st, w, L, S, dj, stride, amp, free);
      else if (shown === 'grenade') this._grenade(o, lh, rh, st, w, L, S, dj, stride, amp, free, shown === st.id);
      else {
        // guns: the hands ride on the weapon; the supporting hand fetches the magazine on a reload
        const lm = shownSpec.lhMag;
        const r = rl.reach;
        lh.x = lm[0] * r;
        lh.y = lm[1] * r + rl.magY * shownSpec.scale - 0.09 * rl.dip;
        lh.z = lm[2] * r;
        lh.rx = -0.25 * r;
      }

      // --- moving parts ----------------------------------------------------------------
      const f = this.fireT;
      let boltZ = rl.boltZ,
        slideZ = rl.slideZ;
      switch (shownSpec.fire) {
        case 'bolt': {
          // charging handle / bolt carrier reciprocates on every shot
          boltZ += 0.055 * pulse(f, 0.022, 0.075);
          // stays open on an empty magazine
          if (st.ammo <= 0 && !reloading && st.mag > 0) boltZ = Math.max(boltZ, 0.05);
          break;
        }
        case 'slide': {
          slideZ += 0.045 * pulse(f, 0.02, 0.085);
          if (st.ammo <= 0 && !reloading && st.mag > 0) slideZ = Math.max(slideZ, 0.044);
          break;
        }
      }
      // delayed casing ejection
      if (this.casingAt >= 0) {
        this.casingQ++;
        this.casingAt = -1;
      }
      o.boltZ = boltZ;
      o.slideZ = slideZ;
      o.magY = rl.magY;
      o.magZ = rl.magZ;
      o.magRx = rl.magRx;
      o.magVis = rl.magVis;
      // trigger: pressed briefly with every shot, held while the button is down
      const held = st.firing ? 1 : 0;
      o.trigRx = -0.5 * Math.max(held, pulse(this.trigT, 0.012, 0.09));
      o.flash = this.flashT < 0.05 ? 1 - this.flashT / 0.05 : 0;
      return o;
    }

    /**
     * Fists: a guard stance with a hand in front of each side, alternating punches, a run
     * swing, a tuck while sliding, a lift on jumps and a quick flick on the double jump.
     */
    _fists(o, lh, rh, st, w, L, S, dj, stride, amp, free) {
      const t = this.t;
      // breathing, opposite phase in each hand
      const br = (1 - w.move) * (1 - w.sprint);
      lh.y += Math.sin(t * 1.6) * 0.0035 * br;
      rh.y += Math.sin(t * 1.6 + 1.7) * 0.0035 * br;
      lh.z += Math.sin(t * 1.1 + 0.4) * 0.0025 * br;
      rh.z += Math.sin(t * 1.1 + 2.0) * 0.0025 * br;
      // running: the hands swing against each other
      const sw = stride * (0.7 + 0.8 * S);
      lh.z += -sw * 0.028;
      rh.z += sw * 0.028;
      lh.y += Math.abs(Math.cos(this.bobPhase)) * -0.01 * amp;
      rh.y += Math.abs(Math.cos(this.bobPhase)) * -0.01 * amp;
      // sprint: hands pump lower and further apart
      lh.x += -0.02 * S;
      rh.x += 0.02 * S;
      lh.y += -0.025 * S;
      rh.y += -0.025 * S;
      lh.rx += -0.2 * S;
      rh.rx += -0.2 * S;
      // slide: hands tuck forward and low
      lh.y += -0.03 * L;
      rh.y += -0.03 * L;
      lh.z += -0.05 * L;
      rh.z += -0.05 * L;
      lh.x += 0.02 * L;
      rh.x += -0.02 * L;
      // air: the hands rise with a fall and drop on the way up
      const vy = Math.max(-14, Math.min(12, this.vyF));
      const air = w.air * Math.max(-0.035, Math.min(0.045, -vy * 0.004));
      lh.y += air;
      rh.y += air;
      // double jump: both hands whip up and back, then settle
      lh.y += 0.07 * dj;
      rh.y += 0.07 * dj;
      lh.z += 0.045 * dj;
      rh.z += 0.045 * dj;
      lh.rx += 0.3 * dj;
      rh.rx += 0.3 * dj;
      lh.x += -0.03 * dj;
      rh.x += 0.03 * dj;

      // punches: windup, a fast strike towards the centre, a short hold, a smooth recovery
      if (this.punchT < PUNCH.dur) {
        const u = this.punchT / PUNCH.dur;
        const pull = seg(u, 0, 0.1) * (1 - seg(u, 0.1, 0.16));
        const strike = seg(u, 0.1, 0.27);
        const back = seg(u, 0.42, 1);
        const ext = strike * (1 - back);
        const side = this.punchHand; // +1 right, -1 left
        const h = side > 0 ? rh : lh;
        const g = side > 0 ? lh : rh;
        h.z += -0.31 * ext + 0.05 * pull;
        h.y += 0.05 * ext - 0.02 * pull;
        h.x += -side * 0.11 * ext + side * 0.015 * pull;
        h.rx += -0.15 * ext + 0.18 * pull;
        h.ry += -side * 0.22 * ext;
        h.rz += side * 0.25 * ext;
        // the other hand stays up as a guard and tucks in slightly
        g.x += -side * 0.014 * ext;
        g.y += 0.012 * ext;
        g.z += 0.02 * ext;
        // the body turns into the punch (view-model root, very small)
        o.ry += -side * 0.05 * ext;
        o.x += side * 0.012 * ext;
        // impact: a little compression when it connects
        if (this.hitT < 0.14) {
          const hk = pulse(this.hitT, 0.03, 0.14);
          h.z += 0.03 * hk * (1 - back);
        }
      }
    }

    /**
     * Grenade: hold -> pull the pin with the other hand -> wind up -> throw -> recover,
     * and a fresh grenade is brought up afterwards.
     */
    _grenade(o, lh, rh, st, w, L, S, dj, stride, amp, free, current) {
      const t = this.t;
      const p = current ? st.throwP : -1;
      // after the release the hand is empty; once the throw is over a fresh grenade grows in
      if (p >= THROW.release) {
        this.nadeGone = true;
        this.nadeT = 0;
      }
      let nade = st.grenades > 0 ? 1 : 0;
      if (p >= THROW.release) nade = 0;
      else if (this.nadeGone) {
        nade = st.grenades > 0 ? seg(this.nadeT, 0.1, 0.5) : 0;
        if (this.nadeT >= 0.5) this.nadeGone = false;
      }

      // idle / movement: the throwing hand carries the grenade, the other hand floats near it
      const br = (1 - w.move) * (1 - w.sprint);
      rh.y += Math.sin(t * 1.5 + 1.7) * 0.003 * br;
      lh.y += Math.sin(t * 1.6) * 0.003 * br;
      lh.z += Math.sin(t * 1.1 + 0.4) * 0.002 * br;
      const sw = stride * (0.7 + 0.5 * S);
      rh.z += sw * 0.012;
      lh.z += -sw * 0.02;
      lh.y += -0.025 * S;
      rh.y += -0.02 * S;
      lh.y += -0.03 * L;
      rh.y += -0.03 * L;
      const vy = Math.max(-14, Math.min(12, this.vyF));
      const air = w.air * Math.max(-0.03, Math.min(0.04, -vy * 0.0035));
      lh.y += air;
      rh.y += air;
      lh.y += 0.05 * dj;
      rh.y += 0.05 * dj;

      if (p >= 0) {
        // pin pull happens before the hold point (0.3): reach, pull, then the hand drops away
        const pinReach = seg(p, 0.0, 0.1);
        const pinPull = seg(p, 0.1, 0.21);
        const lAway = seg(p, 0.21, 0.3);
        // left hand: up to the pin, pull it out, drop away
        lh.x += 0.2 * pinReach - 0.09 * pinPull - 0.12 * lAway;
        lh.y += 0.1 * pinReach - 0.03 * pinPull - 0.09 * lAway;
        lh.z += 0.0 * pinReach + 0.06 * pinPull - 0.05 * lAway;
        lh.rx += 0.3 * pinReach - 0.3 * lAway;
        o.pin = pinPull;
        o.spoon = seg(p, 0.24, 0.3);
        // right hand: a little pull-back with the pin, then the wind-up, throw and recovery
        const settle = seg(p, 0.0, 0.1) * (1 - seg(p, 0.22, 0.3));
        const wind = seg(p, 0.3, 0.47);
        const sweep = seg(p, 0.47, 0.6);
        const rec = seg(p, 0.6, 1.0);
        const back = wind * (1 - sweep);
        const fwd = sweep * (1 - rec);
        rh.x += 0.012 * settle + 0.03 * back - 0.05 * fwd;
        rh.y += -0.015 * settle + 0.09 * back - 0.05 * fwd;
        rh.z += 0.012 * settle + 0.13 * back - 0.24 * fwd;
        rh.rx += 0.7 * back - 0.55 * fwd;
        rh.ry += 0.1 * back - 0.12 * fwd;
        rh.rz += 0.0;
        o.y += -0.01 * settle;
        o.rx += 0.04 * back - 0.05 * fwd;
      }
      o.nade = nade;
    }

  }

  RV.vmanim = { SPEC, Animator, adsPos, stepAds, reloadPose, seg, smooth, pulse, THROW, PUNCH };
})();
