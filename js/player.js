/* DASHDUEL - player movement physics.
 *
 * Fixed time-step, Quake/Source style movement with:
 *   - momentum: ground friction only bites when you actually touch the ground
 *     for a while, so hops / slides carry speed
 *   - air strafing (the classic "wish direction" projection rule)
 *   - slides with a speed boost that is capped (can't be farmed forever),
 *     downhill gain, and a slide-jump bonus
 *   - wall running on designated walls + wall jumps that redirect momentum
 *   - ramp launches, launch pads, coyote time and jump buffering
 *   - an optional double jump (one extra jump in the air, refreshed by touching the
 *     ground) that the game switches on only while the Fists are equipped
 */
(function () {
  'use strict';
  const RV = window.RV;

  const P = (RV.PHYS = {
    STEP: 1 / 120, // fixed simulation step (seconds)
    GRAVITY: 26,
    JUMP_V: 8.6,
    JUMP_BUFFER: 0.14,
    COYOTE: 0.09,

    HW: 0.35, // half width
    H_STAND: 1.8,
    H_CROUCH: 1.1,
    EYE_STAND: 1.62,
    EYE_CROUCH: 0.95,
    EYE_SLIDE: 0.78,
    STEP_GROUND: 0.45,
    STEP_AIR: 0.25,
    SNAP: 0.4,

    WALK: 7.0,
    SPRINT: 10.5,
    CROUCH: 4.0,
    GROUND_ACCEL: 12,
    FRICTION: 6.5,
    STOP_SPEED: 3.0,
    LAND_GRACE: 0.09, // reduced friction right after landing (hop window)

    // air
    AIR_STRAFE_ACCEL: 30, // m/s^2 of sideways authority
    AIR_STRAFE_CAP: 1.8, // m/s of wish-speed the strafe rule can add along a direction
    AIR_BRAKE: 10, // authority when you push against your own velocity
    AIR_WISH_SPEED: 7.0, // low-speed steering target
    AIR_ACCEL: 9,
    AIR_STEER_RATE: 2.6, // rad/s, forward-only mouse steering that keeps speed
    MAX_SPEED: 60,

    // slide
    SLIDE_MIN: 5.5,
    SLIDE_END: 3.0,
    SLIDE_BOOST: 2.5,
    SLIDE_BOOST_CAP: 15,
    SLIDE_BOOST_CD: 0.6,
    SLIDE_DECEL: 3.2,
    SLIDE_TURN: 1.5,
    SLIDE_JUMP_BONUS: 1.5,
    SLIDE_JUMP_CAP: 19,

    // walls
    WALL_PROBE: 0.45, // how close a wall must be to latch on (generous: grazing it counts)
    WALLRUN_MIN: 5.0, // speed along the wall needed to start
    WALLRUN_SPEED: 10,
    WALLRUN_ACCEL: 30,
    WALLRUN_MAX_TIME: 3.2,
    WALLRUN_STALL: 3.5,
    WALLRUN_HOVER: 1.6, // seconds the wall run holds its height before you start to sink
    WALLRUN_GRAV: 0.12,
    WALLRUN_UP_GRAV: 0.55,
    WALLRUN_MAX_FALL: 1.0,
    WALL_STICK: 1.4,
    WALL_GRACE: 0.12,
    WALLJUMP_UP: 8.8,
    WALLJUMP_NORMAL: 0.8,
    WALLJUMP_MIN_SPEED: 9,
    WALLJUMP_MIN_OUT: 5,
    WALLJUMP_COYOTE: 0.1,
    WALLJUMP_NO_STEER: 0.35, // forward-steering is paused briefly so the redirect carries

    PAD_CD: 0.3,

    // double jump (fists only)
    DJ_V: 8.4, // upward speed of the second jump (the vertical speed is replaced, not added)
    DJ_PUSH: 2.2, // m/s of redirect towards the held direction (never raises speed past sprint / current speed)
    DJ_MIN_AIR: 0.04, // seconds after leaving the ground before the extra jump can fire
  });

  const SLIDE_STATES = { stand: 0, crouch: 1, slide: 2 };

  class Player {
    constructor(world) {
      this.world = world;
      this.b = {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        hw: P.HW,
        h: P.H_STAND,
        grounded: false,
        stepGround: P.STEP_GROUND,
        stepAir: P.STEP_AIR,
        hitX: 0,
        hitZ: 0,
        hitUp: false,
        landed: false,
        stepped: false,
      };
      this.yaw = 0;
      this.pitch = 0;
      this.roll = 0;
      this.onEvent = null; // (type, data) => void
      this.autoHop = true;
      this._g = { y: 0, nx: 0, ny: 1, nz: 0, solid: null };
      this._contacts = [];
      this.reset(0, 0, 0, 0, 0);
    }

    reset(x, y, z, yaw, pitch) {
      const b = this.b;
      b.x = x;
      b.y = y;
      b.z = z;
      b.vx = b.vy = b.vz = 0;
      b.h = P.H_STAND;
      b.grounded = false;
      this.prevX = x;
      this.prevY = y;
      this.prevZ = z;
      this.yaw = yaw || 0;
      this.pitch = pitch || 0;
      this.mode = 'stand'; // stand | crouch | slide
      this.eyeH = P.EYE_STAND;
      this.roll = 0;
      this.rollTarget = 0;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.djEnabled = false; // set every frame by the game: true while Fists are equipped
      this.djUsed = false; // the extra jump of this air time has been spent
      this.slideCd = 0;
      this.slideBoostCd = 0;
      this.slideTime = 0;
      this.groundTime = 0;
      this.airTime = 0;
      this.wallRunning = false;
      this.wallKey = -1;
      this.wallN = { x: 0, z: 0 };
      this.wallSide = 0;
      this.wallLost = 0;
      this.wallRunTime = 0;
      this.wallStamina = 4.0;
      this.lastWallKey = -1;
      this.wjTimer = 0;
      this.wjKey = -1;
      this.wjNx = 0;
      this.wjNz = 0;
      this.wjRunnable = false;
      this.padCd = 0;
      this.noSteer = 0;
      this.hopChain = 0;
      this.lastHopTime = 99;
      this.fallSpeed = 0;
      this.slopeN = { x: 0, y: 1, z: 0 };
      this.jumpedThisStep = false;
      this.speedH = 0;
      this.maxSpeed = 0;
      this.frozen = false;
      this.time = 0;
    }

    get speed() {
      return this.speedH;
    }

    _emit(type, data) {
      if (this.onEvent) this.onEvent(type, data);
    }

    _setHeight(h) {
      const b = this.b;
      if (h === b.h) return true;
      if (h > b.h) {
        // standing up needs headroom
        if (this.world.overlapsAny(b.x, b.y, b.z, b.hw - 0.01, h)) return false;
      }
      b.h = h;
      return true;
    }

    /**
     * Advance the simulation by dt seconds.
     * cmd: {fwd,side (-1..1), jumpPressed, jumpDown, crouch, sprint}
     */
    step(dt, cmd) {
      const b = this.b;
      const w = this.world;
      this.time += dt;
      this.prevX = b.x;
      this.prevY = b.y;
      this.prevZ = b.z;

      if (this.frozen) {
        b.vx = b.vy = b.vz = 0;
        this._updateEye(dt);
        return;
      }

      // ---- timers ----------------------------------------------------------
      this.slideCd = Math.max(0, this.slideCd - dt);
      this.slideBoostCd = Math.max(0, this.slideBoostCd - dt);
      this.padCd = Math.max(0, this.padCd - dt);
      this.noSteer = Math.max(0, this.noSteer - dt);
      this.wjTimer = Math.max(0, this.wjTimer - dt);
      this.lastHopTime += dt;
      this.jumpBuf = cmd.jumpPressed ? P.JUMP_BUFFER : Math.max(0, this.jumpBuf - dt);
      this.coyote = b.grounded ? P.COYOTE : Math.max(0, this.coyote - dt);
      if (b.grounded) {
        this.groundTime += dt;
        this.airTime = 0;
        this.djUsed = false; // touching the ground refreshes the extra jump
      } else {
        this.groundTime = 0;
        this.airTime += dt;
      }

      // ---- view vectors / wish direction ------------------------------------
      const sy = Math.sin(this.yaw),
        cy = Math.cos(this.yaw);
      const fx = -sy,
        fz = -cy,
        rx = cy,
        rz = -sy;
      let wx = fx * cmd.fwd + rx * cmd.side;
      let wz = fz * cmd.fwd + rz * cmd.side;
      let wl = Math.sqrt(wx * wx + wz * wz);
      const hasWish = wl > 0.001;
      if (hasWish) {
        wx /= wl;
        wz /= wl;
        if (wl > 1) wl = 1;
      }
      let speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);

      const wantJump = this.jumpBuf > 0 || (this.autoHop && cmd.jumpDown);
      const wasGrounded = b.grounded;
      this.jumpedThisStep = false;

      // ---- crouch / slide state ----------------------------------------------
      this._updateCrouch(cmd, speedH, hasWish);

      // ---- wall detection (airborne only) -------------------------------------
      let handledByWall = false;
      if (!b.grounded) handledByWall = this._wallLogic(dt, cmd, wx, wz, hasWish, fx, fz);
      else this._endWallRun(false);

      // ---- jumping ---------------------------------------------------------
      if (!handledByWall && wantJump && (b.grounded || this.coyote > 0)) {
        // a slide may just have boosted us this step: use the current speed, not the stale one
        speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
        this._jump(speedH);
        speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      }

      // ---- double jump: one extra jump in the air, only while the equipped weapon allows it ----
      // A fresh press only (never auto-hop), never while a wall jump / wall run is in control, and
      // never when the press is really a buffered bunny hop (the ground is about to touch us).
      if (this.djEnabled && !this.djUsed && cmd.jumpPressed && !b.grounded && !this.jumpedThisStep && !handledByWall && this.coyote <= 0 && this.airTime > P.DJ_MIN_AIR) {
        const gy = w.floorBelow(b.x, b.y + 0.1, b.z, b.hw);
        const above = b.y - gy;
        const hopWindow = b.vy < 0 && above <= -b.vy * P.JUMP_BUFFER + 0.25;
        if (!hopWindow) this._doubleJump(wx, wz, hasWish);
      }

      // ---- horizontal + vertical velocity -------------------------------------
      let dy;
      if (b.grounded && !this.jumpedThisStep) {
        if (this.mode === 'slide') this._slideMove(dt, wx, wz, hasWish);
        else this._groundMove(dt, wx, wz, wl, hasWish, cmd);
        b.vy = 0;
        dy = 0;
      } else {
        if (!this.wallRunning) this._airMove(dt, wx, wz, wl, hasWish, cmd, speedH);
        // gravity
        const g = P.GRAVITY * (this.wallRunning ? 0 : 1);
        if (this.wallRunning) {
          this._wallRunVertical(dt);
          dy = b.vy * dt;
        } else {
          dy = (b.vy - 0.5 * g * dt) * dt;
          b.vy -= g * dt;
        }
      }

      // hard speed cap
      speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      if (speedH > P.MAX_SPEED) {
        const k = P.MAX_SPEED / speedH;
        b.vx *= k;
        b.vz *= k;
      }

      // ---- move + collide ----------------------------------------------------
      const preVy = b.vy;
      b.grounded = wasGrounded && !this.jumpedThisStep ? b.grounded : false;
      w.move(b, b.vx * dt, dy, b.vz * dt);
      if (b.hitX !== 0) b.vx = 0;
      if (b.hitZ !== 0) b.vz = 0;
      if (b.hitUp && b.vy > 0) b.vy = 0;
      if (b.landed && b.vy < 0) b.vy = 0;

      // ---- ground state --------------------------------------------------------
      const g = this._g;
      let found = b.vy <= 0.01 && w.probeGround(b, 0.05, g);
      if (!found && wasGrounded && !this.jumpedThisStep && b.vy <= 0.01) {
        // snap down slopes / small steps instead of skipping off them
        if (w.probeGround(b, P.SNAP, g)) {
          b.y = g.y;
          found = true;
        }
      }
      if (found) {
        if (b.y < g.y) b.y = g.y; // sink-correct
        const wasAir = !wasGrounded;
        b.grounded = true;
        this.slopeN.x = g.nx;
        this.slopeN.y = g.ny;
        this.slopeN.z = g.nz;
        if (wasAir) this._land(Math.max(this.fallSpeed, -preVy));
        this.fallSpeed = 0;
        if (b.vy < 0) b.vy = 0;
      } else {
        if (wasGrounded && !this.jumpedThisStep) {
          // walked off an edge: leaving a rising ramp launches you along the slope
          const n = this.slopeN;
          if (n.y > 0.01 && n.y < 0.999) {
            const vyL = -(b.vx * n.x + b.vz * n.z) / n.y;
            if (vyL > 0.5) b.vy = Math.max(b.vy, vyL * 0.95);
          }
        }
        b.grounded = false;
        if (b.vy < 0) this.fallSpeed = Math.max(this.fallSpeed, -b.vy);
      }

      // ---- pads ----------------------------------------------------------------
      this._checkPads();

      // ---- bookkeeping -----------------------------------------------------------
      this.speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      if (this.speedH > this.maxSpeed) this.maxSpeed = this.speedH;
      this._updateEye(dt);
    }

    // ---------------------------------------------------------------------------
    _updateCrouch(cmd, speedH, hasWish) {
      const b = this.b;
      const want = cmd.crouch;
      if (b.grounded) {
        if (this.mode !== 'slide') {
          if (want && speedH >= P.SLIDE_MIN && this.slideCd <= 0 && !this.wallRunning) {
            this._startSlide(speedH, hasWish);
          } else if (want) {
            this.mode = 'crouch';
            this._setHeight(P.H_CROUCH);
          } else if (this.mode === 'crouch') {
            if (this._setHeight(P.H_STAND)) this.mode = 'stand';
          }
        } else if (!want) {
          this._endSlide(0.1);
        } else if (speedH < P.SLIDE_END) {
          this.mode = 'crouch';
          this.slideCd = 0.2;
        }
      } else {
        // in the air: hitbox follows the crouch key so you can tuck through gaps
        if (this.mode === 'slide') this.mode = 'crouch';
        if (want) {
          this.mode = 'crouch';
          this._setHeight(P.H_CROUCH);
        } else if (this.mode === 'crouch') {
          if (this._setHeight(P.H_STAND)) this.mode = 'stand';
        }
      }
    }

    _startSlide(speedH, hasWish) {
      const b = this.b;
      this.mode = 'slide';
      this.slideTime = 0;
      this._setHeight(P.H_CROUCH);
      if (this.slideBoostCd <= 0 && speedH < P.SLIDE_BOOST_CAP) {
        const ns = Math.min(P.SLIDE_BOOST_CAP, speedH + P.SLIDE_BOOST);
        const k = ns / speedH;
        b.vx *= k;
        b.vz *= k;
      }
      this.slideBoostCd = P.SLIDE_BOOST_CD;
      this._emit('slide', null);
    }

    _endSlide(cd) {
      this.slideCd = cd || 0;
      if (this._setHeight(P.H_STAND)) this.mode = 'stand';
      else this.mode = 'crouch';
    }

    _slideMove(dt, wx, wz, hasWish) {
      const b = this.b;
      this.slideTime += dt;
      let speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      // steer: rotate the velocity towards the wish direction without adding speed
      if (hasWish && speed > 0.5) {
        const cur = Math.atan2(b.vz, b.vx);
        const want = Math.atan2(wz, wx);
        const d = RV.angleDiff(cur, want);
        const turn = Math.max(-P.SLIDE_TURN * dt, Math.min(P.SLIDE_TURN * dt, d));
        const na = cur + turn;
        b.vx = Math.cos(na) * speed;
        b.vz = Math.sin(na) * speed;
      }
      // slope: gravity along the surface (downhill gain, uphill loss)
      const n = this.slopeN;
      if (n.y < 0.999) {
        const g = P.GRAVITY;
        b.vx += g * n.y * n.x * dt;
        b.vz += g * n.y * n.z * dt;
      }
      speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      const dec = P.SLIDE_DECEL * dt;
      if (speed > 0.001) {
        const ns = Math.max(0, speed - dec);
        const k = ns / speed;
        b.vx *= k;
        b.vz *= k;
      }
    }

    _groundMove(dt, wx, wz, wl, hasWish, cmd) {
      const b = this.b;
      let speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      // friction
      if (speed > 0.001) {
        const grace = this.groundTime < P.LAND_GRACE;
        const fr = P.FRICTION * (grace ? 0.2 : 1);
        const drop = Math.max(speed, P.STOP_SPEED) * fr * dt;
        const ns = Math.max(0, speed - drop);
        const k = ns / speed;
        b.vx *= k;
        b.vz *= k;
      }
      if (!hasWish) return;
      let wishSpeed;
      if (this.mode === 'crouch') wishSpeed = P.CROUCH;
      else wishSpeed = cmd.sprint && cmd.fwd >= 0 ? P.SPRINT : P.WALK;
      wishSpeed *= wl;
      const cur = b.vx * wx + b.vz * wz;
      const add = wishSpeed - cur;
      if (add <= 0) return;
      const acc = Math.min(P.GROUND_ACCEL * wishSpeed * dt, add);
      b.vx += wx * acc;
      b.vz += wz * acc;
    }

    _airMove(dt, wx, wz, wl, hasWish, cmd, speedH) {
      const b = this.b;
      if (!hasWish) return;
      const proj = b.vx * wx + b.vz * wz;

      // 1) strafe rule: adds speed sideways, never forwards beyond the cap
      const a = proj < -0.5 ? P.AIR_BRAKE : P.AIR_STRAFE_ACCEL;
      const add = Math.min(a * dt, Math.max(0, P.AIR_STRAFE_CAP - proj));
      if (add > 0) {
        b.vx += wx * add;
        b.vz += wz * add;
      }

      // 2) low-speed steering so slow jumps stay controllable
      if (speedH < P.AIR_WISH_SPEED) {
        const ws = P.AIR_WISH_SPEED * wl;
        const cur = b.vx * wx + b.vz * wz;
        const ad = ws - cur;
        if (ad > 0) {
          const acc = Math.min(P.AIR_ACCEL * ws * dt, ad);
          b.vx += wx * acc;
          b.vz += wz * acc;
        }
      }

      // 3) forward-only: bend velocity towards the view without changing speed
      if (cmd.side === 0 && cmd.fwd > 0 && this.noSteer <= 0) {
        const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
        if (sp > 1) {
          const cur = Math.atan2(b.vz, b.vx);
          const want = Math.atan2(wz, wx);
          const d = RV.angleDiff(cur, want);
          const turn = Math.max(-P.AIR_STEER_RATE * dt, Math.min(P.AIR_STEER_RATE * dt, d));
          const na = cur + turn;
          b.vx = Math.cos(na) * sp;
          b.vz = Math.sin(na) * sp;
        }
      }
    }

    _jump(speedH) {
      const b = this.b;
      const fromSlide = this.mode === 'slide';
      b.vy = P.JUMP_V;
      // jumping while running UP a slope keeps the climb speed (ramp jumps carry further)
      const sn = this.slopeN;
      if (sn.y > 0.01 && sn.y < 0.999) {
        const rise = -(b.vx * sn.x + b.vz * sn.z) / sn.y;
        if (rise > 0) b.vy += rise * 0.95;
      }
      b.grounded = false;
      this.jumpedThisStep = true;
      this.coyote = 0;
      this.jumpBuf = 0;
      if (fromSlide) {
        // slide jump: keep the slide's momentum and add a little on top
        if (speedH > 0.1 && speedH < P.SLIDE_JUMP_CAP) {
          const ns = Math.min(P.SLIDE_JUMP_CAP, speedH + P.SLIDE_JUMP_BONUS);
          const k = ns / speedH;
          b.vx *= k;
          b.vz *= k;
        }
        this.mode = 'crouch';
        this.slideCd = 0;
      }
      // hop chain bookkeeping
      if (this.lastHopTime < 0.5) this.hopChain++;
      else this.hopChain = 1;
      this.lastHopTime = 0;
      this._emit('jump', { slide: fromSlide });
    }

    /** The extra jump: replaces the vertical speed, keeps momentum, nudges the direction towards the held keys. */
    _doubleJump(wx, wz, hasWish) {
      const b = this.b;
      this.djUsed = true;
      this.jumpBuf = 0;
      b.vy = P.DJ_V;
      if (hasWish) {
        const sp0 = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
        let nx = b.vx + wx * P.DJ_PUSH,
          nz = b.vz + wz * P.DJ_PUSH;
        // the redirect may turn the velocity but never costs speed, and never lifts it past sprint speed
        const cap = Math.max(sp0, P.SPRINT);
        const l = Math.sqrt(nx * nx + nz * nz);
        const want = Math.min(cap, Math.max(sp0, l));
        if (l > 1e-6) {
          nx *= want / l;
          nz *= want / l;
          b.vx = nx;
          b.vz = nz;
        }
      }
      this.jumpedThisStep = true; // the air-move below must not treat this step as a free fall
      this._emit('doublejump', { x: b.x, y: b.y, z: b.z });
    }

    _land(impact) {
      const b = this.b;
      this.wallStamina = 4.0;
      this.lastWallKey = -1;
      this._endWallRun(false);
      if (impact > 4) this._emit('land', { impact });
      // landing with crouch held at speed -> slide (handled next step by _updateCrouch)
    }

    // -------------------------------------------------------------------------
    // Walls
    // -------------------------------------------------------------------------
    _endWallRun(blockSame) {
      if (!this.wallRunning) return;
      this.wallRunning = false;
      this.wallSide = 0;
      if (blockSame) this.lastWallKey = this.wallKey;
      this._emit('wallrunend', null);
    }

    /** Returns true when the wall system fully controls this step's air movement. */
    _wallLogic(dt, cmd, wx, wz, hasWish, fx, fz) {
      const b = this.b;
      const n = this.world.wallContacts(b, P.WALL_PROBE, this._contacts);
      const list = this._contacts;

      // remember the nearest wall for wall-jump coyote time
      let near = -1,
        nearGap = 9;
      for (let i = 0; i < n; i++) {
        if (list[i].gap < nearGap) {
          nearGap = list[i].gap;
          near = i;
        }
      }
      if (near >= 0) {
        this.wjTimer = P.WALLJUMP_COYOTE;
        this.wjNx = list[near].nx;
        this.wjNz = list[near].nz;
        this.wjKey = list[near].key;
        this.wjRunnable = list[near].runnable;
      }

      const wantJumpPress = this.jumpBuf > 0;

      if (this.wallRunning) {
        // still touching our wall?
        let cur = null;
        for (let i = 0; i < n; i++) if (list[i].key === this.wallKey) cur = list[i];
        if (cur) {
          this.wallLost = 0;
          this.wallN.x = cur.nx;
          this.wallN.z = cur.nz;
        } else {
          this.wallLost += dt;
        }
        const nx = this.wallN.x,
          nz = this.wallN.z;
        const vn = b.vx * nx + b.vz * nz;
        const tx = b.vx - nx * vn,
          tz = b.vz - nz * vn;
        const ts = Math.sqrt(tx * tx + tz * tz);
        this.wallRunTime += dt;
        this.wallStamina -= dt;
        if (
          this.wallLost > P.WALL_GRACE ||
          this.wallRunTime > P.WALLRUN_MAX_TIME ||
          this.wallStamina <= 0 ||
          ts < P.WALLRUN_STALL ||
          cmd.crouch ||
          cmd.fwd < 0 ||
          (!hasWish)
        ) {
          this._endWallRun(true);
          return false;
        }
        if (wantJumpPress) {
          this._wallJump(nx, nz, this.wallKey, wx, wz, hasWish, fx, fz);
          return true;
        }
        // keep the speed along the wall (never lose momentum), push gently into it
        let sp = ts;
        if (sp < P.WALLRUN_SPEED) sp = Math.min(P.WALLRUN_SPEED, sp + P.WALLRUN_ACCEL * dt);
        b.vx = (tx / ts) * sp - nx * P.WALL_STICK;
        b.vz = (tz / ts) * sp - nz * P.WALL_STICK;
        // roll away from the wall (wall on the right -> tilt left)
        const rxv = Math.cos(this.yaw),
          rzv = -Math.sin(this.yaw);
        this.wallSide = -(nx * rxv + nz * rzv) > 0 ? 1 : -1; // +1: wall on the right
        return true;
      }

      // --- try to start a wall run ---------------------------------------------
      if (n > 0 && this.airTime > 0.05 && hasWish && cmd.fwd >= 0 && !cmd.crouch && this.wallStamina > 0.1) {
        let best = null;
        for (let i = 0; i < n; i++) {
          const c = list[i];
          if (!c.runnable || c.key === this.lastWallKey) continue;
          if (!best || c.gap < best.gap) best = c;
        }
        if (best) {
          const nx = best.nx,
            nz = best.nz;
          const vn = b.vx * nx + b.vz * nz;
          const tx = b.vx - nx * vn,
            tz = b.vz - nz * vn;
          const ts = Math.sqrt(tx * tx + tz * tz);
          if (ts >= P.WALLRUN_MIN && vn <= 2.5 && b.vy > -14) {
            this.wallRunning = true;
            this.wallKey = best.key;
            this.wallN.x = nx;
            this.wallN.z = nz;
            this.wallRunTime = 0;
            this.wallLost = 0;
            this.lastWallKey = -1;
            if (b.vy < -2) b.vy *= 0.4;
            this._emit('wallrun', null);
            if (wantJumpPress) {
              this._wallJump(nx, nz, best.key, wx, wz, hasWish, fx, fz);
            }
            return true;
          }
        }
      }

      // --- plain wall jump off any wall ------------------------------------------
      if (wantJumpPress && this.wjTimer > 0 && this.wjKey !== this.lastWallKey && this.airTime > 0.04) {
        this._wallJump(this.wjNx, this.wjNz, this.wjKey, wx, wz, hasWish, fx, fz);
        return true;
      }
      return false;
    }

    _wallJump(nx, nz, key, wx, wz, hasWish, fx, fz) {
      const b = this.b;
      const speedH = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      // steer with the wish direction, falling back to the view direction
      let lx = hasWish ? wx : fx,
        lz = hasWish ? wz : fz;
      const ln = lx * nx + lz * nz;
      if (ln < 0) {
        lx -= nx * ln; // never steer into the wall...
        lz -= nz * ln;
      } // ...but looking away from it adds to the push-off
      let dx = nx * P.WALLJUMP_NORMAL + lx;
      let dz = nz * P.WALLJUMP_NORMAL + lz;
      const dl = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= dl;
      dz /= dl;
      const sp = Math.max(speedH * 0.99, P.WALLJUMP_MIN_SPEED);
      b.vx = dx * sp;
      b.vz = dz * sp;
      const out = b.vx * nx + b.vz * nz;
      if (out < P.WALLJUMP_MIN_OUT) {
        b.vx += nx * (P.WALLJUMP_MIN_OUT - out);
        b.vz += nz * (P.WALLJUMP_MIN_OUT - out);
      }
      b.vy = P.WALLJUMP_UP;
      b.grounded = false;
      this.jumpedThisStep = true;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.wjTimer = 0;
      this.lastWallKey = key;
      this.wallStamina = 4.0; // a wall jump refreshes the next wall run
      this.noSteer = P.WALLJUMP_NO_STEER;
      const wasRun = this.wallRunning;
      this.wallRunning = false;
      this.wallSide = 0;
      if (wasRun) this._emit('wallrunend', null);
      this.hopChain++;
      this.lastHopTime = 0;
      this._emit('walljump', null);
    }

    _wallRunVertical(dt) {
      const b = this.b;
      if (b.vy > 0) {
        b.vy -= P.GRAVITY * P.WALLRUN_UP_GRAV * dt;
      } else if (this.wallRunTime < P.WALLRUN_HOVER) {
        b.vy = Math.min(0, b.vy + 26 * dt); // level run: damp any fall to zero
      } else {
        b.vy -= P.GRAVITY * P.WALLRUN_GRAV * dt;
        if (b.vy < -P.WALLRUN_MAX_FALL) b.vy = -P.WALLRUN_MAX_FALL;
      }
    }

    // -------------------------------------------------------------------------
    _checkPads() {
      if (this.padCd > 0) return;
      const b = this.b;
      const pads = this.world.pads;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (b.x + b.hw > p.x0 && b.x - b.hw < p.x1 && b.z + b.hw > p.z0 && b.z - b.hw < p.z1) {
          if (b.y >= p.y - 0.4 && b.y <= p.y + 0.7) {
            b.vx = p.vx + b.vx * p.keep;
            b.vz = p.vz + b.vz * p.keep;
            b.vy = p.vy;
            b.grounded = false;
            this.padCd = P.PAD_CD;
            this.noSteer = 0.45; // keep the launch trajectory predictable
            this.jumpBuf = 0;
            this.coyote = 0;
            this.wallStamina = 4.0;
            this.lastWallKey = -1;
            this._emit('pad', { pad: p });
            return;
          }
        }
      }
    }

    _updateEye(dt) {
      let target = P.EYE_STAND;
      if (this.mode === 'slide') target = P.EYE_SLIDE;
      else if (this.mode === 'crouch') target = P.EYE_CROUCH;
      this.eyeH = RV.damp(this.eyeH, target, 16, dt);
      // camera roll for wall runs
      const rollTarget = this.wallRunning ? this.wallSide * 0.16 : 0;
      this.roll = RV.damp(this.roll, rollTarget, 9, dt);
    }

    /** Interpolated eye position for rendering / shooting. */
    getEye(alpha, out) {
      const b = this.b;
      out.x = this.prevX + (b.x - this.prevX) * alpha;
      out.y = this.prevY + (b.y - this.prevY) * alpha + this.eyeH;
      out.z = this.prevZ + (b.z - this.prevZ) * alpha;
      return out;
    }

    /** Unit forward vector from yaw/pitch (the exact line through the crosshair). */
    getForward(out) {
      const cp = Math.cos(this.pitch);
      out.x = -Math.sin(this.yaw) * cp;
      out.y = Math.sin(this.pitch);
      out.z = -Math.cos(this.yaw) * cp;
      return out;
    }

    get stateLabel() {
      if (this.wallRunning) return 'WALL RUN';
      if (this.mode === 'slide') return 'SLIDE';
      if (!this.b.grounded) return 'AIR';
      if (this.mode === 'crouch') return 'CROUCH';
      return 'GROUND';
    }
  }

  RV.Player = Player;
})();
