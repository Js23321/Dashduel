/* DASHDUEL - collision world.
 *
 * Geometry is made of axis-aligned boxes and axis-aligned ramps (wedges).
 * Bodies are upright AABBs. Movement is resolved axis by axis so walls slide
 * naturally, with automatic step-up for low ledges and ramps.
 *
 * Everything here is pure maths (no DOM / WebGL) so it can also run headless.
 */
(function () {
  'use strict';
  const RV = window.RV;

  const EPS = 1e-4;
  const CELL = 8;
  const MAX_MOVE = 0.25; // largest slice of movement resolved at once (stops tunnelling)

  /** Highest ramp surface under a body footprint at (px,pz) with half-width hw. */
  function rampSupport(r, px, pz, hw) {
    let lo, hi, a0, a1;
    if (r.axis === 0) {
      lo = Math.max(r.minX, px - hw);
      hi = Math.min(r.maxX, px + hw);
      a0 = r.minX;
      a1 = r.maxX;
    } else {
      lo = Math.max(r.minZ, pz - hw);
      hi = Math.min(r.maxZ, pz + hw);
      a0 = r.minZ;
      a1 = r.maxZ;
    }
    const p = r.sign > 0 ? hi : lo;
    let u = (p - a0) / (a1 - a0);
    if (r.sign < 0) u = 1 - u;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    return r.yLow + (r.yHigh - r.yLow) * u;
  }

  /** Surface height of a ramp at an exact point. */
  function rampHeightAt(r, x, z) {
    return rampSupport(r, x, z, 0);
  }

  class World {
    constructor(def) {
      this.def = def;
      this.solids = [];
      this.boxes = [];
      this.ramps = [];
      this.pads = [];
      this.killY = def.killY != null ? def.killY : -60;
      for (let i = 0; i < def.solids.length; i++) this._add(def.solids[i]);
      for (const p of def.pads || []) {
        this.pads.push({
          x0: p.x - p.w / 2,
          x1: p.x + p.w / 2,
          z0: p.z - p.d / 2,
          z1: p.z + p.d / 2,
          y: p.y,
          vx: p.vel[0],
          vy: p.vel[1],
          vz: p.vel[2],
          keep: p.keep != null ? p.keep : 0.3,
          def: p,
        });
      }
      this._stamp = 0;
      this._tmp = [];
      this._tmp2 = [];
      this._buildGrid();
    }

    _add(s) {
      const id = this.solids.length;
      let o;
      if (s.type === 'ramp') {
        const minX = Math.min(s.x0, s.x1),
          maxX = Math.max(s.x0, s.x1),
          minZ = Math.min(s.z0, s.z1),
          maxZ = Math.max(s.z0, s.z1);
        const axis = s.rise[1] === 'x' ? 0 : 1;
        const sign = s.rise[0] === '+' ? 1 : -1;
        const len = axis === 0 ? maxX - minX : maxZ - minZ;
        const dH = s.yHigh - s.yLow;
        // surface plane  y = h0 + sx*x + sz*z   (used by the raycaster)
        let sx = 0,
          sz = 0,
          h0;
        if (axis === 0) {
          sx = (sign * dH) / len;
          h0 = s.yLow - sx * (sign > 0 ? minX : maxX);
        } else {
          sz = (sign * dH) / len;
          h0 = s.yLow - sz * (sign > 0 ? minZ : maxZ);
        }
        o = {
          id,
          isRamp: true,
          runnable: false,
          minX,
          maxX,
          minZ,
          maxZ,
          minY: s.bottom != null ? s.bottom : Math.min(s.yLow, s.yHigh),
          maxY: Math.max(s.yLow, s.yHigh),
          yLow: s.yLow,
          yHigh: s.yHigh,
          axis,
          sign,
          len,
          sx,
          sz,
          h0,
          // unit slope normal
          nx: 0,
          ny: 1,
          nz: 0,
          _stamp: 0,
          def: s,
        };
        const nl = Math.sqrt(sx * sx + 1 + sz * sz);
        o.nx = -sx / nl;
        o.ny = 1 / nl;
        o.nz = -sz / nl;
        this.ramps.push(o);
      } else {
        o = {
          id,
          isRamp: false,
          runnable: !!s.wall,
          minX: s.min[0],
          minY: s.min[1],
          minZ: s.min[2],
          maxX: s.max[0],
          maxY: s.max[1],
          maxZ: s.max[2],
          _stamp: 0,
          def: s,
        };
        this.boxes.push(o);
      }
      this.solids.push(o);
    }

    _buildGrid() {
      this.grid = new Map();
      let minX = Infinity,
        minZ = Infinity,
        maxX = -Infinity,
        maxZ = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const s of this.solids) {
        minX = Math.min(minX, s.minX);
        maxX = Math.max(maxX, s.maxX);
        minZ = Math.min(minZ, s.minZ);
        maxZ = Math.max(maxZ, s.maxZ);
        minY = Math.min(minY, s.minY);
        maxY = Math.max(maxY, s.maxY);
        const cx0 = Math.floor(s.minX / CELL),
          cx1 = Math.floor(s.maxX / CELL),
          cz0 = Math.floor(s.minZ / CELL),
          cz1 = Math.floor(s.maxZ / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const k = (cx + 512) * 1024 + (cz + 512);
            let l = this.grid.get(k);
            if (!l) this.grid.set(k, (l = []));
            l.push(s);
          }
        }
      }
      this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
    }

    /** Collect solids whose cells touch the XZ rectangle. */
    query(minX, maxX, minZ, maxZ, out) {
      out.length = 0;
      const stamp = ++this._stamp;
      const cx0 = Math.floor(minX / CELL),
        cx1 = Math.floor(maxX / CELL),
        cz0 = Math.floor(minZ / CELL),
        cz1 = Math.floor(maxZ / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const l = this.grid.get((cx + 512) * 1024 + (cz + 512));
          if (!l) continue;
          for (let i = 0; i < l.length; i++) {
            const s = l[i];
            if (s._stamp !== stamp) {
              s._stamp = stamp;
              out.push(s);
            }
          }
        }
      }
      return out;
    }

    _overlap(s, x, y, z, hw, h) {
      if (x + hw <= s.minX + EPS || x - hw >= s.maxX - EPS) return false;
      if (z + hw <= s.minZ + EPS || z - hw >= s.maxZ - EPS) return false;
      if (y + h <= s.minY + EPS) return false;
      if (s.isRamp) return y < rampSupport(s, x, z, hw) - EPS;
      return y < s.maxY - EPS;
    }

    /** True if an AABB (feet-centred) intersects any solid. */
    overlapsAny(x, y, z, hw, h) {
      const list = this.query(x - hw, x + hw, z - hw, z + hw, this._tmp2);
      for (let i = 0; i < list.length; i++) if (this._overlap(list[i], x, y, z, hw, h)) return true;
      return false;
    }

    /**
     * Move a body by (dx,dy,dz), resolving collisions.
     * Body fields used: x,y,z,hw,h,grounded,stepGround,stepAir.
     * Sets: hitX/hitZ (-1,0,1), hitUp, landed, stepped.
     */
    move(b, dx, dy, dz) {
      const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
      const n = m > MAX_MOVE ? Math.ceil(m / MAX_MOVE) : 1;
      const sx = dx / n,
        sy = dy / n,
        sz = dz / n;
      b.hitX = 0;
      b.hitZ = 0;
      b.hitUp = false;
      b.landed = false;
      b.stepped = false;
      for (let i = 0; i < n; i++) {
        if (sx !== 0) {
          b.x += sx;
          this._resolveH(b, 0, sx);
        }
        if (sz !== 0) {
          b.z += sz;
          this._resolveH(b, 1, sz);
        }
        if (sy !== 0) {
          b.y += sy;
          this._resolveV(b, sy);
        }
      }
    }

    _resolveH(b, axis, d) {
      const hw = b.hw;
      const list = this.query(b.x - hw, b.x + hw, b.z - hw, b.z + hw, this._tmp);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!this._overlap(s, b.x, b.y, b.z, hw, b.h)) continue;
        const top = s.isRamp ? rampSupport(s, b.x, b.z, hw) : s.maxY;
        const rise = top - b.y;
        const maxStep = b.grounded ? b.stepGround : b.stepAir;
        if (rise > 0 && rise <= maxStep && !this.overlapsAny(b.x, top, b.z, hw, b.h)) {
          b.y = top;
          b.stepped = true;
          continue;
        }
        if (axis === 0) {
          if (d > 0) {
            b.x = s.minX - hw;
            b.hitX = 1;
          } else {
            b.x = s.maxX + hw;
            b.hitX = -1;
          }
        } else if (d > 0) {
          b.z = s.minZ - hw;
          b.hitZ = 1;
        } else {
          b.z = s.maxZ + hw;
          b.hitZ = -1;
        }
      }
    }

    _resolveV(b, d) {
      const hw = b.hw;
      const list = this.query(b.x - hw, b.x + hw, b.z - hw, b.z + hw, this._tmp);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!this._overlap(s, b.x, b.y, b.z, hw, b.h)) continue;
        if (d < 0) {
          b.y = s.isRamp ? rampSupport(s, b.x, b.z, hw) : s.maxY;
          b.landed = true;
        } else {
          b.y = s.minY - b.h;
          b.hitUp = true;
        }
      }
    }

    /**
     * Look for ground at or just below the body's feet.
     * `out` receives y and the surface normal. Returns true when found.
     */
    probeGround(b, below, out) {
      const hw = b.hw - 0.02;
      const list = this.query(b.x - hw, b.x + hw, b.z - hw, b.z + hw, this._tmp);
      let best = -Infinity,
        bs = null;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (b.x + hw <= s.minX + EPS || b.x - hw >= s.maxX - EPS) continue;
        if (b.z + hw <= s.minZ + EPS || b.z - hw >= s.maxZ - EPS) continue;
        const top = s.isRamp ? rampSupport(s, b.x, b.z, hw) : s.maxY;
        if (top > b.y + 0.03 || top < b.y - below || top < s.minY) continue;
        if (top > best) {
          best = top;
          bs = s;
        }
      }
      if (!bs) return false;
      out.y = best;
      out.solid = bs;
      if (bs.isRamp) {
        out.nx = bs.nx;
        out.ny = bs.ny;
        out.nz = bs.nz;
      } else {
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
      }
      return true;
    }

    /** Highest surface at (x,z) not above `fromY`, or -Infinity. Used by AI ledge checks. */
    floorBelow(x, fromY, z, hw) {
      const list = this.query(x - hw, x + hw, z - hw, z + hw, this._tmp);
      let best = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (x + hw <= s.minX || x - hw >= s.maxX || z + hw <= s.minZ || z - hw >= s.maxZ) continue;
        const top = s.isRamp ? rampSupport(s, x, z, hw) : s.maxY;
        if (top <= fromY && top > best) best = top;
      }
      return best;
    }

    /**
     * Nearby vertical faces of boxes, for wall-running / wall-jumping.
     * Fills `out` with {nx,nz,gap,key,runnable,solid}; returns the count.
     * Normals point from the wall towards the body.
     */
    wallContacts(b, probe, out) {
      let n = 0;
      const hw = b.hw;
      const list = this.query(b.x - hw - probe, b.x + hw + probe, b.z - hw - probe, b.z + hw + probe, this._tmp);
      const y0 = b.y + 0.25,
        y1 = b.y + b.h - 0.25;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.isRamp) continue;
        if (s.maxY < y0 + 0.9 || s.minY > y1) continue; // must be a real wall next to the body
        const zOv = b.z + hw > s.minZ + 0.05 && b.z - hw < s.maxZ - 0.05;
        const xOv = b.x + hw > s.minX + 0.05 && b.x - hw < s.maxX - 0.05;
        if (zOv) {
          let gap = s.minX - (b.x + hw);
          if (gap > -0.06 && gap <= probe) out[n++] = this._contact(out[n], -1, 0, gap, s, 0);
          gap = b.x - hw - s.maxX;
          if (gap > -0.06 && gap <= probe) out[n++] = this._contact(out[n], 1, 0, gap, s, 1);
        }
        if (xOv) {
          let gap = s.minZ - (b.z + hw);
          if (gap > -0.06 && gap <= probe) out[n++] = this._contact(out[n], 0, -1, gap, s, 2);
          gap = b.z - hw - s.maxZ;
          if (gap > -0.06 && gap <= probe) out[n++] = this._contact(out[n], 0, 1, gap, s, 3);
        }
      }
      return n;
    }

    _contact(c, nx, nz, gap, s, side) {
      if (!c) c = {};
      c.nx = nx;
      c.nz = nz;
      c.gap = gap;
      c.solid = s;
      c.runnable = s.runnable;
      c.key = s.id * 4 + side;
      return c;
    }

    /**
     * Ray vs. world. Writes {t,nx,ny,nz,solid} into `out`; returns true on hit.
     * (dx,dy,dz) must be normalised.
     */
    raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
      let bestT = maxT;
      let found = false;
      const solids = this.solids;
      const n = out;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        // quick AABB reject (ramps use their bounding box)
        let tmin = 0,
          tmax = bestT;
        let nx = 0,
          ny = 0,
          nz = 0;
        let hit = true;
        // X slab
        if (dx > -1e-12 && dx < 1e-12) {
          if (ox < s.minX || ox > s.maxX) hit = false;
        } else {
          const inv = 1 / dx;
          let t1 = (s.minX - ox) * inv,
            t2 = (s.maxX - ox) * inv,
            sg = -1;
          if (t1 > t2) {
            const tt = t1;
            t1 = t2;
            t2 = tt;
            sg = 1;
          }
          if (t1 > tmin) {
            tmin = t1;
            nx = sg;
            ny = 0;
            nz = 0;
          }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) hit = false;
        }
        if (!hit) continue;
        // Z slab
        if (dz > -1e-12 && dz < 1e-12) {
          if (oz < s.minZ || oz > s.maxZ) continue;
        } else {
          const inv = 1 / dz;
          let t1 = (s.minZ - oz) * inv,
            t2 = (s.maxZ - oz) * inv,
            sg = -1;
          if (t1 > t2) {
            const tt = t1;
            t1 = t2;
            t2 = tt;
            sg = 1;
          }
          if (t1 > tmin) {
            tmin = t1;
            nx = 0;
            ny = 0;
            nz = sg;
          }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) continue;
        }
        // Y slab
        if (dy > -1e-12 && dy < 1e-12) {
          if (oy < s.minY || oy > s.maxY) continue;
        } else {
          const inv = 1 / dy;
          let t1 = (s.minY - oy) * inv,
            t2 = (s.maxY - oy) * inv,
            sg = -1;
          if (t1 > t2) {
            const tt = t1;
            t1 = t2;
            t2 = tt;
            sg = 1;
          }
          if (t1 > tmin) {
            tmin = t1;
            nx = 0;
            ny = sg;
            nz = 0;
          }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) continue;
        }

        if (s.isRamp) {
          // exact test: clip the ray against the wedge's half-spaces
          const r = this._rayRamp(s, ox, oy, oz, dx, dy, dz, bestT);
          if (r < 0 || r >= bestT) continue;
          bestT = r;
          n.t = r;
          n.nx = this._rn.x;
          n.ny = this._rn.y;
          n.nz = this._rn.z;
          n.solid = s;
          found = true;
        } else {
          if (tmin >= bestT) continue;
          if (tmin === 0 && nx === 0 && ny === 0 && nz === 0) ny = 1; // origin inside the box
          bestT = tmin;
          n.t = tmin;
          n.nx = nx;
          n.ny = ny;
          n.nz = nz;
          n.solid = s;
          found = true;
        }
      }
      return found;
    }

    _rayRamp(s, ox, oy, oz, dx, dy, dz, maxT) {
      let tEnter = 0,
        tExit = maxT;
      let enx = 0,
        eny = 1,
        enz = 0;
      // planes: n.p <= d
      const planes = this._planes || (this._planes = new Float64Array(24));
      this._rn = this._rn || { x: 0, y: 1, z: 0 };
      // [nx,ny,nz,d, ...] built inline
      let k = 0;
      planes[k++] = 1; planes[k++] = 0; planes[k++] = 0; planes[k++] = s.maxX;
      planes[k++] = -1; planes[k++] = 0; planes[k++] = 0; planes[k++] = -s.minX;
      planes[k++] = 0; planes[k++] = 0; planes[k++] = 1; planes[k++] = s.maxZ;
      planes[k++] = 0; planes[k++] = 0; planes[k++] = -1; planes[k++] = -s.minZ;
      planes[k++] = 0; planes[k++] = -1; planes[k++] = 0; planes[k++] = -s.minY;
      planes[k++] = -s.sx; planes[k++] = 1; planes[k++] = -s.sz; planes[k++] = s.h0;
      for (let i = 0; i < 6; i++) {
        const nx = planes[i * 4],
          ny = planes[i * 4 + 1],
          nz = planes[i * 4 + 2],
          d = planes[i * 4 + 3];
        const denom = nx * dx + ny * dy + nz * dz;
        const num = d - (nx * ox + ny * oy + nz * oz);
        if (denom > -1e-12 && denom < 1e-12) {
          if (num < 0) return -1;
          continue;
        }
        const t = num / denom;
        if (denom < 0) {
          if (t > tEnter) {
            tEnter = t;
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
            enx = nx / l;
            eny = ny / l;
            enz = nz / l;
          }
        } else if (t < tExit) tExit = t;
        if (tEnter > tExit) return -1;
      }
      this._rn.x = enx;
      this._rn.y = eny;
      this._rn.z = enz;
      return tEnter;
    }

    /** True when nothing solid lies between the two points. */
    lineClear(ax, ay, az, bx, by, bz) {
      let dx = bx - ax,
        dy = by - ay,
        dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return true;
      dx /= len;
      dy /= len;
      dz /= len;
      return !this.raycast(ax, ay, az, dx, dy, dz, len - 0.01, (this._lc = this._lc || {}));
    }
  }

  /** Ray vs. AABB. Returns entry distance or -1. */
  function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxT) {
    let tmin = 0,
      tmax = maxT;
    if (dx > -1e-12 && dx < 1e-12) {
      if (ox < minX || ox > maxX) return -1;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - ox) * inv,
        t2 = (maxX - ox) * inv;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (dy > -1e-12 && dy < 1e-12) {
      if (oy < minY || oy > maxY) return -1;
    } else {
      const inv = 1 / dy;
      let t1 = (minY - oy) * inv,
        t2 = (maxY - oy) * inv;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (dz > -1e-12 && dz < 1e-12) {
      if (oz < minZ || oz > maxZ) return -1;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - oz) * inv,
        t2 = (maxZ - oz) * inv;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  RV.World = World;
  RV.rayAABB = rayAABB;
  RV.rampSupport = rampSupport;
  RV.rampHeightAt = rampHeightAt;
})();
