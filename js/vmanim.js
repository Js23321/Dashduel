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
    // hip poses follow the RIVALS first-person view (solved from its reference screenshots: tools/solve-hip-pose.js): the gun sits low on the
    // right, big, and its muzzle points in towards the crosshair (hipYaw / hipPitch, blended out while aiming), the muzzle ends up
    // just right of and below the crosshair so the centre of the screen stays clear
    rifle: { camShare: 0.6, adsYaw: 0.12, post: [0, 0.1, -0.41], scale: 0.6, hip: [0.12, -0.102, -0.352], hipYaw: 0.082, hipPitch: 0.17, sight: [0, 0.1, 0.11], er: 0.35, erCentre: 0.27, muzzle: [0, 0.022, -0.66], eject: [0.04, 0.046, 0.065], fire: 'bolt', reload: 'mag', sprintPose: 1, cas: 'rifle', lhMag: [0.0, -0.05, 0.14] },
    pistol: { camShare: 0.6, adsYaw: 0.1, post: [0, 0.082, -0.18], scale: 0.64, hip: [0.075, -0.089, -0.322], hipYaw: 0.212, hipPitch: 0.3, sight: [0, 0.082, 0.095], er: 0.29, erCentre: 0.25, muzzle: [0, 0.045, -0.2], eject: [0.03, 0.045, 0.0], fire: 'slide', reload: 'slidemag', sprintPose: 0.8, cas: 'pistol', lhMag: [0.0, -0.04, 0.0] },
    fists: { scale: 1, hip: [0, 0, 0], sight: [0, 0, 0], er: 0.3, muzzle: [0, 0, -0.3], eject: null, fire: 'punch', reload: 'none', sprintPose: 0.6, cas: null, noAds: true },
    grenade: { scale: 1, hip: [0, 0, 0], sight: [0, 0, 0], er: 0.3, muzzle: [0, 0, -0.3], eject: null, fire: 'throw', reload: 'none', sprintPose: 0.7, cas: null, noAds: true },
  };

  /**
   * How far the gun is turned while aiming (radians). Default: the gun is held to the right of the view and turned in so its FRONT
   * SIGHT sits exactly on the crosshair (the rear sight is a little to the right of it, you see the side of the gun). With the
   * "centre the rear sight" setting the gun points straight down the view and the rear sight hole is on the crosshair.
   */
  function adsYaw(spec) {
    return RV.settings && RV.settings.adsCentre ? 0 : spec.adsYaw || 0;
  }

  /** Distance from the eye to the rear sight while aiming (metres): further away when the gun is held to the side, closer when centred. */
  function eyeRelief(spec) {
    return RV.settings && RV.settings.adsCentre && spec.erCentre ? spec.erCentre : spec.er;
  }

  /**
   * Root position (camera space) of a fully aimed gun: the rear sight `er` metres from the eye, the front sight on the line through
   * the crosshair (x = 0, y = 0) whatever the yaw. (The shot itself always leaves through the crosshair; this only places the gun.)
   */
  function adsPos(spec, out) {
    const s = spec.scale;
    out = out || [0, 0, 0];
    const post = spec.post || spec.sight,
      psi = adsYaw(spec),
      c = Math.cos(psi),
      sn = Math.sin(psi);
    out[0] = -s * (post[0] * c + post[2] * sn);
    out[1] = -s * post[1];
    out[2] = -eyeRelief(spec) - s * (-spec.sight[0] * sn + spec.sight[2] * c);
    return out;
  }

  // ---------------------------------------------------------------------------
  // CAMERA-DRIVEN ADS
  //
  // The first-person weapon is drawn by its own camera, in camera space. Sliding the gun from its low hip position to the middle of the
  // screen over a still world looks like a gun floating across the picture. Instead the VIEW does most of the work: while aiming, the
  // player's camera turns toward the weapon's sight (the world pans, the gun stays where it is relative to it), and the gun itself only
  // makes the small remaining adjustment (closer / a touch lower or inward) that gives the exact sight picture.
  //
  //   rig frame     = the frame the gun lives in (the player's look direction when NOT aiming); the gun's pose is blended hip -> ADS here
  //   camera turn   = R_c(ae) = Ry(ae * dpsi) * Rx(ae * dtheta): the extra yaw / pitch the camera has while aiming (ae = eased ADS progress)
  //   camera space  = R_c^-1 * rig pose: what the viewmodel camera finally sees
  //
  // dpsi / dtheta come from the weapon's real sight anchor (spec.post, else spec.sight) in the hip pose: the angle between that point and
  // the middle of the screen, times the weapon's share (spec.camShare) times the player's "camera pull" setting. The rig-frame ADS pose is
  // then DEFINED as R_c * (the exact sight-picture pose in camera space), so at full ADS the front sight is exactly on the crosshair
  // whatever the share is (share 0 = the old behaviour: the gun does everything). Everything here is computed from the spec once.
  // The game (modes.js) applies the same turn to the player's yaw / pitch as an increment, so mouse look is never fought and the shot
  // follows the crosshair.
  // ---------------------------------------------------------------------------
  const M1 = new Array(9),
    M2 = new Array(9),
    M3 = new Array(9);
  /** three.js 'XYZ' Euler (M = Rx * Ry * Rz) -> row-major 3x3 */
  function eulerM(x, y, z, m) {
    const a = Math.cos(x),
      b = Math.sin(x),
      c = Math.cos(y),
      d = Math.sin(y),
      e = Math.cos(z),
      f = Math.sin(z);
    const ae = a * e,
      af = a * f,
      be = b * e,
      bf = b * f;
    m[0] = c * e;
    m[1] = -c * f;
    m[2] = d;
    m[3] = af + be * d;
    m[4] = ae - bf * d;
    m[5] = -b * c;
    m[6] = bf - ae * d;
    m[7] = be + af * d;
    m[8] = a * c;
    return m;
  }
  /** row-major 3x3 -> three.js 'XYZ' Euler angles (into out[0..2]) */
  function mEuler(m, out) {
    const m13 = m[2] < -1 ? -1 : m[2] > 1 ? 1 : m[2];
    out[1] = Math.asin(m13);
    if (Math.abs(m13) < 0.9999999) {
      out[0] = Math.atan2(-m[5], m[8]);
      out[2] = Math.atan2(-m[1], m[0]);
    } else {
      out[0] = Math.atan2(m[7], m[4]);
      out[2] = 0;
    }
    return out;
  }
  function mMul(a, b, o) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  }
  /** camera rotation Ry(psi) * Rx(theta) (the camera's own yaw / pitch order) */
  function camM(psi, theta, o) {
    const cy = Math.cos(psi),
      sy = Math.sin(psi),
      cx = Math.cos(theta),
      sx = Math.sin(theta);
    // Ry = [[cy,0,sy],[0,1,0],[-sy,0,cy]]  Rx = [[1,0,0],[0,cx,-sx],[0,sx,cx]]
    o[0] = cy;
    o[1] = sy * sx;
    o[2] = sy * cx;
    o[3] = 0;
    o[4] = cx;
    o[5] = -sx;
    o[6] = -sy;
    o[7] = cy * sx;
    o[8] = cy * cx;
    return o;
  }
  const mT = (m, o) => {
    o[0] = m[0];
    o[1] = m[3];
    o[2] = m[6];
    o[3] = m[1];
    o[4] = m[4];
    o[5] = m[7];
    o[6] = m[2];
    o[7] = m[5];
    o[8] = m[8];
    return o;
  };

  /** The weapon's anchor the camera aligns with: the front sight (post) if it has one, else the rear sight. */
  function sightAnchor(spec) {
    return spec.post || spec.sight;
  }

  /** Where the sight anchor is, in camera space, for a root position `pos` and Euler `rot` (tests / tooling too). */
  function anchorAt(spec, pos, rot, out) {
    const m = eulerM(rot[0], rot[1], rot[2], M1),
      a = sightAnchor(spec),
      s = spec.scale;
    out = out || [0, 0, 0];
    out[0] = pos[0] + s * (m[0] * a[0] + m[1] * a[1] + m[2] * a[2]);
    out[1] = pos[1] + s * (m[3] * a[0] + m[4] * a[1] + m[5] * a[2]);
    out[2] = pos[2] + s * (m[6] * a[0] + m[7] * a[1] + m[8] * a[2]);
    return out;
  }

  /**
   * The camera-driven ADS numbers for a weapon (cached; recomputed when the spec or the settings change):
   *   dpsi / dtheta   the camera's extra yaw / pitch (radians, three.js convention: + yaw turns LEFT, + pitch looks UP) at full ADS
   *   px,py,pz rx,ry,rz   the gun's pose in the rig frame at full ADS
   *   off  {right, up}   angle of the hip-pose sight from the middle of the screen (radians), for tests
   */
  function adsCamera(spec) {
    const S = RV.settings || {};
    const pull = S.adsPull == null ? 1 : S.adsPull;
    const share = Math.max(0, Math.min(1, spec.camShare == null ? 0.75 : spec.camShare)) * Math.max(0, Math.min(1, pull));
    const hip = spec.hip;
    const an = sightAnchor(spec);
    const key =
      share * 977 + (S.adsCentre ? 1 : 0) * 331 + spec.er * 53 + (spec.erCentre || 0) * 59 + (spec.adsYaw || 0) * 61 + spec.scale * 67 +
      hip[0] * 71 + hip[1] * 73 + hip[2] * 79 + (spec.hipYaw || 0) * 83 + (spec.hipPitch || 0) * 89 + an[0] * 97 + an[1] * 101 + an[2] * 103 + spec.sight[2] * 107;
    const c = spec._cam;
    if (c && c.key === key) return c;
    const out = c || (spec._cam = {});
    out.key = key;
    out.share = share;
    // the hip pose's sight point -> its angle from the middle of the screen
    const hs = anchorAt(spec, hip, [spec.hipPitch || 0, spec.hipYaw || 0, 0], [0, 0, 0]);
    const right = Math.atan2(hs[0], -hs[2]),
      up = Math.atan2(hs[1], Math.hypot(hs[0], hs[2]));
    out.off = { right, up };
    out.dpsi = -right * share; // turning right = a smaller (more negative) yaw
    out.dtheta = up * share;
    // the exact sight-picture pose in camera space (front sight on the crosshair) ...
    const pa = adsPos(spec, [0, 0, 0]);
    const mc = eulerM(0, adsYaw(spec), 0, M1);
    // ... expressed in the rig frame: pose_rig = R_c * pose_cam
    const rc = camM(out.dpsi, out.dtheta, M2);
    out.px = rc[0] * pa[0] + rc[1] * pa[1] + rc[2] * pa[2];
    out.py = rc[3] * pa[0] + rc[4] * pa[1] + rc[5] * pa[2];
    out.pz = rc[6] * pa[0] + rc[7] * pa[1] + rc[8] * pa[2];
    const e = mEuler(mMul(rc, mc, M3), [0, 0, 0]);
    out.rx = e[0];
    out.ry = e[1];
    out.rz = e[2];
    return out;
  }

  /** The camera turn (yaw / pitch offsets to add to the player's look) for weapon `id` at ADS progress `ae`. */
  function adsCamAngles(id, ae, out) {
    out = out || { yaw: 0, pitch: 0 };
    const spec = SPEC[id];
    if (!spec || spec.noAds || !(ae > 0)) {
      out.yaw = out.pitch = 0;
      return out;
    }
    const c = adsCamera(spec);
    out.yaw = c.dpsi * ae;
    out.pitch = c.dtheta * ae;
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

      // --- final root pose: hip pose blended with the ADS pose IN THE RIG FRAME, then seen through the turned camera ----------------
      const hip = shownSpec.hip;
      const ae = shownSpec.noAds ? 0 : a; // only weapons with sights can aim
      o.id = shown;
      o.lower = lower;
      o.ads = ae;
      o.camYaw = 0;
      o.camPitch = 0;
      if (ae > 0.0001) {
        const cm = adsCamera(shownSpec);
        const px = hip[0] + (cm.px - hip[0]) * ae + x,
          py = hip[1] + (cm.py - hip[1]) * ae + y,
          pz = hip[2] + (cm.pz - hip[2]) * ae + z;
        // the gun is shouldered: at the hip its muzzle points in towards the crosshair; aiming blends to the sight-picture orientation
        const rx2 = rx + (shownSpec.hipPitch || 0) * (1 - ae) + cm.rx * ae,
          ry2 = ry + (shownSpec.hipYaw || 0) * (1 - ae) + cm.ry * ae,
          rz2 = rz + cm.rz * ae;
        // the camera has turned by ae * (dpsi, dtheta): the gun in camera space is R_c^-1 * (rig pose)
        o.camYaw = cm.dpsi * ae;
        o.camPitch = cm.dtheta * ae;
        const ci = mT(camM(o.camYaw, o.camPitch, M1), M2);
        o.x = ci[0] * px + ci[1] * py + ci[2] * pz;
        o.y = ci[3] * px + ci[4] * py + ci[5] * pz;
        o.z = ci[6] * px + ci[7] * py + ci[8] * pz;
        const e = mEuler(mMul(ci, eulerM(rx2, ry2, rz2, M3), M1), this._eul || (this._eul = [0, 0, 0]));
        o.rx = e[0];
        o.ry = e[1];
        o.rz = e[2];
      } else {
        o.x = hip[0] + x;
        o.y = hip[1] + y;
        o.z = hip[2] + z;
        o.rx = rx + (shownSpec.hipPitch || 0);
        o.ry = ry + (shownSpec.hipYaw || 0);
        o.rz = rz;
      }

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
        // aiming: the supporting forearm tips down out of the sight picture (the hand stays on the handguard)
        lh.rx += 0.42 * ae * (1 - r);
        lh.rz += 0.1 * ae * (1 - r);
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

  RV.vmanim = { SPEC, Animator, adsPos, adsYaw, eyeRelief, adsCamera, adsCamAngles, anchorAt, stepAds, reloadPose, seg, smooth, pulse, THROW, PUNCH };
})();
