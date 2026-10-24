/* DASHDUEL - grenade physics (pure maths, no rendering). Shared by the browser and the game server.
 *
 * The server runs this to decide where a grenade goes, when it explodes and who it hurts; the
 * browser runs the same code to show the flight immediately and for offline modes.
 * `world` is a collision World (js/collision.js): raycast() and lineClear().
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const RV = (root.RV = root.RV || {});

  const S = (RV.grensim = {
    GRAV: 24,
    RADIUS: 0.07, // collision radius of the projectile
    RESTITUTION: 0.42,
    FRICTION: 0.8,
  });

  /**
   * Start position (the throwing hand, never inside a wall) and velocity (the view direction tilted up
   * by the arc, plus a share of the thrower's own movement). Fills and returns `o`.
   */
  S.launch = function (world, eye, fwd, vel, gw, o, rh) {
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
    if (world.raycast(eye.x, eye.y, eye.z, ox / od, oy / od, oz / od, od + S.RADIUS, rh)) {
      const t = Math.max(0, rh.t - S.RADIUS * 1.5);
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

  /**
   * Advance a grenade {x,y,z,vx,vy,vz,rest} by h seconds (call with h <= 1/90 so it never tunnels).
   * Returns the impact speed when it bounced this step, otherwise 0.
   */
  S.step = function (gr, h, world, rh) {
    if (!gr.rest) gr.vy -= S.GRAV * h;
    const sp = Math.hypot(gr.vx, gr.vy, gr.vz);
    const len = sp * h;
    if (len < 1e-7) return 0;
    const dx = gr.vx / sp,
      dy = gr.vy / sp,
      dz = gr.vz / sp;
    let bounced = 0;
    if (world.raycast(gr.x, gr.y, gr.z, dx, dy, dz, len + S.RADIUS, rh)) {
      const move = Math.max(0, rh.t - S.RADIUS);
      gr.x += dx * move;
      gr.y += dy * move;
      gr.z += dz * move;
      const vn = gr.vx * rh.nx + gr.vy * rh.ny + gr.vz * rh.nz;
      if (vn < 0) {
        // reflect with energy loss, damp the sliding part
        gr.vx -= (1 + S.RESTITUTION) * vn * rh.nx;
        gr.vy -= (1 + S.RESTITUTION) * vn * rh.ny;
        gr.vz -= (1 + S.RESTITUTION) * vn * rh.nz;
        const vn2 = gr.vx * rh.nx + gr.vy * rh.ny + gr.vz * rh.nz;
        const tx = gr.vx - vn2 * rh.nx,
          ty = gr.vy - vn2 * rh.ny,
          tz = gr.vz - vn2 * rh.nz;
        gr.vx = vn2 * rh.nx + tx * S.FRICTION;
        gr.vy = vn2 * rh.ny + ty * S.FRICTION;
        gr.vz = vn2 * rh.nz + tz * S.FRICTION;
        bounced = -vn;
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
    return bounced;
  };

  /**
   * The push a blast gives a player standing near it (no damage): a grenade at your feet launches you. Changes the
   * velocity of `pl` (a RV.Player) and returns true if it pushed. The browser calls this for prediction, the server
   * for the authoritative result.
   */
  S.boost = function (world, pl, gw, ex, ey, ez) {
    const b = pl.b;
    const cx = b.x,
      cy = b.y + b.h * 0.5,
      cz = b.z;
    let dx = cx - ex,
      dy = cy - ey,
      dz = cz - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > gw.boostRadius) return false;
    if (!world.lineClear(ex, ey, ez, cx, cy, cz) && !world.lineClear(ex, ey, ez, cx, b.y + 0.2, cz)) return false;
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
    return true;
  };

  /**
   * Damage a blast at (ex,ey,ez) does to a body standing at (tx,ty,tz) with height th: gw.dmg scaled by
   * how much of the body the blast can see (0, 1/3, 2/3 or all of it; walls and cover block it).
   */
  S.damageAt = function (world, gw, ex, ey, ez, tx, ty, tz, th) {
    const cy = ty + th * 0.5;
    const dist = Math.hypot(tx - ex, cy - ey, tz - ez);
    if (dist >= gw.radius + 0.6) return 0;
    const ys = [ty + 0.25, cy, ty + th - 0.2];
    let seen = 0;
    for (const sy of ys) if (world.lineClear(ex, ey, ez, tx, sy, tz)) seen++;
    if (seen === 0) return 0;
    const f = Math.min(1, Math.max(0, dist / gw.radius));
    const fall = 1 - f * (1 - gw.minDmgFrac);
    return gw.dmg * fall * (seen / 3);
  };
})();
