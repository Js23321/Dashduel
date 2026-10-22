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

  const GRAV = 24;
  const RADIUS = 0.07; // collision radius of the projectile
  const RESTITUTION = 0.42;
  const FRICTION = 0.8;
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

    // ---- aiming preview: dotted path + landing circle (+ a faint ring at the blast radius)
    GR.pts = new Float32Array(PN * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(GR.pts, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    GR.pgeo = geo;
    GR.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
    GR.dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false }));
    GR.line.frustumCulled = GR.dots.frustumCulled = false;
    const ringMat = (op) => new THREE.MeshBasicMaterial({ color: 0x3fd8c0, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    GR.ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.52, 40), ringMat(0.95));
    GR.ringBlast = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 72), ringMat(0.3)); // scaled to the blast radius when shown
    GR.ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), ringMat(0.95));
    for (const o of [GR.line, GR.dots, GR.ring, GR.ringBlast, GR.ringDot]) {
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
    let dx = fwd.x,
      dy = fwd.y + gw.arc,
      dz = fwd.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const rl = Math.hypot(fwd.x, fwd.z) || 1;
    const rx = -fwd.z / rl,
      rz = fwd.x / rl;
    let sx = eye.x + fwd.x * 0.5 + rx * 0.16,
      sy = eye.y + fwd.y * 0.5 - 0.16,
      sz = eye.z + fwd.z * 0.5 + rz * 0.16;
    const ox = sx - eye.x,
      oy = sy - eye.y,
      oz = sz - eye.z;
    const od = Math.hypot(ox, oy, oz);
    const rh = GR._rh;
    if (g.world.raycast(eye.x, eye.y, eye.z, ox / od, oy / od, oz / od, od + RADIUS, rh)) {
      const t = Math.max(0, rh.t - RADIUS * 1.5);
      sx = eye.x + (ox / od) * t;
      sy = eye.y + (oy / od) * t;
      sz = eye.z + (oz / od) * t;
    }
    const vx = vel ? vel.vx || 0 : 0,
      vy = vel ? vel.vy || 0 : 0,
      vz = vel ? vel.vz || 0 : 0;
    o.sx = sx;
    o.sy = sy;
    o.sz = sz;
    o.vx = dx * gw.speed + vx * 0.5;
    o.vy = dy * gw.speed + Math.max(0, vy) * 0.3;
    o.vz = dz * gw.speed + vz * 0.5;
    return o;
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
    if (g.mode === 'online') RV.online.sendNade(gr.x, gr.y, gr.z, gr.vx, gr.vy, gr.vz);
    return gr;
  };

  /** A grenade thrown by the opponent (online): the same flight, mirrored here. Its blast hurts only me. */
  GR.spawnRemote = function (g, x, y, z, vx, vy, vz, gw) {
    if (!GR.ready) return null;
    let gr = null;
    for (const c of GR.list) if (!c.on) {
      gr = c;
      break;
    }
    if (!gr) gr = GR.list.reduce((m, c) => (c.t > m.t ? c : m), GR.list[0]);
    gr.on = true;
    gr.x = x;
    gr.y = y;
    gr.z = z;
    gr.vx = vx;
    gr.vy = vy;
    gr.vz = vz;
    gr.t = 0;
    gr.fuse = gw.fuse;
    gr.rest = false;
    gr.tick = 0;
    gr.bounceSfx = 0;
    gr.ax = Math.random() * 6.28;
    gr.az = Math.random() * 6.28;
    gr.spin = 7 + Math.random() * 4;
    gr.gw = gw;
    gr.owner = 'remote';
    gr.mesh.visible = true;
    gr.mesh.position.set(x, y, z);
    return gr;
  };

  /** The opponent's grenade went off on them (3 s hold): the blast happens here too. */
  GR.remoteBlast = function (g, x, y, z) {
    GR._explode(g, { x, y, z, gw: RV.WEAPON_BY_ID.grenade, owner: 'remote', on: true, mesh: { visible: false } });
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
      if (GR.line.visible || GR.ring.visible) for (const o of [GR.line, GR.dots, GR.ring, GR.ringBlast, GR.ringDot]) o.visible = false;
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
      GR.line.visible = GR.dots.visible = false;
      GR.ring.visible = GR.ringBlast.visible = GR.ringDot.visible = true;
      GR._n.set(0, 1, 0);
      for (const o of [GR.ring, GR.ringBlast, GR.ringDot]) {
        o.position.set(x, y + 0.03, z);
        o.quaternion.setFromUnitVectors(GR._z, GR._n);
      }
      GR.ringBlast.scale.setScalar(gw.radius);
      // teal -> red as it closes in, and a ticking that speeds up
      GR.ring.material.color.setRGB(0.25 + 0.75 * e, 0.85 - 0.55 * e, 0.75 - 0.5 * e);
      GR.ringDot.material.color.copy(GR.ring.material.color);
      GR._tickT -= ctx.dt || 0.016;
      if (GR._tickT <= 0) {
        GR._tickT = 0.45 - 0.37 * e;
        RV.audio.play('warn', e);
      }
      return;
    }
    GR._start = null;
    GR.ring.material.color.setRGB(0.25, 0.85, 0.75);
    GR.ringDot.material.color.copy(GR.ring.material.color);
    const n = GR.predict(g, L);
    GR.pgeo.setDrawRange(0, n);
    GR.pgeo.attributes.position.needsUpdate = true;
    GR.line.visible = GR.dots.visible = true;
    const imp = GR.imp;
    const on = imp.hit;
    GR.ring.visible = GR.ringBlast.visible = GR.ringDot.visible = on;
    if (on) {
      const nrm = GR._n.set(imp.nx, imp.ny, imp.nz);
      const px = imp.x + imp.nx * 0.03,
        py = imp.y + imp.ny * 0.03,
        pz = imp.z + imp.nz * 0.03;
      for (const o of [GR.ring, GR.ringBlast, GR.ringDot]) {
        o.position.set(px, py, pz);
        o.quaternion.setFromUnitVectors(GR._z, nrm);
      }
      GR.ringBlast.scale.setScalar(gw.radius);
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
      if (gr.t >= gr.fuse) GR._explode(g, gr);
    }
  };

  GR._step = function (gr, h, g) {
    const rh = GR._rh;
    if (!gr.rest) gr.vy -= GRAV * h;
    const sp = Math.hypot(gr.vx, gr.vy, gr.vz);
    const len = sp * h;
    if (len < 1e-7) return;
    const dx = gr.vx / sp,
      dy = gr.vy / sp,
      dz = gr.vz / sp;
    if (g.world.raycast(gr.x, gr.y, gr.z, dx, dy, dz, len + RADIUS, rh)) {
      const move = Math.max(0, rh.t - RADIUS);
      gr.x += dx * move;
      gr.y += dy * move;
      gr.z += dz * move;
      const vn = gr.vx * rh.nx + gr.vy * rh.ny + gr.vz * rh.nz;
      if (vn < 0) {
        // reflect with energy loss, damp the sliding part
        gr.vx -= (1 + RESTITUTION) * vn * rh.nx;
        gr.vy -= (1 + RESTITUTION) * vn * rh.ny;
        gr.vz -= (1 + RESTITUTION) * vn * rh.nz;
        const vn2 = gr.vx * rh.nx + gr.vy * rh.ny + gr.vz * rh.nz;
        const tx = gr.vx - vn2 * rh.nx,
          ty = gr.vy - vn2 * rh.ny,
          tz = gr.vz - vn2 * rh.nz;
        gr.vx = vn2 * rh.nx + tx * FRICTION;
        gr.vy = vn2 * rh.ny + ty * FRICTION;
        gr.vz = vn2 * rh.nz + tz * FRICTION;
        if (-vn > 2.5 && gr.bounceSfx <= 0) {
          gr.bounceSfx = 0.12;
          const d = Math.hypot(gr.x - g.eye.x, gr.y - g.eye.y, gr.z - g.eye.z);
          RV.audio.play('bounce', Math.max(0.1, 1 - d / 30));
        }
        // settle on floors once the bounce is small
        if (rh.ny > 0.7 && Math.hypot(gr.vx, gr.vy, gr.vz) < 1.6) {
          gr.vx = gr.vy = gr.vz = 0;
          gr.rest = true;
        }
      }
      gr.x += rh.nx * 0.002;
      gr.y += rh.ny * 0.002;
      gr.z += rh.nz * 0.002;
    } else {
      gr.x += gr.vx * h;
      gr.y += gr.vy * h;
      gr.z += gr.vz * h;
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
    const cy = ty + th * 0.5;
    const dist = Math.hypot(tx - ex, cy - ey, tz - ez);
    if (dist >= gw.radius + 0.6) return 0;
    const ys = [ty + 0.25, cy, ty + th - 0.2];
    let seen = 0;
    for (const sy of ys) if (g.world.lineClear(ex, ey, ez, tx, sy, tz)) seen++;
    if (seen === 0) return 0;
    const f = RV.clamp(dist / gw.radius, 0, 1);
    const fall = 1 - f * (1 - gw.minDmgFrac);
    return gw.dmg * fall * (seen / 3);
  };

  /** Shove the player away from a blast (no damage): a grenade at your feet launches you. */
  GR.boost = function (g, gw, ex, ey, ez) {
    const pl = g.player;
    const b = pl.b;
    const cx = b.x,
      cy = b.y + b.h * 0.5,
      cz = b.z;
    let dx = cx - ex,
      dy = cy - ey,
      dz = cz - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > gw.boostRadius) return false;
    if (!g.world.lineClear(ex, ey, ez, cx, cy, cz) && !g.world.lineClear(ex, ey, ez, cx, b.y + 0.2, cz)) return false;
    const k = 1 - dist / gw.boostRadius;
    const power = gw.boostPower * (0.4 + 0.6 * k);
    const l = dist || 1;
    dx /= l;
    dy = dy / l + gw.boostUp;
    dz /= l;
    const nl = Math.hypot(dx, dy, dz) || 1;
    if (b.vy < 0) b.vy = 0;
    b.vx += (dx / nl) * power;
    b.vy += (dy / nl) * power;
    b.vz += (dz / nl) * power;
    b.grounded = false;
    pl.coyote = 0;
    RV.audio.play('boost');
    RV.viewmodel.onJump();
    g.session.boosts = (g.session.boosts || 0) + 1;
    return true;
  };

  /** The homing circle touched the player: blow up at the player's feet. */
  GR.detonateAtPlayer = function (g, gw) {
    const b = g.player.b;
    if (g.mode === 'online') RV.online.sendBoom(b.x, b.y, b.z);
    GR._explode(g, { x: b.x, y: b.y, z: b.z, gw, owner: 'self', on: true, mesh: { visible: false } });
  };

  GR._explode = function (g, gr) {
    gr.on = false;
    gr.mesh.visible = false;
    const gw = gr.gw || RV.WEAPON_BY_ID.grenade;
    const ex = gr.x,
      ey = gr.y + 0.12,
      ez = gr.z;
    RV.fx.explosion(ex, ey, ez, gw.radius);
    const eyeD = Math.hypot(ex - g.eye.x, ey - g.eye.y, ez - g.eye.z);
    RV.audio.play('explosion', Math.max(0.3, 1 - eyeD / 60));
    g.session.blasts = (g.session.blasts || 0) + 1;

    const remote = gr.owner === 'remote';
    // you: never hurt by your OWN grenade, but shoved by any blast; the opponent's grenade does hurt (online)
    if (!g.playerDead) {
      if (remote && RV.online && RV.online.canDamage()) {
        const pb = g.player.b;
        const d = Math.round(GR.damageAt(g, gw, ex, ey, ez, pb.x, pb.y, pb.z, pb.h));
        if (d >= 1) {
          g.hurtPlayer(d, ex, ez, g.bots[0] || null, 'grenade');
          RV.online.sendDmg({ kind: 'grenade', dmg: d, head: false, kill: g.playerDead });
        }
      }
      GR.boost(g, gw, ex, ey, ez);
      if (eyeD < 3 && g.world.lineClear(ex, ey, ez, g.eye.x, g.eye.y, g.eye.z)) RV.hud.blast(0.3 * (1 - eyeD / 3));
    }
    // opponents: a flat 75 when the blast reaches them
    for (const bot of g.bots) {
      if (!bot.alive || bot.net || remote) continue; // remote players take their own damage on their own client
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
