/* DASHDUEL - thrown grenades.
 *
 * The grenade is the only projectile in the game: it has travel time, falls under
 * gravity, bounces off walls and floors, and explodes when its fuse runs out.
 * Guns and fists never use this: they stay instant.
 *
 *  - Hold the fire button to pull the pin and aim: a dotted path and a landing circle
 *    show where the first bounce will happen. Release to throw (right mouse cancels).
 *  - The blast deals a flat 75 to enemies it can see (walls / cover block or reduce it,
 *    three points per body are checked) and never damages you.
 *  - Standing near a blast shoves you away from it (a "grenade boost"), so a grenade
 *    at your feet launches you upward.
 * Visuals are pooled: a handful of small meshes, no per-throw allocation.
 */
(function () {
  'use strict';
  const RV = window.RV;

  const S = RV.grensim; // shared physics (also used by the game server)
  const GRAV = S.GRAV;
  const RADIUS = S.RADIUS;
  const POOL = 4;
  const PN = 96; // preview points

  const GR = (RV.grenades = { list: [], ready: false, _rh: { t: 0, nx: 0, ny: 1, nz: 0, solid: null }, _L: {}, imp: { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 } });

  GR.build = function (R) {
    GR.R = R;
    const body = new THREE.MeshLambertMaterial({ color: 0x3d4a3f });
    const dark = new THREE.MeshLambertMaterial({ color: 0x20262b });
    const steel = new THREE.MeshLambertMaterial({ color: 0xaab2bd });
    const cyl = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg || 10);
    const gBody = cyl(0.062, 0.1, 10);
    const gBand = cyl(0.0645, 0.016, 10);
    const gCap = cyl(0.03, 0.03, 8);
    const gSpoon = new THREE.BoxGeometry(0.014, 0.075, 0.03);
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(gBody, body);
      g.add(m);
      const bandMat = new THREE.MeshBasicMaterial({ color: 0x3fd8c0, fog: false });
      const band = new THREE.Mesh(gBand, bandMat);
      band.position.y = 0.012;
      g.add(band);
      const cap = new THREE.Mesh(gCap, dark);
      cap.position.y = 0.065;
      g.add(cap);
      const spoon = new THREE.Mesh(gSpoon, steel);
      spoon.position.set(0.05, 0.015, 0);
      g.add(spoon);
      g.scale.setScalar(1.5); // a little oversized so it reads at range
      g.visible = false;
      R.scene.add(g);
      GR.list.push({ on: false, mesh: g, bandMat, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, fuse: 2, rest: false, spin: 0, ax: 0, az: 0, tick: 0, bounceSfx: 0 });
    }

    // ---- aiming preview: ONE thin line (the path) and a sphere where it goes off (the size of the blast, with a small solid core at the point of impact)
    GR.pts = new Float32Array(PN * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(GR.pts, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    GR.pgeo = geo;
    GR.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    GR.line.frustumCulled = false;
    const sphereMat = (op, back) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, side: back ? THREE.BackSide : THREE.FrontSide, depthWrite: false });
    // the whole preview is white, always (line, sphere and core); only the ticking warns that it is closing in
    // the blast: a translucent sphere of the blast radius (drawn from inside as well, so standing in it tints the view), and a small solid core
    GR.ring = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), sphereMat(0.1, false));
    GR.ringBack = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), sphereMat(0.08, true));
    GR.ringDot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), sphereMat(0.95, false));
    GR.dots = GR.ringBlast = GR.ringBack; // (old names, kept so nothing that still reads them breaks)
    for (const o of [GR.line, GR.ring, GR.ringBack, GR.ringDot]) {
      o.visible = false;
      R.scene.add(o);
    }
    GR._z = new THREE.Vector3(0, 0, 1);
    GR._n = new THREE.Vector3();
    GR.ready = true;
  };

  GR.clear = function () {
    for (const gr of GR.list) {
      gr.on = false;
      gr.mesh.visible = false;
    }
    GR.preview(null, null);
  };

  /** Number of grenades currently in the air (HUD / tests). */
  GR.active = function () {
    let n = 0;
    for (const gr of GR.list) if (gr.on) n++;
    return n;
  };

  /**
   * Start position (the throwing hand, never inside a wall) and velocity (the view direction
   * tilted up by the arc, plus a share of the thrower's own movement). Fills and returns `o`.
   */
  GR._launch = function (g, eye, fwd, vel, gw, o) {
    return S.launch(g.world, eye, fwd, vel, gw, o, GR._rh);
  };

  GR.throwFrom = function (g, eye, fwd, vel, gw) {
    if (!GR.ready) return null;
    let gr = null;
    for (const c of GR.list) if (!c.on) {
      gr = c;
      break;
    }
    if (!gr) gr = GR.list.reduce((m, c) => (c.t > m.t ? c : m), GR.list[0]); // recycle the oldest
    const L = GR._launch(g, eye, fwd, vel, gw, GR._L);
    gr.on = true;
    gr.x = L.sx;
    gr.y = L.sy;
    gr.z = L.sz;
    gr.vx = L.vx;
    gr.vy = L.vy;
    gr.vz = L.vz;
    gr.t = 0;
    gr.fuse = gw.fuse;
    gr.rest = false;
    gr.tick = 0;
    gr.bounceSfx = 0;
    gr.ax = Math.random() * 6.28;
    gr.az = Math.random() * 6.28;
    gr.spin = 7 + Math.random() * 4;
    gr.gw = gw;
    gr.owner = 'self';
    gr.mesh.visible = true;
    gr.mesh.position.set(gr.x, gr.y, gr.z);
    return gr;
  };

  /**
   * Online: grenades are simulated by the server. When it announces one we show the same flight here (so it
   * looks smooth); it explodes when the server says `boom`, never on a local timer.
   */
  GR.spawnServer = function (g, p, v, own) {
    if (!GR.ready || !Array.isArray(p) || !Array.isArray(v)) return null;
    let gr = null;
    for (const c of GR.list) if (!c.on) {
      gr = c;
      break;
    }
    if (!gr) gr = GR.list.reduce((m, c) => (c.t > m.t ? c : m), GR.list[0]);
    const gw = RV.WEAPON_BY_ID.grenade;
    gr.on = true;
    gr.x = p[0];
    gr.y = p[1];
    gr.z = p[2];
    gr.vx = v[0];
    gr.vy = v[1];
    gr.vz = v[2];
    gr.t = 0;
    gr.fuse = gw.fuse;
    gr.rest = false;
    gr.tick = 0;
    gr.bounceSfx = 0;
    gr.ax = Math.random() * 6.28;
    gr.az = Math.random() * 6.28;
    gr.spin = 7 + Math.random() * 4;
    gr.gw = gw;
    gr.owner = own ? 'self' : 'remote';
    gr.server = true;
    gr.mesh.visible = true;
    gr.mesh.position.set(gr.x, gr.y, gr.z);
    return gr;
  };

  /** The server says a grenade exploded at p: remove its mirror, play the blast, apply the boost if I am close. */
  GR.serverBlast = function (g, p, own) {
    if (!GR.ready || !Array.isArray(p)) return;
    const owner = own ? 'self' : 'remote';
    let best = null,
      bd = 1e9;
    for (const gr of GR.list) {
      if (!gr.on || gr.owner !== owner) continue;
      const d = Math.hypot(gr.x - p[0], gr.y - p[1], gr.z - p[2]);
      if (d < bd) {
        bd = d;
        best = gr;
      }
    }
    if (best) {
      best.on = false;
      best.mesh.visible = false;
    }
    GR._blastFx(g, p[0], p[1], p[2], RV.WEAPON_BY_ID.grenade);
  };

  // ---------------------------------------------------------------------------
  // aiming preview
  // ---------------------------------------------------------------------------
  /** Simulate the flight up to the first impact. Writes GR.pts, returns the point count. */
  GR.predict = function (g, L) {
    const rh = GR._rh;
    const imp = GR.imp;
    imp.hit = false;
    let x = L.sx,
      y = L.sy,
      z = L.sz,
      vx = L.vx,
      vy = L.vy,
      vz = L.vz;
    let n = 0;
    const P = GR.pts;
    P[0] = x;
    P[1] = y;
    P[2] = z;
    n = 1;
    const h = 1 / 50;
    while (n < PN) {
      vy -= GRAV * h;
      const sp = Math.hypot(vx, vy, vz);
      const len = sp * h;
      const dx = vx / sp,
        dy = vy / sp,
        dz = vz / sp;
      if (g.world.raycast(x, y, z, dx, dy, dz, len + RADIUS, rh)) {
        imp.hit = true;
        imp.x = x + dx * rh.t;
        imp.y = y + dy * rh.t;
        imp.z = z + dz * rh.t;
        imp.nx = rh.nx;
        imp.ny = rh.ny;
        imp.nz = rh.nz;
        P[n * 3] = imp.x;
        P[n * 3 + 1] = imp.y;
        P[n * 3 + 2] = imp.z;
        n++;
        break;
      }
      x += vx * h;
      y += vy * h;
      z += vz * h;
      P[n * 3] = x;
      P[n * 3 + 1] = y;
      P[n * 3 + 2] = z;
      n++;
      if (y < g.map.killY) break;
    }
    return n;
  };

  /**
   * Show the path + landing circle for a held grenade (ctx = {eye, fwd, vel, holdT}), or hide them (ctx null).
   * For the first `hold.still` seconds the circle sits where the grenade would land. After that the circle
   * slides from there to YOU (slowly at first, then faster) and arrives exactly at `hold.total`.
   */
  GR.preview = function (g, ctx) {
    if (!GR.ready) return;
    const show = !!ctx;
    if (!show) {
      GR._start = null;
      GR._tickT = 0;
      if (GR.line.visible || GR.ring.visible) for (const o of [GR.line, GR.ring, GR.ringBack, GR.ringDot]) o.visible = false;
      return;
    }
    const gw = RV.WEAPON_BY_ID.grenade;
    const hold = gw.hold;
    const t = ctx.holdT || 0;
    const L = GR._launch(g, ctx.eye, ctx.fwd, ctx.vel, gw, GR._L);
    if (t >= hold.still) {
      // ---- the circle comes for you
      if (!GR._start) {
        // freeze the landing spot the moment the countdown starts
        GR.predict(g, L);
        const im = GR.imp;
        if (im.hit) GR._start = { x: im.x, y: im.y, z: im.z };
        else {
          const f = ctx.fwd;
          const fl = Math.hypot(f.x, f.z) || 1;
          const px = ctx.eye.x + (f.x / fl) * 12,
            pz = ctx.eye.z + (f.z / fl) * 12;
          const fy = g.world.floorBelow(px, ctx.eye.y, pz, 0.3);
          GR._start = { x: px, y: isFinite(fy) ? fy : g.player.b.y, z: pz };
        }
        GR._tickT = 0;
      }
      const tau = RV.clamp((t - hold.still) / (hold.total - hold.still), 0, 1);
      const e = tau * tau; // slow at first, then faster
      const pb = g.player.b;
      const x = GR._start.x + (pb.x - GR._start.x) * e;
      const z = GR._start.z + (pb.z - GR._start.z) * e;
      let y = g.world.floorBelow(x, Math.max(GR._start.y, pb.y) + 2.5, z, 0.3);
      if (!isFinite(y)) y = GR._start.y + (pb.y - GR._start.y) * e;
      GR.line.visible = false;
      GR.ring.visible = GR.ringBack.visible = GR.ringDot.visible = true;
      for (const o of [GR.ring, GR.ringBack, GR.ringDot]) o.position.set(x, y + 0.1, z);
      GR.ring.scale.setScalar(gw.radius);
      GR.ringBack.scale.setScalar(gw.radius);
      // a ticking that speeds up as it closes in (the colour stays white)
      GR._tickT -= ctx.dt || 0.016;
      if (GR._tickT <= 0) {
        GR._tickT = 0.45 - 0.37 * e;
        RV.audio.play('warn', e);
      }
      return;
    }
    GR._start = null;
    const n = GR.predict(g, L);
    GR.pgeo.setDrawRange(0, n);
    GR.pgeo.attributes.position.needsUpdate = true;
    GR.line.visible = true;
    const imp = GR.imp;
    const on = imp.hit;
    GR.ring.visible = GR.ringBack.visible = GR.ringDot.visible = on;
    if (on) {
      // the sphere sits a little above the impact point (the blast is centred a bit above the floor, see server explode(): y + 0.12)
      for (const o of [GR.ring, GR.ringBack, GR.ringDot]) o.position.set(imp.x + imp.nx * 0.1, imp.y + imp.ny * 0.1 + 0.12, imp.z + imp.nz * 0.1);
      GR.ring.scale.setScalar(gw.radius);
      GR.ringBack.scale.setScalar(gw.radius);
    }
  };

  // ---------------------------------------------------------------------------
  // flight
  // ---------------------------------------------------------------------------
  GR.update = function (dt, g) {
    if (!GR.ready) return;
    for (const gr of GR.list) {
      if (!gr.on) continue;
      gr.t += dt;
      gr.bounceSfx -= dt;
      // fixed sub-steps so a fast grenade can never tunnel through a thin wall
      let left = dt;
      while (left > 1e-6 && !gr.rest) {
        const h = Math.min(left, 1 / 90);
        left -= h;
        GR._step(gr, h, g);
      }
      if (gr.y < g.map.killY) {
        gr.on = false;
        gr.mesh.visible = false;
        continue;
      }
      // visuals
      const m = gr.mesh;
      m.position.set(gr.x, gr.y + 0.05, gr.z);
      if (!gr.rest) {
        gr.ax += gr.spin * dt;
        gr.az += gr.spin * 0.6 * dt;
        m.rotation.set(gr.ax, 0, gr.az);
      }
      // the band blinks faster as the fuse runs down
      const rem = gr.fuse - gr.t;
      const rate = rem < 0.7 ? 16 : rem < 1.4 ? 8 : 4;
      const on = Math.sin(gr.t * rate * 3.14159) > 0;
      gr.bandMat.color.setHex(on ? (rem < 0.7 ? 0xff5a4a : 0x3fd8c0) : 0x15302b);
      if (rem < 0.9) {
        gr.tick -= dt;
        if (gr.tick <= 0) {
          gr.tick = 0.18;
          const d = Math.hypot(gr.x - g.eye.x, gr.y - g.eye.y, gr.z - g.eye.z);
          if (d < 22) RV.audio.play('tick', 1 - d / 22);
        }
      }
      if (gr.server) {
        if (gr.t > gr.fuse + 4) {
          gr.on = false;
          gr.mesh.visible = false;
        }
      } else if (gr.t >= gr.fuse) GR._explode(g, gr);
    }
  };

  GR._step = function (gr, h, g) {
    const v = S.step(gr, h, g.world, GR._rh);
    if (v > 2.5 && gr.bounceSfx <= 0) {
      gr.bounceSfx = 0.12;
      const d = Math.hypot(gr.x - g.eye.x, gr.y - g.eye.y, gr.z - g.eye.z);
      RV.audio.play('bounce', Math.max(0.1, 1 - d / 30));
    }
  };

  // ---------------------------------------------------------------------------
  // explosion
  // ---------------------------------------------------------------------------
  /**
   * Damage a blast at (ex,ey,ez) does to a body standing at (tx,ty,tz) with height th:
   * gw.dmg scaled by how much of the body the blast can see (0, 1/3, 2/3 or all of it).
   */
  GR.damageAt = function (g, gw, ex, ey, ez, tx, ty, tz, th) {
    return S.damageAt(g.world, gw, ex, ey, ez, tx, ty, tz, th);
  };

  /** Shove the player away from a blast (no damage): a grenade at your feet launches you. */
  GR.boost = function (g, gw, ex, ey, ez) {
    if (!S.boost(g.world, g.player, gw, ex, ey, ez)) return false; // the push itself is shared with the server (grensim.js)
    RV.audio.play('boost');
    RV.viewmodel.onJump();
    g.session.boosts = (g.session.boosts || 0) + 1;
    return true;
  };

  /** The homing circle touched the player: blow up at the player's feet. */
  GR.detonateAtPlayer = function (g, gw) {
    const b = g.player.b;
    GR._explode(g, { x: b.x, y: b.y, z: b.z, gw, owner: 'self', on: true, mesh: { visible: false } });
  };

  /** The blast itself, for everyone: flash, sound, and the push on ME if I am near (never damage here). */
  GR._blastFx = function (g, ex, ey, ez, gw) {
    RV.fx.explosion(ex, ey, ez, gw.radius);
    const eyeD = Math.hypot(ex - g.eye.x, ey - g.eye.y, ez - g.eye.z);
    RV.audio.play('explosion', Math.max(0.3, 1 - eyeD / 60));
    g.session.blasts = (g.session.blasts || 0) + 1;
    if (!g.playerDead) {
      GR.boost(g, gw, ex, ey, ez);
      if (eyeD < 3 && g.world.lineClear(ex, ey, ez, g.eye.x, g.eye.y, g.eye.z)) RV.hud.blast(0.3 * (1 - eyeD / 3));
    }
  };

  /** Offline modes: the local grenade went off. Damage goes to bots (and never to you). */
  GR._explode = function (g, gr) {
    gr.on = false;
    gr.mesh.visible = false;
    const gw = gr.gw || RV.WEAPON_BY_ID.grenade;
    const ex = gr.x,
      ey = gr.y + 0.12,
      ez = gr.z;
    GR._blastFx(g, ex, ey, ez, gw);
    for (const bot of g.bots) {
      if (!bot.alive || bot.net) continue;
      const b = bot.body;
      const d = Math.round(GR.damageAt(g, gw, ex, ey, ez, b.x, b.y, b.z, b.h));
      if (d < 1) continue;
      g.weapons.hits++;
      g.session.hits++;
      const killed = bot.damage(d, g, gw);
      RV.hud.hitMarker(killed);
      RV.hud.damageNumber(d, false, killed);
      RV.audio.play(killed ? 'kill' : 'hit');
    }
  };
})();
