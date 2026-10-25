/* DASHDUEL - weapons.
 *
 * Exactly four selectable weapons (slot = number key):
 *   1 Assault Rifle  full-auto hitscan
 *   2 Handgun        semi-auto hitscan
 *   3 Fists          melee; the only weapon that enables the double jump
 *   4 Grenade        the ONLY weapon with travel time (thrown projectile, fuse, area damage)
 *
 * Rules for the two guns (non-negotiable):
 *   - hitscan: the ray is cast at the instant of firing, hits land the same frame
 *   - zero recoil: firing never changes yaw / pitch / camera position
 *   - zero spread: every shot uses the exact view direction through the crosshair
 *   - no bullet drop, no travel time, no camera shake
 *   - tracers / sparks / muzzle flash are cosmetic and are created AFTER the hit is resolved
 *   - weapons never slow your movement (not while shooting, reloading, aiming or switching)
 *
 * Fists resolve their hit inside the click as well (a fat ray against slightly enlarged
 * hitboxes, blocked by walls); the punch animation that follows is purely cosmetic.
 */
(function () {
  'use strict';
  const RV = window.RV;
  // the data lives in weapondata.js (shared with the game server)
  const WEAPONS = RV.WEAPONS,
    BY_ID = RV.WEAPON_BY_ID,
    ARMOR = RV.ARMOR,
    damageAt = RV.damageAt;

  class Loadout {
    constructor(game) {
      this.g = game;
      this._rh = { t: 0, nx: 0, ny: 0, nz: 0, solid: null };
      this._muzzle = new THREE.Vector3();
      this.slots = WEAPONS.map((w) => ({ w, ammo: w.mag, reserve: w.reserve || 0 }));
      this.reset();
    }

    reset() {
      for (const s of this.slots) {
        s.ammo = s.w.mag;
        s.reserve = s.w.reserve || 0;
      }
      this.cur = RV.clamp(Math.round(RV.settings.startWeapon || 0), 0, WEAPONS.length - 1);
      this.last = this.cur === 0 ? 1 : 0;
      this.reloading = false;
      this.reloadT = 0;
      this.cd = 0;
      this.fireBuf = 0;
      this.switchT = 0;
      this.shots = 0;
      this.hits = 0;
      this.prevId = this.weapon.id;
      this.switchDur = 0;
      this.adsT = 0;
      this.ads = 0;
      this.adsWeapon = WEAPONS[0];
      // grenades
      const gw = BY_ID.grenade;
      this.grenades = gw.maxCount;
      this.gregen = gw.regen;
      this.gcd = 0;
      this.throwT = -1; // seconds into the throw animation, -1 = idle
      this.holding = false; // pin out, grenade held while aiming
      this.holdT = 0; // seconds the grenade has been held at the hold pose
      this.thrown = false; // the grenade of this throw has left the hand
      this._syncView();
    }

    get weapon() {
      return this.slots[this.cur].w;
    }
    get ammo() {
      return this.slots[this.cur].ammo;
    }
    set ammo(v) {
      this.slots[this.cur].ammo = v;
    }
    get mag() {
      return this.weapon.mag;
    }
    /** Spare rounds for the weapon in hand (Practice has unlimited ammunition). */
    get reserve() {
      return this.slots[this.cur].reserve;
    }
    set reserve(v) {
      this.slots[this.cur].reserve = v;
    }

    refill() {
      for (const s of this.slots) {
        s.ammo = s.w.mag;
        s.reserve = s.w.reserve || 0;
      }
      this.reloading = false;
      this.grenades = BY_ID.grenade.maxCount;
      this.gregen = BY_ID.grenade.regen;
      this.cancelThrow();
    }

    _syncView() {
      if (RV.viewmodel && RV.viewmodel.ready) RV.viewmodel.reset(this.weapon.id);
    }

    select(i) {
      if (i < 0 || i >= this.slots.length || i === this.cur) return false;
      this.cancelHeld(); // before the release nothing is lost; after it the grenade is already out
      this.prevId = this.weapon.id; // the old weapon is lowered first, then the new one is raised
      this.last = this.cur;
      this.cur = i;
      this.reloading = false;
      this.reloadT = 0;
      this.switchT = this.weapon.switchTime;
      this.switchDur = this.weapon.switchTime;
      this.cd = Math.max(this.cd, this.switchT);
      this.fireBuf = 0;
      RV.audio.play('swap');
      return true;
    }

    selectLast() {
      return this.select(this.last);
    }

    cycle(dir) {
      const n = this.slots.length;
      return this.select((this.cur + dir + n) % n);
    }

    cancelThrow() {
      this.throwT = -1;
      this.thrown = false;
      this.holdT = 0;
    }

    /** The player gave up a held grenade (R, switching weapon, dying): the server must know too. */
    cancelHeld() {
      if (this.throwT >= 0 && !this.thrown && this.g.mode === 'online') RV.online.sendNadeCancel();
      this.cancelThrow();
    }

    startReload() {
      const w = this.weapon;
      if (w.kind !== 'gun' || this.reloading || this.ammo >= w.mag || this.switchT > 0 || this.reserve <= 0) return;
      this.reloading = true;
      this.reloadT = w.reload;
      RV.audio.play('reload', w.id);
      if (this.g.mode === 'online') RV.online.sendReload();
    }

    /** 0..1 progress of the next grenade being restocked (1 = full stock). */
    grenadeCharge() {
      const gw = BY_ID.grenade;
      if (this.grenades >= gw.maxCount) return 1;
      return RV.clamp(1 - this.gregen / this.regenTime(), 0, 1);
    }
    regenTime() {
      const gw = BY_ID.grenade;
      return this.g.mode === 'practice' ? gw.regenPractice : gw.regen;
    }

    /** Facts the first-person animator needs (it never feeds anything back into combat). */
    viewState(out) {
      const w = this.weapon;
      out.id = w.id;
      out.prevId = this.prevId;
      out.switchT = this.switchT;
      out.switchDur = this.switchDur;
      out.reload = this.reloading && w.reload > 0 ? 1 - this.reloadT / w.reload : -1;
      out.ammo = this.ammo;
      out.mag = this.mag;
      out.ads = this.ads;
      out.throwP = this.throwT >= 0 ? this.throwT / RV.vmanim.THROW.total : -1;
      out.grenades = this.grenades;
    }

    /**
     * Aim down sights. `want` is the player's intent; ADS is refused while
     * switching or reloading and for weapons without sights. The transition is
     * linear in TIME (so it lasts the same at any frame rate) and eased for
     * display. Purely visual: the shot always leaves the camera centre.
     */
    updateAds(dt, want) {
      const w = this.weapon;
      const can = w.adsFovMul > 0;
      if (can) this.adsWeapon = w;
      const ok = want && can && !this.reloading && this.switchT <= 0;
      this.adsT = RV.vmanim.stepAds(this.adsT, ok, dt, this.adsWeapon.adsIn, this.adsWeapon.adsOut);
      this.ads = RV.vmanim.smooth(this.adsT);
      return this.ads;
    }

    /** Target horizontal FOV (degrees) at full ADS for a given base FOV. */
    adsTargetFov(baseFov) {
      // the weapon's own zoom (adsFovMul: 0.7 = the view is 30% narrower), scaled by the player's "ADS zoom" setting
      const z = RV.settings && RV.settings.adsZoom != null ? RV.settings.adsZoom : 1;
      return baseFov * RV.clamp(1 - (1 - this.adsWeapon.adsFovMul) * z, 0.35, 1);
    }

    /**
     * ctx: {eye, fwd, vel, fireHeld, firePressed, reloadPressed, canFire}
     * Called once per rendered frame with the exact camera pose being displayed.
     */
    update(dt, ctx) {
      const w = this.weapon;
      const gw = BY_ID.grenade;
      if (this.switchT > 0) this.switchT = Math.max(0, this.switchT - dt);
      this.gcd = Math.max(0, this.gcd - dt);

      // grenade stock refills slowly: no spamming
      if (this.grenades < gw.maxCount) {
        this.gregen -= dt;
        if (this.gregen <= 0) {
          this.grenades++;
          this.gregen = this.regenTime();
          RV.audio.play('swap');
        }
      } else this.gregen = this.regenTime();

      if (ctx.reloadPressed) this.startReload();
      if (this.reloading) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          this.reloading = false;
          const take = Math.min(w.mag - this.ammo, this.reserve);
          this.ammo += take;
          if (this.g.mode !== 'practice') this.reserve -= take;
          RV.audio.play('reloadDone', w.id);
        }
      }
      this.fireBuf = ctx.firePressed ? 0.12 : Math.max(0, this.fireBuf - dt);
      this.cd -= dt;

      if (w.kind === 'gun') {
        const wants = w.auto ? ctx.fireHeld || this.fireBuf > 0 : this.fireBuf > 0;
        const can = wants && ctx.canFire && !this.reloading && this.switchT <= 0;
        let guard = 0;
        while (can && this.cd <= 0 && guard++ < 4) {
          if (this.ammo <= 0) {
            RV.audio.play('empty');
            this.startReload();
            this.fireBuf = 0;
            this.cd = Math.max(this.cd, 0.3); // (no clicking every frame while out of ammunition)
            break;
          }
          this._shoot(ctx);
          this.ammo--;
          this.cd += w.interval;
          this.fireBuf = 0;
          if (!w.auto) break;
        }
        if (this.cd < 0 && !can) this.cd = 0;
        if (this.ammo <= 0 && !this.reloading && ctx.canFire) this.startReload();
      } else if (w.kind === 'melee') {
        const wants = ctx.fireHeld || this.fireBuf > 0;
        if (wants && ctx.canFire && this.switchT <= 0 && this.cd <= 0) {
          this._punch(ctx);
          this.cd = w.interval;
          this.fireBuf = 0;
        } else if (this.cd < 0) this.cd = 0;
      } else if (w.kind === 'grenade') {
        if (this.fireBuf > 0 && ctx.canFire && this._startThrow(false)) this.fireBuf = 0;
        if (this.cd < 0) this.cd = 0;
      }

      // throw sequence: pin -> hold (aiming, path preview, then the circle comes for you) -> wind-up ->
      // release (spawns the projectile exactly once) -> recover. R (or switching weapon) cancels a held grenade.
      this.holding = false;
      if (this.throwT >= 0) {
        const T = RV.vmanim.THROW;
        const holdAt = T.total * T.hold;
        if (!this.thrown && w.kind === 'grenade' && (ctx.reloadPressed || ctx.cancel || this.g.playerDead)) {
          this.cancelHeld();
        } else {
          if (!this.thrown && this.throwT >= holdAt - 1e-6 && ctx.fireHeld && ctx.canFire) {
            this.throwT = holdAt;
            this.holding = true; // held: nothing advances until the button is let go
            this.holdT += dt;
            if (this.holdT >= BY_ID.grenade.hold.total) {
              this._selfDetonate();
              return;
            }
          } else this.throwT += dt;
          if (!this.thrown && this.throwT >= T.total * T.release) this._release(ctx);
          if (this.throwT >= T.total) this.cancelThrow();
        }
      }
    }

    /**
     * Fire on the mouse-down event itself (no waiting for the next frame).
     * Returns true if the press was used.
     */
    tryShotNow(ctx) {
      const w = this.weapon;
      if (ctx.canFire === false || this.reloading || this.switchT > 0) return false;
      if (w.kind === 'grenade') return this._startThrow(true);
      if (this.cd > 0) return false;
      if (w.kind === 'melee') {
        this._punch(ctx);
        this.cd = w.interval;
        this.fireBuf = 0;
        return true;
      }
      if (this.ammo <= 0) return false;
      this._shoot(ctx);
      this.ammo--;
      this.cd = w.interval;
      this.fireBuf = 0;
      return true;
    }

    // ---------------------------------------------------------------- grenade
    _startThrow(feedback) {
      if (this.throwT >= 0 || this.switchT > 0 || this.gcd > 0) return false;
      if (this.grenades <= 0) {
        if (feedback) {
          RV.audio.play('empty');
          RV.hud.toast('Grenade ready in ' + Math.ceil(this.gregen) + ' s');
        }
        return false;
      }
      this.throwT = 0;
      this.thrown = false;
      RV.audio.play('pin');
      if (this.g.mode === 'online') RV.online.sendNadePin();
      return true;
    }

    /** The circle reached you: the grenade goes off at your feet (boost, 75 to enemies, nothing to you). */
    _selfDetonate() {
      this.g.protUntil = 0; // attacking ends spawn protection
      const gw = BY_ID.grenade;
      const T = RV.vmanim.THROW;
      this.thrown = true;
      this.holding = false;
      this.grenades--;
      this.gcd = gw.interval;
      if (this.grenades < gw.maxCount && this.gregen > this.regenTime()) this.gregen = this.regenTime();
      this.g.session.grenades = (this.g.session.grenades || 0) + 1;
      this.throwT = T.total * T.release; // the hand follows through and recovers
      if (this.g.mode === 'online') RV.online.sendNadeSelf(); // the server decides when / where it goes off
      else RV.grenades.detonateAtPlayer(this.g, gw);
    }

    _release(ctx) {
      this.g.protUntil = 0; // attacking ends spawn protection
      const gw = BY_ID.grenade;
      this.thrown = true;
      this.grenades--;
      this.gcd = gw.interval;
      if (this.grenades < gw.maxCount && this.gregen > this.regenTime()) this.gregen = this.regenTime();
      this.g.session.grenades = (this.g.session.grenades || 0) + 1;
      RV.audio.play('throw');
      if (this.g.mode === 'online') RV.online.sendNade(ctx.fwd); // the grenade appears when the server spawns it
      else RV.grenades.throwFrom(this.g, ctx.eye, ctx.fwd, ctx.vel, gw);
    }

    // ---------------------------------------------------------------- fists
    _punch(ctx) {
      this.g.protUntil = 0; // attacking ends spawn protection
      const g = this.g;
      const w = this.weapon;
      const o = ctx.eye,
        d = ctx.fwd;
      this.shots++;
      g.session.shots++;
      const wh = g.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range, this._rh);
      const tWorld = wh ? this._rh.t : w.range;
      // a fat ray: enlarged hitboxes, so a punch lands when the target is plainly in front of you
      let tBot = Infinity,
        hitBot = null;
      const pad = w.reach;
      const bots = g.bots;
      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (!bot.alive) continue;
        const bb = bot.body;
        const t = RV.rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, bb.x - bb.hw - pad, bb.y - 0.15, bb.z - bb.hw - pad, bb.x + bb.hw + pad, bb.y + bb.h + 0.1, bb.z + bb.hw + pad, tWorld);
        if (t >= 0 && t < tBot) {
          tBot = t;
          hitBot = bot;
        }
      }
      let landed = false;
      if (g.mode === 'online') RV.online.sendPunch(w, o, d);
      if (hitBot && hitBot.net) {
        // remote opponent: predicted feedback only, the damage comes back as a confirmation
        landed = true;
        const bb = hitBot.body;
        RV.audio.play('punchHit');
        RV.fx.impact(bb.x - d.x * 0.3, o.y + d.y * tBot, bb.z - d.z * 0.3, -d.x, 0.3, -d.z, 'flesh');
        RV.fx.punch(o.x + d.x * Math.min(tBot, w.range - 0.4), o.y + d.y * Math.min(tBot, w.range - 0.4), o.z + d.z * Math.min(tBot, w.range - 0.4));
      } else if (hitBot && hitBot.isProtected(g)) {
        landed = true; // the punch connects but the spawn protection absorbs it
        RV.audio.play('punchHit');
        RV.hud.toast('Spawn protected', 500);
      } else if (hitBot) {
        landed = true;
        this.hits++;
        g.session.hits++;
        const killed = hitBot.damage(w.dmg, g, w);
        RV.hud.hitMarker(killed);
        RV.hud.damageNumber(w.dmg, false, killed);
        RV.audio.play(killed ? 'kill' : 'hit');
        RV.audio.play('punchHit');
        const bb = hitBot.body;
        RV.fx.impact(bb.x - d.x * 0.3, o.y + d.y * tBot, bb.z - d.z * 0.3, -d.x, 0.3, -d.z, 'flesh');
        RV.fx.punch(o.x + d.x * Math.min(tBot, w.range - 0.4), o.y + d.y * Math.min(tBot, w.range - 0.4), o.z + d.z * Math.min(tBot, w.range - 0.4));
      } else {
        RV.audio.play('swing');
      }
      RV.viewmodel.onFire(w.id);
      RV.viewmodel.onPunch(landed);
    }

    // ---------------------------------------------------------------- guns
    /** Resolve one shot completely, right now. */
    _shoot(ctx) {
      this.g.protUntil = 0; // attacking ends spawn protection
      const g = this.g;
      const w = this.weapon;
      const o = ctx.eye,
        d = ctx.fwd;
      this.shots++;
      g.session.shots++;

      // 1. what does the ray hit in the world?
      const wh = g.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range, this._rh);
      const tWorld = wh ? this._rh.t : w.range;

      // 2. any opponent closer than that? (current hitboxes, this instant)
      let tBot = Infinity,
        hitBot = null;
      const bots = g.bots;
      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (!bot.alive) continue;
        const bb = bot.body;
        const t = RV.rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, bb.x - bb.hw, bb.y, bb.z - bb.hw, bb.x + bb.hw, bb.y + bb.h, bb.z + bb.hw, tWorld);
        if (t >= 0 && t < tBot) {
          tBot = t;
          hitBot = bot;
        }
      }

      // 3. apply the result immediately
      // (online: the shot is sent to the opponent, whose client decides the hit with lag compensation and
      //  sends the confirmation back; locally we only show the impact)
      if (g.mode === 'online') RV.online.sendShot(w, o, d);
      let endT = tWorld;
      if (hitBot && hitBot.net) {
        endT = tBot;
        RV.fx.impact(o.x + d.x * endT, o.y + d.y * endT, o.z + d.z * endT, -d.x, -d.y, -d.z, 'flesh');
      } else if (hitBot && hitBot.isProtected(g)) {
        endT = tBot; // absorbed by spawn protection: no damage, no hit marker
        RV.fx.impact(o.x + d.x * endT, o.y + d.y * endT, o.z + d.z * endT, -d.x, -d.y, -d.z, 'wall');
        RV.hud.toast('Spawn protected', 500);
      } else if (hitBot) {
        endT = tBot;
        this.hits++;
        g.session.hits++;
        // head: the top of the body box (the character's head sits there)
        const bbx = hitBot.body;
        const head = o.y + d.y * tBot >= bbx.y + 1.5;
        const dmg = Math.round(damageAt(w, tBot) * (head ? w.headMul || 1 : 1));
        const killed = hitBot.damage(dmg, g, w);
        RV.hud.hitMarker(killed);
        RV.hud.damageNumber(dmg, head, killed);
        RV.audio.play(killed ? 'kill' : head ? 'headshot' : 'hit');
        RV.fx.impact(o.x + d.x * endT, o.y + d.y * endT, o.z + d.z * endT, -d.x, -d.y, -d.z, 'flesh');
      } else if (wh) {
        const rh = this._rh;
        RV.fx.impact(o.x + d.x * endT, o.y + d.y * endT, o.z + d.z * endT, rh.nx, rh.ny, rh.nz, 'wall');
      }

      // 4. purely cosmetic feedback
      RV.audio.play('shot', w.id);
      RV.viewmodel.onFire(w.id);
      if (w.tracer != null) {
        const R = RV.render;
        const mo = RV.viewmodel.tracerOffset(this.ads);
        const m = this._muzzle.set(mo[0], mo[1], mo[2]).applyMatrix4(R.camera.matrixWorld);
        const far = Math.min(endT, 180);
        R.addTracer(m.x, m.y, m.z, o.x + d.x * far, o.y + d.y * far, o.z + d.z * far, w.tracer, w.tw);
      }
    }
  }

  RV.Loadout = Loadout;
})();
