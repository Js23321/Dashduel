/* DASHDUEL - Three.js rendering.
 *
 * Look: bright low-poly worlds with baked-looking shading, a real sky pass
 * (gradient, sun, haze, hills, clouds), reflections of that sky on metal, detailed
 * tile / panel textures with subtle wear, props, soft contact shadows and floor decals.
 *
 * Performance plan (Chromebook friendly):
 *  - the whole map is merged into ~10 static meshes (shared geometry per material)
 *  - Lambert shading + one directional light, optional low-res shadow map
 *  - baked contact shadows (one transparent quad mesh) instead of real-time shadows
 *  - small textures only (all generated at start, none above 256x256), one effects atlas
 *  - pooled, tiny effects (see fx.js); characters switch to a simple LOD at distance
 *  - adjustable render resolution, no post-processing
 *  - the weapon viewmodel is drawn in its own pass so it never clips into walls
 */
(function () {
  'use strict';
  const RV = window.RV;
  const TILE_MAIN = 8;
  const TILE_WALL = 4;

  // ---------------------------------------------------------------------------
  // small colour helpers (hex <-> rgb)
  // ---------------------------------------------------------------------------
  function mixHex(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function shadeHex(c, f) {
    return f <= 1 ? mixHex(0x000000, c, f) : mixHex(c, 0xffffff, f - 1);
  }
  function lightenHex(c, t) {
    return mixHex(c, 0xffffff, t);
  }

  // ---------------------------------------------------------------------------
  // Geometry accumulation
  // ---------------------------------------------------------------------------
  class GeoBuilder {
    constructor() {
      this.pos = [];
      this.nor = [];
      this.uv = [];
      this.col = [];
      this.idx = [];
      this.tmpC = new THREE.Color();
      this.ao = false; // soft contact shading (darker towards the bottom of blocks)
    }
    /** a,b,c,d are [x,y,z]; winding is fixed automatically to face `n`. */
    quad(a, b, c, d, n, color, uvAxis, tile) {
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
        const t = b;
        b = d;
        d = t;
      }
      const base = this.pos.length / 3;
      const verts = [a, b, c, d];
      this.tmpC.setHex(color);
      const ymin = Math.min(a[1], b[1], c[1], d[1]);
      for (let i = 0; i < 4; i++) {
        const v = verts[i];
        this.pos.push(v[0], v[1], v[2]);
        this.nor.push(n[0], n[1], n[2]);
        let u, w;
        if (uvAxis === 0) {
          u = v[2];
          w = v[1];
        } else if (uvAxis === 1) {
          u = v[0];
          w = v[2];
        } else {
          u = v[0];
          w = v[1];
        }
        const t = tile || 1;
        this.uv.push(u / t, w / t);
        let sh = 1;
        if (this.ao) {
          if (n[1] < -0.5) sh = 0.6;
          else if (n[1] <= 0.5) sh = 0.72 + 0.28 * Math.min(1, (v[1] - ymin) / 2.5);
        }
        this.col.push(this.tmpC.r * sh, this.tmpC.g * sh, this.tmpC.b * sh);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    /** Quad with an explicit texture rectangle (u0,v0)-(u1,v1): decals, shadows, banners. */
    quadUV(a, b, c, d, n, color, u0, v0, u1, v1) {
      let va = [a, u0, v0], vb = [b, u1, v0], vc = [c, u1, v1], vd = [d, u0, v1];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
        const t = vb;
        vb = vd;
        vd = t;
      }
      const base = this.pos.length / 3;
      this.tmpC.setHex(color);
      for (const v of [va, vb, vc, vd]) {
        this.pos.push(v[0][0], v[0][1], v[0][2]);
        this.nor.push(n[0], n[1], n[2]);
        this.uv.push(v[1], v[2]);
        this.col.push(this.tmpC.r, this.tmpC.g, this.tmpC.b);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    /** Box: top/bottom faces go to this builder, the four sides to `sb` (if given). */
    box(x0, y0, z0, x1, y1, z1, color, tile, sb) {
      const s = sb || this;
      s.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], color, 0, tile);
      s.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], color, 0, tile);
      this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color, 1, tile);
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, 1, tile);
      s.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, 2, tile);
      s.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], color, 2, tile);
    }
    /** Low-poly vertical cylinder / frustum (flat shaded). */
    cyl(cx, y0, cz, r, h, seg, color, rTop) {
      rTop = rTop == null ? r : rTop;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, m = (a0 + a1) / 2;
        const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
        const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
        const q0 = [cx + Math.cos(a0) * rTop, y0 + h, cz + Math.sin(a0) * rTop];
        const q1 = [cx + Math.cos(a1) * rTop, y0 + h, cz + Math.sin(a1) * rTop];
        this.quad(p0, p1, q1, q0, [Math.cos(m), 0.15, Math.sin(m)], color, 2, 4);
        if (rTop > 0.001) this.quad([cx, y0 + h, cz], q0, q1, q1, [0, 1, 0], color, 1, 4);
      }
    }
    /** Low-poly cone with per-face shading (used for distant hills). */
    cone(cx, y0, cz, r, h, seg, color, rot) {
      rot = rot || 0;
      for (let i = 0; i < seg; i++) {
        const a0 = rot + (i / seg) * Math.PI * 2, a1 = rot + ((i + 1) / seg) * Math.PI * 2, m = (a0 + a1) / 2;
        const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
        const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
        const shade = 0.78 + 0.22 * Math.cos(m - 0.9);
        const c = shadeHex(color, shade);
        this.quad(p0, p1, [cx, y0 + h, cz], [cx, y0 + h, cz], [Math.cos(m), 0.5, Math.sin(m)], c, 2, 4);
      }
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setIndex(this.idx);
      g.computeBoundingSphere();
      return g;
    }
    get empty() {
      return this.idx.length === 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Procedural textures (all small; generated once at start-up)
  // ---------------------------------------------------------------------------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Floor / top-face texture: 2 m tiles with tone variation, speckle, scuffs and bevelled edges. */
  function makeTileTexture() {
    return canvasTex(
      256,
      256,
      (g, w, h) => {
        const rng = RV.makeRng(11);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        for (let ty = 0; ty < 4; ty++)
          for (let tx = 0; tx < 4; tx++) {
            const v = 244 + Math.floor(rng() * 11);
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 1) + ')';
            g.fillRect(tx * 64, ty * 64, 64, 64);
          }
        for (let i = 0; i < 1100; i++) {
          g.fillStyle = rng() < 0.55 ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.4)';
          g.fillRect(rng() * w, rng() * h, 1 + rng() * 1.6, 1 + rng() * 1.6);
        }
        g.strokeStyle = 'rgba(0,0,0,0.05)';
        g.lineWidth = 1;
        for (let i = 0; i < 16; i++) {
          const x = rng() * w, y = rng() * h;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rng() - 0.5) * 24, y + (rng() - 0.5) * 10);
          g.stroke();
        }
        // grout lines + a bevel highlight on every tile edge
        g.strokeStyle = 'rgba(0,0,0,0.11)';
        g.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo(i * 64, 0);
          g.lineTo(i * 64, h);
          g.moveTo(0, i * 64);
          g.lineTo(w, i * 64);
          g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        for (let ty = 0; ty < 4; ty++)
          for (let tx = 0; tx < 4; tx++) {
            g.beginPath();
            g.moveTo(tx * 64 + 3, ty * 64 + 3);
            g.lineTo(tx * 64 + 61, ty * 64 + 3);
            g.moveTo(tx * 64 + 3, ty * 64 + 3);
            g.lineTo(tx * 64 + 3, ty * 64 + 61);
            g.stroke();
          }
        g.strokeStyle = 'rgba(0,0,0,0.2)';
        g.lineWidth = 4;
        g.strokeRect(0, 0, w, h);
      },
      true
    );
  }

  /** Vertical faces: riveted metal panels with horizontal seams and weathering streaks. */
  function makeSideTexture() {
    return canvasTex(
      256,
      256,
      (g, w, h) => {
        const rng = RV.makeRng(23);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) {
          const v = 247 + Math.floor(rng() * 8);
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          g.fillRect(0, i * 64, w, 64);
        }
        // weathering streaks running down the panels
        for (let i = 0; i < 26; i++) {
          const x = rng() * w;
          const grad = g.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.035)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.fillRect(x, 0, 1 + rng() * 3, h);
        }
        for (let i = 0; i < 700; i++) {
          g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.35)';
          g.fillRect(rng() * w, rng() * h, 1 + rng(), 1 + rng());
        }
        // seams
        for (let i = 0; i < 4; i++) {
          g.fillStyle = 'rgba(0,0,0,0.16)';
          g.fillRect(0, i * 64, w, 3);
          g.fillStyle = 'rgba(255,255,255,0.5)';
          g.fillRect(0, i * 64 + 3, w, 1.5);
          for (let x = 16; x < w; x += 32) {
            g.fillStyle = 'rgba(0,0,0,0.28)';
            g.beginPath();
            g.arc(x, i * 64 + 10, 2.1, 0, 6.3);
            g.fill();
            g.fillStyle = 'rgba(255,255,255,0.6)';
            g.beginPath();
            g.arc(x - 0.6, i * 64 + 9.4, 0.9, 0, 6.3);
            g.fill();
          }
        }
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(0, 0, 3, h);
        g.fillRect(128, 0, 2, h);
      },
      true
    );
  }

  function makeWallTexture() {
    return canvasTex(
      128,
      128,
      (g, w, h) => {
        const rng = RV.makeRng(5);
        g.fillStyle = '#0e9f93';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#d9fff7';
        for (let i = -2; i < 6; i++) {
          g.beginPath();
          g.moveTo(i * 32, h);
          g.lineTo(i * 32 + 14, h);
          g.lineTo(i * 32 + 14 + w * 0.5, 0);
          g.lineTo(i * 32 + w * 0.5, 0);
          g.closePath();
          g.fill();
        }
        for (let i = 0; i < 260; i++) {
          g.fillStyle = rng() < 0.5 ? 'rgba(0,40,36,0.13)' : 'rgba(255,255,255,0.12)';
          g.fillRect(rng() * w, rng() * h, 1 + rng(), 1 + rng());
        }
        g.strokeStyle = '#06655b';
        g.lineWidth = 6;
        g.strokeRect(0, 0, w, h);
      },
      true
    );
  }

  function makePadTexture() {
    return canvasTex(
      128,
      128,
      (g, w, h) => {
        g.fillStyle = '#0f766e';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#fde047';
        g.lineWidth = 14;
        g.lineJoin = 'miter';
        for (let i = 0; i < 2; i++) {
          const y = 18 + i * 56;
          g.beginPath();
          g.moveTo(14, y + 34);
          g.lineTo(w / 2, y);
          g.lineTo(w - 14, y + 34);
          g.stroke();
        }
      },
      true
    );
  }

  function makeGlowTexture() {
    return canvasTex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  }

  /**
   * One 256x256 atlas (4x4 tiles of 64px) shared by every effect: glow, ring,
   * chevron, bullet hole, muzzle star, smoke, emblem, hazard stripes, soft shadow, dot.
   */
  function makeFxAtlas() {
    return canvasTex(256, 256, (g) => {
      const tile = (i, fn) => {
        g.save();
        g.translate((i % 4) * 64, Math.floor(i / 4) * 64);
        g.beginPath();
        g.rect(0, 0, 64, 64);
        g.clip();
        fn();
        g.restore();
      };
      // 0 soft glow
      tile(0, () => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
      });
      // 1 ring
      tile(1, () => {
        g.strokeStyle = '#fff';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(32, 32, 25, 0, 6.3);
        g.stroke();
        g.lineWidth = 2;
        g.beginPath();
        g.arc(32, 32, 16, 0, 6.3);
        g.stroke();
      });
      // 2 chevron (points up)
      tile(2, () => {
        g.strokeStyle = '#fff';
        g.lineWidth = 9;
        g.lineJoin = 'miter';
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.moveTo(10, 30 + i * 22);
          g.lineTo(32, 10 + i * 22);
          g.lineTo(54, 30 + i * 22);
          g.stroke();
        }
      });
      // 3 bullet hole: scorch halo + dark pit + hairline cracks
      tile(3, () => {
        const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        gr.addColorStop(0, 'rgba(20,18,26,0.85)');
        gr.addColorStop(0.35, 'rgba(30,26,34,0.5)');
        gr.addColorStop(1, 'rgba(30,26,34,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(8,8,12,0.95)';
        g.beginPath();
        g.arc(32, 32, 6, 0, 6.3);
        g.fill();
        g.strokeStyle = 'rgba(10,10,14,0.6)';
        g.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const a = i * 1.1 + 0.4;
          g.beginPath();
          g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
          g.lineTo(32 + Math.cos(a) * (12 + (i % 3) * 5), 32 + Math.sin(a) * (12 + (i % 3) * 5));
          g.stroke();
        }
      });
      // 4 muzzle star
      tile(4, () => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 26);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.3, 'rgba(255,230,160,0.7)');
        gr.addColorStop(1, 'rgba(255,200,80,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(255,245,210,0.95)';
        for (let i = 0; i < 4; i++) {
          g.save();
          g.translate(32, 32);
          g.rotate((i * Math.PI) / 4);
          g.beginPath();
          g.moveTo(-30, 0);
          g.lineTo(0, -3.5);
          g.lineTo(30, 0);
          g.lineTo(0, 3.5);
          g.closePath();
          g.fill();
          g.restore();
        }
      });
      // 5 smoke puff
      tile(5, () => {
        for (let i = 0; i < 6; i++) {
          const gr = g.createRadialGradient(20 + i * 5, 28 + (i % 2) * 8, 0, 20 + i * 5, 28 + (i % 2) * 8, 18);
          gr.addColorStop(0, 'rgba(255,255,255,0.45)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(0, 0, 64, 64);
        }
      });
      // 6 emblem: ring + cross
      tile(6, () => {
        g.strokeStyle = '#fff';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(32, 32, 24, 0, 6.3);
        g.stroke();
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(32, 6);
        g.lineTo(32, 58);
        g.moveTo(6, 32);
        g.lineTo(58, 32);
        g.stroke();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(32, 32, 7, 0, 6.3);
        g.fill();
      });
      // 7 hazard stripes
      tile(7, () => {
        g.fillStyle = '#fff';
        for (let i = -4; i < 8; i++) {
          g.beginPath();
          g.moveTo(i * 16, 64);
          g.lineTo(i * 16 + 8, 64);
          g.lineTo(i * 16 + 40, 0);
          g.lineTo(i * 16 + 32, 0);
          g.closePath();
          g.fill();
        }
      });
      // 8 soft square (contact shadow)
      tile(8, () => {
        for (let i = 0; i < 12; i++) {
          g.fillStyle = 'rgba(255,255,255,' + (0.085 + i * 0.0) + ')';
          const m = 3 + i * 2.2;
          g.beginPath();
          g.roundRect ? g.roundRect(m, m, 64 - m * 2, 64 - m * 2, 10) : g.rect(m, m, 64 - m * 2, 64 - m * 2);
          g.fill();
        }
      });
      // 9 solid soft dot
      tile(9, () => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 28);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.7, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
      });
    });
  }


  // ---------------------------------------------------------------------------
  // Draw-call saver: bake every static mesh under `root` into ONE mesh per material.
  // Meshes that sit under an animated sub-group (userData.base) are left alone.
  // Positions are baked relative to `root`, so root's own transform is preserved.
  // ---------------------------------------------------------------------------
  function mergeGroup(root) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const m4 = new THREE.Matrix4(),
      nm = new THREE.Matrix3(),
      v = new THREE.Vector3();
    const byMat = new Map();
    const meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData && p.userData.base) return; // animated part
      meshes.push(o);
    });
    for (const o of meshes) {
      let e = byMat.get(o.material);
      if (!e) byMat.set(o.material, (e = { pos: [], nor: [], uv: [], idx: [], n: 0, cast: false }));
      const g = o.geometry;
      const pos = g.attributes.position,
        nor = g.attributes.normal,
        uv = g.attributes.uv;
      m4.multiplyMatrices(inv, o.matrixWorld);
      nm.getNormalMatrix(m4);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        e.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        e.nor.push(v.x, v.y, v.z);
        if (uv) e.uv.push(uv.getX(i), uv.getY(i));
        else e.uv.push(0, 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) e.idx.push(g.index.getX(i) + e.n);
      else for (let i = 0; i < pos.count; i++) e.idx.push(i + e.n);
      e.n += pos.count;
      if (o.userData.cast) e.cast = true;
      o.parent.remove(o);
    }
    for (const [mat, e] of byMat) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(e.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(e.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(e.uv, 2));
      geo.setIndex(e.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.cast = e.cast;
      root.add(mesh);
    }
    return root;
  }
  RV.mergeGroup = mergeGroup;

  // ---------------------------------------------------------------------------
  // The renderer object
  // ---------------------------------------------------------------------------
  const R = (RV.render = {
    ready: false,
    scene: null,
    camera: null,
    renderer: null,
    mapGroup: null,
    scale: 1,
    stats: { calls: 0, tris: 0 },
    outlines: true,
  });

  /** UV rectangle [u0,v0,u1,v1] of one effects-atlas tile. */
  R.fxRect = function (tile) {
    const col = tile % 4,
      row = Math.floor(tile / 4);
    return [col / 4, 1 - (row + 1) / 4, (col + 1) / 4, 1 - row / 4];
  };
  /** Unit plane whose UVs map to one atlas tile. */
  R.makeFxPlane = function (tile) {
    const g = new THREE.PlaneGeometry(1, 1);
    const r = R.fxRect(tile);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    return g;
  };

  R.init = function (canvas) {
    R.canvas = canvas;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      return false;
    }
    R.renderer = renderer;
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping; // tone mappers (ACES/AgX) wash the bright palette out

    R.scene = new THREE.Scene();
    R.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1500);
    R.camera.rotation.order = 'YXZ';
    R.scene.add(R.camera);

    // sky is rendered first in its own scene (infinitely far, never fogged)
    R.skyScene = new THREE.Scene();
    R.skyCam = new THREE.PerspectiveCamera(75, 1, 5, 3500);
    R.skyCam.rotation.order = 'YXZ';

    // lights
    R.hemi = new THREE.HemisphereLight(0xffffff, 0xb7c7e8, 2.1);
    R.scene.add(R.hemi);
    R.sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    R.sun.position.set(40, 90, 30);
    R.sun.target.position.set(0, 0, 0);
    R.scene.add(R.sun);
    R.scene.add(R.sun.target);

    // textures + shared materials
    R.texTile = makeTileTexture();
    R.texSide = makeSideTexture();
    R.texWall = makeWallTexture();
    R.texPad = makePadTexture();
    R.texGlow = makeGlowTexture();
    R.texFx = makeFxAtlas();
    const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    R.texTile.anisotropy = R.texSide.anisotropy = R.texWall.anisotropy = Math.min(4, maxAniso);

    R.matMain = new THREE.MeshLambertMaterial({ vertexColors: true, map: R.texTile });
    R.matSide = new THREE.MeshLambertMaterial({ vertexColors: true, map: R.texSide });
    R.matWall = new THREE.MeshLambertMaterial({ map: R.texWall, color: 0xffffff });
    R.matProp = new THREE.MeshLambertMaterial({ vertexColors: true });
    R.matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.38, envMapIntensity: 0.9 });
    R.matLight = new THREE.MeshBasicMaterial({ vertexColors: true });
    R.matTrim = new THREE.MeshBasicMaterial({ vertexColors: true });
    R.matDecor = new THREE.MeshBasicMaterial({ vertexColors: true });
    R.matPad = new THREE.MeshBasicMaterial({ map: R.texPad });
    R.matShadow = new THREE.MeshBasicMaterial({
      map: R.texFx, color: 0x1a1d3d, transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    R.matDecal = new THREE.MeshBasicMaterial({
      map: R.texFx, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    R.matSky = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false });
    R.matScenery = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
    R.sharedMats = [R.matMain, R.matSide, R.matWall, R.matProp, R.matMetal, R.matLight, R.matTrim, R.matDecor, R.matPad, R.matShadow, R.matDecal, R.matSky, R.matScenery];

    // sky dome (colours are painted per map in _buildSky)
    const sg = new THREE.SphereGeometry(900, 28, 16);
    sg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(sg.attributes.position.count * 3), 3));
    R.skyGeo = sg;
    R.sky = new THREE.Mesh(sg, R.matSky);
    R.sky.renderOrder = -10;
    R.skyScene.add(R.sky);
    R.skyGroup = new THREE.Group();
    R.skyScene.add(R.skyGroup);

    R._buildEffects();
    R._buildViewmodel();
    RV.fx.init(R);

    R.setShadows(RV.settings.shadows);
    R.resize();
    window.addEventListener('resize', () => R.resize());
    R.ready = true;
    return true;
  };

  R.setScale = function (s) {
    R.scale = s;
    R.resize();
  };

  R.resize = function () {
    if (!R.renderer) return;
    const w = Math.max(160, Math.floor(window.innerWidth * R.scale));
    const h = Math.max(120, Math.floor(window.innerHeight * R.scale));
    R.renderer.setSize(w, h, false);
    R.canvas.style.width = '100vw';
    R.canvas.style.height = '100vh';
    R.aspect = w / h;
    R.canvasH = h;
    R.camera.aspect = R.aspect;
    R.skyCam.aspect = R.aspect;
    R.vmCamera.aspect = R.aspect;
    R.setFov(RV.settings.fov);
    R.vmCamera.updateProjectionMatrix();
  };

  /** Horizontal field of view in degrees. */
  R.setFov = function (hfovDeg) {
    R.baseFov = hfovDeg;
    R._lastFov = null;
    R._applyFov(hfovDeg);
  };
  R._applyFov = function (hfovDeg) {
    const h = (hfovDeg * Math.PI) / 180;
    const v = 2 * Math.atan(Math.tan(h / 2) / R.aspect);
    R.camera.fov = (v * 180) / Math.PI;
    R.camera.updateProjectionMatrix();
    R.skyCam.fov = R.camera.fov;
    R.skyCam.updateProjectionMatrix();
    if (RV.fx && RV.fx.ready) RV.fx.setView(R.camera.fov, R.canvasH);
  };

  R.setShadows = function (level) {
    const on = level !== 'off';
    R.renderer.shadowMap.enabled = on;
    R.sun.castShadow = on;
    const size = level === 'high' ? 2048 : 1024;
    const ext = level === 'high' ? 55 : 42;
    const sh = R.sun.shadow;
    if (sh.mapSize.x !== size || !on) {
      sh.mapSize.set(size, size);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    sh.camera.left = -ext;
    sh.camera.right = ext;
    sh.camera.top = ext;
    sh.camera.bottom = -ext;
    sh.camera.near = 5;
    sh.camera.far = 220;
    sh.bias = -0.0006;
    sh.normalBias = 0.06;
    sh.camera.updateProjectionMatrix();
    R.shadowLevel = level;
    if (R.mapMeshes) {
      for (const m of R.mapMeshes) {
        m.castShadow = on;
        m.receiveShadow = on;
      }
    }
    R.matMain.needsUpdate = true;
    R.matSide.needsUpdate = true;
    R.matWall.needsUpdate = true;
    R.matProp.needsUpdate = true;
    for (const b of R.botMeshes || []) b.group.traverse((o) => (o.castShadow = on && o.userData.cast));
  };

  /** Effects level: off | low | high (particles, bullet holes, casings, flashes). */
  R.setFx = function (level) {
    R.fxLevel = level;
    if (RV.fx) RV.fx.setLevel(level);
  };

  /** Quality-dependent decoration: clouds, character outlines. */
  R.setDetail = function (quality) {
    R.outlines = quality !== 'low';
    if (R.cloudMesh) R.cloudMesh.visible = quality !== 'low';
    for (const b of R.botMeshes || []) if (b.outlineGroup) b.outlineGroup.visible = R.outlines;
  };

  // ---------------------------------------------------------------------------
  // Sky pass: gradient dome, sun, horizon haze, hills, clouds - and the
  // reflection map built from them (so metal reflects the real sky of the map)
  // ---------------------------------------------------------------------------
  R._buildSky = function (def) {
    const sky = def.sky;
    // dispose the previous decoration
    while (R.skyGroup.children.length) {
      const o = R.skyGroup.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material && R.sharedMats.indexOf(o.material) < 0) o.material.dispose();
    }
    // dome gradient: ground haze below the horizon, horizon band, then sky
    const pos = R.skyGeo.attributes.position,
      col = R.skyGeo.attributes.color;
    const top = sky.top,
      mid = mixHex(sky.top, sky.bottom, 0.6),
      hor = sky.bottom,
      fog = sky.fog;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 900;
      let hex;
      if (t < 0) hex = mixHex(fog, 0x000000, 0.1);
      else if (t < 0.06) hex = mixHex(fog, hor, t / 0.06);
      else if (t < 0.4) hex = mixHex(hor, mid, (t - 0.06) / 0.34);
      else hex = mixHex(mid, top, Math.pow((t - 0.4) / 0.6, 0.8));
      c.setHex(hex);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;

    // sun disc + glow (direction matches the directional light)
    const sd = new THREE.Vector3(40, 90, 30).normalize();
    const sunMat = new THREE.SpriteMaterial({ map: R.texGlow, color: mixHex(sky.sun ? sky.sun[0] : 0xfff4e0, 0xffffff, 0.3), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
    const sun = new THREE.Sprite(sunMat);
    sun.position.copy(sd).multiplyScalar(820);
    sun.scale.set(420, 420, 1);
    R.skyGroup.add(sun);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: R.texGlow, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0.9 }));
    core.position.copy(sd).multiplyScalar(815);
    core.scale.set(120, 120, 1);
    R.skyGroup.add(core);

    // horizon haze: a fog-coloured band that fades upwards (distance atmosphere)
    const hg = new THREE.CylinderGeometry(860, 860, 190, 32, 1, true);
    const hc = [];
    const hp = hg.attributes.position;
    const fc = new THREE.Color(fog);
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      const a = y < 0 ? 0.9 : Math.max(0, 0.55 * (1 - y / 95));
      hc.push(fc.r, fc.g, fc.b, a);
    }
    hg.setAttribute('color', new THREE.Float32BufferAttribute(hc, 4));
    const haze = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false }));
    haze.position.y = 30;
    haze.renderOrder = -8;
    R.skyGroup.add(haze);

    // low-poly hills in two aerial-perspective layers
    const rng = RV.makeRng(def.id.length * 131 + 7);
    const hills = new GeoBuilder();
    const hillBase = sky.hill != null ? sky.hill : mixHex(sky.bottom, 0x4f7d5a, 0.4);
    // far layer first: these draw in order (no depth), so near hills must come last
    for (const [layer, radius, count, mixT, hmul] of [[1, 780, 14, 0.78, 1.5], [0, 640, 18, 0.55, 1.0]]) {
      for (let i = 0; i < count; i++) {
        const a = ((i + rng() * 0.8) / count) * Math.PI * 2;
        const r = radius + rng() * 90;
        const hr = 120 + rng() * 130,
          hh = (38 + rng() * 80) * hmul;
        const colr = mixHex(hillBase, fog, mixT + rng() * 0.08);
        hills.cone(Math.cos(a) * r, -25, Math.sin(a) * r, hr, hh + 25, 6, colr, rng() * 6);
      }
    }
    const hm = new THREE.Mesh(hills.build(), R.matScenery);
    hm.renderOrder = -9;
    R.skyGroup.add(hm);

    // clouds: fixed in the sky, drawn behind everything
    const cloud = new GeoBuilder();
    cloud.ao = true;
    const cr = RV.makeRng(def.id.length * 977 + def.solids.length);
    const ncl = def.clouds || 0;
    for (let i = 0; i < ncl; i++) {
      const a = cr() * Math.PI * 2,
        r = 560 + cr() * 280;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r,
        y = 140 + cr() * 130;
      const n = 3 + Math.floor(cr() * 3);
      for (let k = 0; k < n; k++) {
        const w = 60 + cr() * 70,
          h = 14 + cr() * 14,
          d = 34 + cr() * 40;
        const ox = (cr() - 0.5) * 110,
          oz = (cr() - 0.5) * 60,
          oy = (cr() - 0.5) * 10;
        cloud.box(x + ox - w / 2, y + oy, z + oz - d / 2, x + ox + w / 2, y + oy + h, z + oz + d / 2, mixHex(0xffffff, sky.bottom, 0.12));
      }
    }
    R.cloudMesh = null;
    if (!cloud.empty) {
      const cm = new THREE.Mesh(cloud.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false }));
      cm.renderOrder = -7;
      cm.visible = RV.settings.quality !== 'low';
      R.skyGroup.add(cm);
      R.cloudMesh = cm;
    }

    // reflection map of this sky (once per map: ~tens of ms, never during play)
    try {
      const pm = new THREE.PMREMGenerator(R.renderer);
      const rt = pm.fromScene(R.skyScene, 0.0, 5, 3500);
      if (R.envRT) R.envRT.dispose();
      R.envRT = rt;
      R.scene.environment = rt.texture;
      R.vmScene.environment = rt.texture;
      pm.dispose();
    } catch (e) {
      R.scene.environment = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Map building
  // ---------------------------------------------------------------------------
  R.buildMap = function (def, world) {
    R.clearMap();
    const grp = new THREE.Group();
    R.mapGroup = grp;
    R.mapMeshes = [];
    R.padMeshes = [];
    R.cyls = [];

    const main = new GeoBuilder(),
      side = new GeoBuilder(),
      wall = new GeoBuilder(),
      trim = new GeoBuilder(),
      decor = new GeoBuilder(),
      prop = new GeoBuilder(),
      metal = new GeoBuilder(),
      light = new GeoBuilder(),
      shadow = new GeoBuilder(),
      decal = new GeoBuilder();
    main.ao = side.ao = decor.ao = prop.ao = metal.ao = true;

    const bd = world.bounds;
    const cxm = (bd.minX + bd.maxX) / 2,
      czm = (bd.minZ + bd.maxZ) / 2;
    const accents = [RV.COL.cyan, RV.COL.magenta, RV.COL.lime, RV.COL.orange];
    let accentIdx = 0;

    for (const s of world.solids) {
      const d = s.def;
      const color = d.color != null ? d.color : 0x4c586c;
      if (!s.isRamp) {
        const x0 = s.minX, y0 = s.minY, z0 = s.minZ, x1 = s.maxX, y1 = s.maxY, z1 = s.maxZ;
        if (s.runnable) {
          // top + bottom in the main mesh, vertical faces get the wall-run pattern
          main.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color, 1, TILE_MAIN);
          main.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, 1, TILE_MAIN);
          const wc = 0xffffff;
          wall.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], wc, 0, TILE_WALL);
          wall.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], wc, 0, TILE_WALL);
          wall.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wc, 2, TILE_WALL);
          wall.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], wc, 2, TILE_WALL);
          // tall perimeter walls get glowing light strips on their inner face
          if (y1 - Math.max(y0, 0) >= 8) {
            const col = accents[accentIdx++ % accents.length];
            R._wallLights(light, s, cxm, czm, col);
          }
        } else if (d.metal) {
          metal.box(x0, y0, z0, x1, y1, z1, color, TILE_MAIN, metal);
        } else {
          main.box(x0, y0, z0, x1, y1, z1, color, TILE_MAIN, side);
        }
        if (d.trim != null) {
          const t = 0.14, h = 0.05, c = d.trim;
          trim.box(x0, y1, z0, x1, y1 + h, z0 + t, c);
          trim.box(x0, y1, z1 - t, x1, y1 + h, z1, c);
          trim.box(x0, y1, z0 + t, x0 + t, y1 + h, z1 - t, c);
          trim.box(x1 - t, y1, z0 + t, x1, y1 + h, z1 - t, c);
        }
        if (d.detail === 'crate') R._detailCrate(prop, s, color);
        else if (d.detail === 'pillar') R._detailPillar(prop, light, s, color, d.trim != null ? d.trim : RV.COL.cyan);
        // baked contact shadow for blocks that stand on the ground
        if (!s.runnable && !d.metal && y0 >= -0.01 && y0 <= 0.05 && y1 - y0 > 0.5 && y1 - y0 < 14) R._contactShadow(shadow, s);
      } else {
        R._addRamp(main, side, trim, s, color, d.trim);
      }
    }

    // floor decals (rings, arrows, emblems, lane markings)
    for (const dc of def.decals || []) R._floorDecal(decal, dc);

    for (const dc of def.decor || []) {
      decor.box(dc.min[0], dc.min[1], dc.min[2], dc.max[0], dc.max[1], dc.max[2], dc.color);
    }

    const add = (gb, mat, cast) => {
      if (gb.empty) return null;
      const m = new THREE.Mesh(gb.build(), mat);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      grp.add(m);
      if (cast) R.mapMeshes.push(m);
      return m;
    };
    add(main, R.matMain, true);
    add(side, R.matSide, true);
    add(wall, R.matWall, true);
    add(prop, R.matProp, true);
    add(metal, R.matMetal, true);
    add(trim, R.matTrim, false);
    add(light, R.matLight, false);
    add(decor, R.matDecor, false);
    const sm = add(shadow, R.matShadow, false);
    if (sm) sm.renderOrder = 1;
    const dm = add(decal, R.matDecal, false);
    if (dm) dm.renderOrder = 2;

    // launch pads
    for (const p of world.pads) {
      const w = p.x1 - p.x0,
        d = p.z1 - p.z0;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, d - 0.3), R.matPad);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = -Math.PI / 2;
      const hl = Math.hypot(p.vx, p.vz);
      mesh.rotation.y = hl > 0.01 ? Math.atan2(-p.vx, -p.vz) : 0;
      mesh.position.set((p.x0 + p.x1) / 2, p.y + 0.02, (p.z0 + p.z1) / 2);
      grp.add(mesh);
      const rim = new GeoBuilder();
      const t = 0.18;
      rim.box(p.x0, p.y, p.z0, p.x1, p.y + 0.06, p.z0 + t, 0xfde047);
      rim.box(p.x0, p.y, p.z1 - t, p.x1, p.y + 0.06, p.z1, 0xfde047);
      rim.box(p.x0, p.y, p.z0 + t, p.x0 + t, p.y + 0.06, p.z1 - t, 0xfde047);
      rim.box(p.x1 - t, p.y, p.z0 + t, p.x1, p.y + 0.06, p.z1 - t, 0xfde047);
      grp.add(new THREE.Mesh(rim.build(), R.matTrim));
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.45, w * 0.45, 7, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x00b8d9, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
      );
      col.position.set((p.x0 + p.x1) / 2, p.y + 3.5, (p.z0 + p.z1) / 2);
      grp.add(col);
      R._regCyl(col, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, w * 0.45, p.y - 1, p.y + 7);
    }

    // beacons: tall translucent columns visible through fog, for navigation at speed
    for (const b of def.beacons || []) {
      const h = b.y1 - b.y0;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r, b.r, h, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide })
      );
      m.position.set(b.x, b.y0 + h / 2, b.z);
      grp.add(m);
      R._regCyl(m, b.x, b.z, b.r, b.y0 - 1, b.y1);
    }

    R.scene.add(grp);

    // atmosphere: fog, lights and colour grade
    const sky = def.sky;
    R.renderer.setClearColor(sky.fog, 1);
    R.scene.background = null;
    R.scene.fog = new THREE.Fog(sky.fog, sky.fogNear, sky.fogFar);
    if (sky.hemi) {
      R.hemi.color.setHex(sky.hemi[0]);
      R.hemi.groundColor.setHex(sky.hemi[1]);
      R.hemi.intensity = sky.hemi[2];
    }
    if (sky.sun) {
      R.sun.color.setHex(sky.sun[0]);
      R.sun.intensity = sky.sun[1];
    }
    R._buildSky(def);

    R.setShadows(RV.settings.shadows);
    R.def = def;
    R._buildCheckpoints(def);
    R.botMeshes = R.botMeshes || [];
    R.setDetail(RV.settings.quality);
  };

  /** Emissive strips on the inner face of a tall wall, plus vertical lamp panels. */
  R._wallLights = function (light, s, cx, cz, color) {
    const w = s.maxX - s.minX,
      d = s.maxZ - s.minZ;
    const yLow = 1.3,
      yHigh = Math.max(yLow + 3, s.maxY - 1.5);
    const o = 0.05;
    if (w > d) {
      const faceZ = czm_pick(cz, s.minZ, s.maxZ);
      const dir = cz > (s.minZ + s.maxZ) / 2 ? 1 : -1;
      const z0 = dir > 0 ? faceZ : faceZ - o,
        z1 = dir > 0 ? faceZ + o : faceZ;
      for (const y of [yLow, yHigh]) light.box(s.minX + 1, y - 0.08, z0, s.maxX - 1, y + 0.08, z1, color);
      for (let x = s.minX + 10; x < s.maxX - 8; x += 16) light.box(x - 0.25, yLow + 1.2, z0, x + 0.25, yHigh - 1.2, z1, lightenHex(color, 0.55));
    } else {
      const faceX = czm_pick(cx, s.minX, s.maxX);
      const dir = cx > (s.minX + s.maxX) / 2 ? 1 : -1;
      const x0 = dir > 0 ? faceX : faceX - o,
        x1 = dir > 0 ? faceX + o : faceX;
      for (const y of [yLow, yHigh]) light.box(x0, y - 0.08, s.minZ + 1, x1, y + 0.08, s.maxZ - 1, color);
      for (let z = s.minZ + 10; z < s.maxZ - 8; z += 16) light.box(x0, yLow + 1.2, z - 0.25, x1, yHigh - 1.2, z + 0.25, lightenHex(color, 0.55));
    }
  };
  /** The wall face that looks towards the arena centre. */
  function czm_pick(c, lo, hi) {
    return c > (lo + hi) / 2 ? hi : lo;
  }

  /** Crate: corner posts + top frame (and a mid band on tall ones) around the collision box. */
  R._detailCrate = function (prop, s, color) {
    const x0 = s.minX, x1 = s.maxX, y0 = s.minY, y1 = s.maxY, z0 = s.minZ, z1 = s.maxZ;
    const t = 0.1, p = 0.04;
    const f = shadeHex(color, 0.66);
    const fl = shadeHex(color, 0.8);
    // posts
    for (const [px, sx] of [[x0, -1], [x1, 1]])
      for (const [pz, sz] of [[z0, -1], [z1, 1]]) {
        const ax = sx < 0 ? px - p : px - t,
          bx = sx < 0 ? px + t : px + p;
        const az = sz < 0 ? pz - p : pz - t,
          bz = sz < 0 ? pz + t : pz + p;
        prop.box(ax, y0, az, bx, y1 + 0.03, bz, f);
      }
    const bands = [y1 - t];
    if (y1 - y0 > 1.8) bands.push((y0 + y1) / 2 - t / 2);
    bands.push(y0);
    for (const by of bands) {
      const top = by + t + (by === y1 - t ? 0.03 : 0);
      prop.box(x0 - p, by, z0 - p, x1 + p, top, z0 + t, fl);
      prop.box(x0 - p, by, z1 - t, x1 + p, top, z1 + p, fl);
      prop.box(x0 - p, by, z0 + t, x0 + t, top, z1 - t, fl);
      prop.box(x1 - t, by, z0 + t, x1 + p, top, z1 - t, fl);
    }
  };

  /** Pillar: stepped base, capital and a glowing ring. */
  R._detailPillar = function (prop, light, s, color, ringColor) {
    const x0 = s.minX, x1 = s.maxX, y0 = s.minY, y1 = s.maxY, z0 = s.minZ, z1 = s.maxZ;
    const dark = shadeHex(color, 0.72);
    prop.box(x0 - 0.12, y0, z0 - 0.12, x1 + 0.12, y0 + 0.45, z1 + 0.12, dark);
    prop.box(x0 - 0.06, y0 + 0.45, z0 - 0.06, x1 + 0.06, y0 + 0.62, z1 + 0.06, shadeHex(color, 0.85));
    prop.box(x0 - 0.12, y1 - 0.4, z0 - 0.12, x1 + 0.12, y1 + 0.02, z1 + 0.12, dark);
    const ym = y0 + (y1 - y0) * 0.62;
    light.box(x0 - 0.035, ym - 0.07, z0 - 0.035, x1 + 0.035, ym + 0.07, z1 + 0.035, ringColor);
  };

  /** Soft baked contact shadow on the floor next to a block (cheap alternative to real shadows). */
  R._contactShadow = function (shadow, s) {
    const h = s.maxY - s.minY;
    const pad = Math.min(1.7, 0.55 + 0.1 * h);
    const sx = -0.14 * h,
      sz = -0.1 * h; // the light comes from +x,+z so shadows fall towards -x,-z
    const x0 = s.minX - pad + sx, x1 = s.maxX + pad + sx, z0 = s.minZ - pad + sz, z1 = s.maxZ + pad + sz;
    const y = 0.015;
    const r = R.fxRect(8);
    shadow.quadUV([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], 0xffffff, r[0], r[1], r[2], r[3]);
  };

  /** Flat painted marking on the floor (ring, arrow, emblem, stripe, dot). */
  R._floorDecal = function (decal, dc) {
    const tile = { ring: 1, arrow: 2, cross: 6, stripe: 7, dot: 9, glow: 0 }[dc.t] || 1;
    const r = R.fxRect(tile);
    const hs = dc.size / 2;
    const hw = dc.w != null ? dc.w / 2 : hs;
    const rot = dc.rot || 0;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const y = (dc.y || 0) + 0.02;
    const corner = (lx, lz) => [dc.x + lx * c - lz * s, y, dc.z + lx * s + lz * c];
    decal.quadUV(corner(-hw, -hs), corner(hw, -hs), corner(hw, hs), corner(-hw, hs), [0, 1, 0], dc.color != null ? dc.color : 0xffffff, r[0], r[1], r[2], r[3]);
  };

  /** Translucent columns are hidden while the camera is inside them (they would wash out the screen). */
  R._regCyl = function (mesh, x, z, r, y0, y1) {
    const e = { mesh, x, z, r: r + 0.7, y0, y1, want: true };
    (R.cyls = R.cyls || []).push(e);
    return e;
  };

  R._addRamp = function (main, side, trim, s, color, trimColor) {
    const x0 = s.minX, x1 = s.maxX, z0 = s.minZ, z1 = s.maxZ, yb = s.minY;
    const h = (x, z) => RV.rampHeightAt(s, x, z);
    const a = [x0, h(x0, z0), z0], b = [x1, h(x1, z0), z0], c = [x1, h(x1, z1), z1], d = [x0, h(x0, z1), z1];
    main.quad(a, b, c, d, [s.nx, s.ny, s.nz], color, 1, TILE_MAIN);
    main.quad([x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1], [0, -1, 0], color, 1, TILE_MAIN);
    side.quad([x0, yb, z0], [x1, yb, z0], b, a, [0, 0, -1], color, 2, TILE_MAIN);
    side.quad([x0, yb, z1], [x1, yb, z1], c, d, [0, 0, 1], color, 2, TILE_MAIN);
    side.quad([x0, yb, z0], [x0, yb, z1], d, a, [-1, 0, 0], color, 0, TILE_MAIN);
    side.quad([x1, yb, z0], [x1, yb, z1], c, b, [1, 0, 0], color, 0, TILE_MAIN);
    if (trimColor != null) {
      const t = 0.18, o = 0.025;
      const up = (p) => [p[0] + s.nx * o, p[1] + s.ny * o, p[2] + s.nz * o];
      if (s.axis === 0) {
        for (const zz of [[z0, z0 + t], [z1 - t, z1]])
          trim.quad(up([x0, h(x0, zz[0]), zz[0]]), up([x1, h(x1, zz[0]), zz[0]]), up([x1, h(x1, zz[1]), zz[1]]), up([x0, h(x0, zz[1]), zz[1]]), [s.nx, s.ny, s.nz], trimColor, 1, 1);
      } else {
        for (const xx of [[x0, x0 + t], [x1 - t, x1]])
          trim.quad(up([xx[0], h(xx[0], z0), z0]), up([xx[1], h(xx[1], z0), z0]), up([xx[1], h(xx[1], z1), z1]), up([xx[0], h(xx[0], z1), z1]), [s.nx, s.ny, s.nz], trimColor, 1, 1);
      }
    }
  };

  R.clearMap = function () {
    if (R.mapGroup) {
      R.scene.remove(R.mapGroup);
      R.mapGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && R.sharedMats.indexOf(o.material) < 0) o.material.dispose();
      });
      R.mapGroup = null;
    }
    if (R.rings) {
      for (const r of R.rings) {
        R.scene.remove(r.group);
        R.scene.remove(r.beam);
        r.beam.geometry.dispose();
        r.beamMat.dispose();
        r.mat.dispose();
        r.discMat.dispose();
      }
      R.rings = null;
    }
    for (const b of R.botMeshes || []) R.scene.remove(b.group);
    R.botMeshes = [];
    for (const t of R.tracers) t.mesh.visible = false;
    for (const s of R.sparks) s.sprite.visible = false;
    if (RV.fx && RV.fx.ready) RV.fx.clear();
  };

  // ---------------------------------------------------------------------------
  // Checkpoint rings
  // ---------------------------------------------------------------------------
  R._buildCheckpoints = function (def) {
    R.rings = null;
    const cps = def.checkpoints;
    if (!cps || !cps.length) return;
    R.rings = [];
    const start = def.spawns[0];
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const prev = i === 0 ? { x: start.x, y: start.y + 1, z: start.z } : cps[i - 1];
      const next = cps[i + 1];
      let dx = (next ? next.x : cp.x + (cp.x - prev.x)) - prev.x;
      let dz = (next ? next.z : cp.z + (cp.z - prev.z)) - prev.z;
      const dl = Math.hypot(dx, 0, dz) || 1;
      dx /= dl;
      dz /= dl;
      const isFinish = i === cps.length - 1;
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, fog: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(isFinish ? 3.2 : 2.6, isFinish ? 0.3 : 0.2, 8, 36), mat);
      group.add(ring);
      const discMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false });
      group.add(new THREE.Mesh(new THREE.CircleGeometry(isFinish ? 3.2 : 2.6, 28), discMat));
      group.position.set(cp.x, cp.y, cp.z);
      group.lookAt(cp.x + dx, cp.y, cp.z + dz);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.28, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 120, 8, 1, true), beamMat);
      beam.position.set(cp.x, cp.y + 55, cp.z);
      R.scene.add(beam);
      const cyl = R._regCyl(beam, cp.x, cp.z, 0.9, cp.y - 5, cp.y + 115);
      R.scene.add(group);
      R.rings.push({ group, mat, discMat, beamMat, beam, cyl, finish: isFinish, state: -1 });
    }
  };

  /** state per ring: 0 = passed (hidden), 1 = next (bright), 2 = later (dim) */
  R.setCheckpointStates = function (nextIdx) {
    if (!R.rings) return;
    for (let i = 0; i < R.rings.length; i++) {
      const r = R.rings[i];
      const st = i < nextIdx ? 0 : i === nextIdx ? 1 : 2;
      r.state = st;
      r.group.visible = st !== 0;
      r.cyl.want = st === 1;
      r.beam.visible = st === 1;
      const c = r.finish ? 0xffc300 : st === 1 ? 0x65d000 : 0x00b8d9;
      r.mat.color.setHex(c);
      r.discMat.color.setHex(c);
      r.beamMat.color.setHex(c);
      r.mat.opacity = st === 1 ? 1 : 0.45;
      r.discMat.opacity = st === 1 ? 0.12 : 0.04;
    }
  };

  // ---------------------------------------------------------------------------
  // Weapon models for opponents (simple: the detailed ones live in viewmodel.js)
  // ---------------------------------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  R.botMeshes = [];

  const WEAPON_STYLE = {
    rifle: { body: 0x3b4252, accent: 0x00b8d9 },
    pistol: { body: 0x3f4a58, accent: 0xffc300 },
    fists: { body: 0x3f4a58, accent: 0xffffff },
  };

  /** Builds a low-poly weapon facing -Z. Returns {group, mats, muzzle:[x,y,z]}. */
  R.makeWeaponModel = function (id) {
    const st = WEAPON_STYLE[id] || WEAPON_STYLE.rifle;
    const group = new THREE.Group();
    const mBody = new THREE.MeshLambertMaterial({ color: st.body });
    const mDark = new THREE.MeshLambertMaterial({ color: 0x222833 });
    const mAcc = new THREE.MeshBasicMaterial({ color: st.accent });
    const mats = [mBody, mDark, mAcc];
    const mk = (mat, sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.userData.cast = true;
      group.add(m);
      return m;
    };
    let muzzle = [0, 0.01, -0.5];
    switch (id) {
      case 'fists':
        // bare hands: nothing is held (the character's own blocky hands are the weapon)
        return { group, mats, muzzle: [0, 0, -0.3] };
      case 'pistol':
        mk(mBody, 0.062, 0.08, 0.3, 0, 0.03, 0);
        mk(mDark, 0.055, 0.16, 0.075, 0, -0.08, 0.1);
        mk(mAcc, 0.066, 0.012, 0.22, 0, 0.074, -0.02);
        muzzle = [0, 0.03, -0.16];
        break;
      default:
        mk(mBody, 0.07, 0.1, 0.46, 0, 0, 0);
        mk(mDark, 0.045, 0.045, 0.26, 0, 0.012, -0.36);
        mk(mDark, 0.052, 0.14, 0.08, 0, -0.11, -0.06);
        mk(mDark, 0.06, 0.13, 0.07, 0, -0.1, 0.13);
        mk(mDark, 0.06, 0.1, 0.18, 0, -0.01, 0.3);
        mk(mAcc, 0.075, 0.014, 0.22, 0, 0.056, -0.04);
        muzzle = [0, 0.012, -0.5];
    }
    mergeGroup(group); // 3 draw calls (one per material) instead of one per box
    return { group, mats, muzzle };
  };

  // ---------------------------------------------------------------------------
  // Opponent characters: chunky blocky figures with a face, cap, held weapon,
  // a dark outline (readable against any background) and a cheap far-away LOD
  // ---------------------------------------------------------------------------
  const faceCache = {};
  function faceTexture(skinHex) {
    if (faceCache[skinHex]) return faceCache[skinHex];
    const t = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#' + ('000000' + skinHex.toString(16)).slice(-6);
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f2937';
      g.fillRect(16, 22, 8, 12);
      g.fillRect(40, 22, 8, 12);
      g.fillStyle = '#ffffff';
      g.fillRect(18, 24, 3, 4);
      g.fillRect(42, 24, 3, 4);
      g.strokeStyle = '#7c2d12';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(32, 38, 11, 0.25 * Math.PI, 0.75 * Math.PI);
      g.stroke();
    });
    faceCache[skinHex] = t;
    return t;
  }

  function nameTexture(text, color) {
    return canvasTex(256, 64, (g, w, h) => {
      g.font = 'bold 34px Segoe UI, Roboto, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(15,23,42,0.9)';
      g.strokeText(text, w / 2, h / 2);
      g.fillStyle = color || '#ffffff';
      g.fillText(text, w / 2, h / 2);
    });
  }

  const SKINS = [0xf7d6a4, 0xe8b98a, 0xc68c5a, 0xffe0bd, 0x9b6a45, 0xf3c7a0];
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b1450, side: THREE.BackSide });

  R.createBotMesh = function (colorHex, weaponId, skinIdx) {
    const group = new THREE.Group();
    const detail = new THREE.Group(); // everything that is hidden by the far LOD
    group.add(detail);
    const outlineGroup = new THREE.Group();
    detail.add(outlineGroup);
    const shirt = new THREE.Color(colorHex || 0xe5484d);
    const pants = shirt.clone().multiplyScalar(0.5);
    const hat = shirt.clone().offsetHSL(0.5, 0.05, 0.05);
    const bodyMat = new THREE.MeshLambertMaterial({ color: shirt });
    const legMat = new THREE.MeshLambertMaterial({ color: pants });
    const skin = SKINS[(skinIdx || 0) % SKINS.length];
    const headMat = new THREE.MeshLambertMaterial({ color: skin });
    const hatMat = new THREE.MeshLambertMaterial({ color: hat });
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(skin) });
    const mats = [bodyMat, legMat, headMat, hatMat, faceMat];
    // static parts are baked into one mesh per material (draw-call saver); only the legs animate
    const statics = new THREE.Group();
    const statOutline = new THREE.Group();
    const part = (parent, mat, sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.userData.cast = true;
      parent.add(m);
      return m;
    };
    const outlineOf = (parent, sx, sy, sz, x, y, z) => part(parent, outlineMat, sx + 0.07, sy + 0.07, sz + 0.07, x, y, z);
    part(statics, bodyMat, 0.62, 0.72, 0.36, 0, 1.2, 0); // torso
    outlineOf(statOutline, 0.62, 0.72, 0.36, 0, 1.2, 0);
    part(statics, headMat, 0.36, 0.36, 0.36, 0, 1.76, 0); // head
    outlineOf(statOutline, 0.36, 0.36, 0.36, 0, 1.76, 0);
    part(statics, faceMat, 0.3, 0.3, 0.01, 0, 1.76, -0.186);
    part(statics, hatMat, 0.4, 0.1, 0.4, 0, 1.99, 0);
    part(statics, hatMat, 0.4, 0.04, 0.16, 0, 1.94, -0.27);
    part(statics, bodyMat, 0.15, 0.62, 0.15, -0.4, 1.18, 0); // arms
    part(statics, bodyMat, 0.15, 0.15, 0.52, 0.4, 1.3, -0.2);
    mergeGroup(statics);
    mergeGroup(statOutline);
    detail.add(statics);
    outlineGroup.add(statOutline);
    const legL = part(detail, legMat, 0.26, 0.84, 0.28, -0.16, 0.42, 0);
    const legR = part(detail, legMat, 0.26, 0.84, 0.28, 0.16, 0.42, 0);
    legL.userData.outline = outlineOf(outlineGroup, 0.26, 0.84, 0.28, -0.16, 0.42, 0);
    legR.userData.outline = outlineOf(outlineGroup, 0.26, 0.84, 0.28, 0.16, 0.42, 0);
    // far LOD: one simple body + head
    const low = new THREE.Group();
    const lowBody = new THREE.Mesh(boxGeo, bodyMat);
    lowBody.scale.set(0.62, 1.3, 0.4);
    lowBody.position.y = 0.75;
    const lowHead = new THREE.Mesh(boxGeo, headMat);
    lowHead.scale.set(0.36, 0.36, 0.36);
    lowHead.position.y = 1.76;
    low.add(lowBody, lowHead);
    low.visible = false;
    group.add(low);
    // health bar (billboarded each frame) + name tag
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x1e293b, fog: false }));
    bg.scale.set(0.96, 0.1, 0.01);
    const fill = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, fog: false }));
    fill.scale.set(0.9, 0.065, 0.012);
    fill.position.z = 0.01;
    bar.add(bg);
    bar.add(fill);
    bar.position.y = 2.28;
    group.add(bar);
    const tagMat = new THREE.SpriteMaterial({ fog: false, transparent: true, depthWrite: false });
    const tag = new THREE.Sprite(tagMat);
    tag.scale.set(1.5, 0.375, 1);
    tag.position.y = 2.55;
    group.add(tag);

    const rec = {
      group, detail, low, outlineGroup, legL, legR, bar, fill, bodyMat, headMat, tag, tagMat,
      flash: 0, mats, weaponGroup: null, weaponMats: [], weaponId: null, nameTex: null, far: false,
    };
    rec.setWeapon = function (id) {
      if (rec.weaponId === id) return;
      rec.weaponId = id;
      if (rec.weaponGroup) {
        detail.remove(rec.weaponGroup);
        disposeOwnGeometry(rec.weaponGroup);
        for (const m of rec.weaponMats) m.dispose();
      }
      const w = R.makeWeaponModel(id);
      w.group.scale.setScalar(0.95);
      w.group.position.set(0.4, 1.3, -0.62);
      detail.add(w.group);
      rec.weaponGroup = w.group;
      rec.weaponMats = w.mats;
      rec.muzzle = w.muzzle;
    };
    rec.setName = function (text, color) {
      if (rec.nameTex) rec.nameTex.dispose();
      rec.nameTex = nameTexture(text, color);
      tagMat.map = rec.nameTex;
      tagMat.needsUpdate = true;
    };
    rec.setWeapon(weaponId || 'rifle');
    outlineGroup.visible = R.outlines;
    R.scene.add(group);
    R.botMeshes.push(rec);
    return rec;
  };

  /** Free the GPU buffers of every geometry under `root` except the shared unit box. */
  function disposeOwnGeometry(root) {
    root.traverse((o) => {
      if (o.geometry && o.geometry !== boxGeo) o.geometry.dispose();
    });
  }

  R.removeBotMesh = function (rec) {
    R.scene.remove(rec.group);
    disposeOwnGeometry(rec.group);
    const i = R.botMeshes.indexOf(rec);
    if (i >= 0) R.botMeshes.splice(i, 1);
    for (const m of rec.mats) m.dispose();
    for (const m of rec.weaponMats) m.dispose();
    if (rec.nameTex) rec.nameTex.dispose();
    rec.tagMat.dispose();
  };

  // ---------------------------------------------------------------------------
  // Effects: tracers and sparks (pooled). Particles/decals live in fx.js.
  // ---------------------------------------------------------------------------
  R._buildEffects = function () {
    R.tracers = [];
    R.sparks = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9, fog: false, depthWrite: false });
      const mesh = new THREE.Mesh(tg, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      R.scene.add(mesh);
      R.tracers.push({ mesh, mat, life: 0, max: 0.07 });
    }
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({ map: R.texGlow, color: 0xffffff, transparent: true, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      R.scene.add(sprite);
      R.sparks.push({ sprite, mat, life: 0, max: 0.14, size: 0.5 });
    }
    R._tracerIdx = 0;
    R._sparkIdx = 0;
    R._tmpV = new THREE.Vector3();
  };

  R.addTracer = function (ox, oy, oz, hx, hy, hz, color, width) {
    if (RV.settings.effects === 'off') return;
    const t = R.tracers[R._tracerIdx++ % R.tracers.length];
    const dx = hx - ox, dy = hy - oy, dz = hz - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return;
    const m = t.mesh;
    m.position.set(ox + dx / 2, oy + dy / 2, oz + dz / 2);
    m.lookAt(hx, hy, hz);
    const w = width || 0.035;
    m.scale.set(w, w, len);
    t.mat.color.setHex(color || 0xfff2b0);
    t.mat.opacity = 0.9;
    t.life = t.max;
    m.visible = true;
  };

  R.addSpark = function (x, y, z, color, size, life) {
    if (RV.settings.effects === 'off') return;
    const s = R.sparks[R._sparkIdx++ % R.sparks.length];
    s.sprite.position.set(x, y, z);
    s.mat.color.setHex(color || 0xffe9a8);
    s.size = size || 0.6;
    s.max = life || 0.14;
    s.life = s.max;
    s.sprite.scale.set(s.size, s.size, 1);
    s.sprite.visible = true;
  };

  R._updateEffects = function (dt) {
    for (const t of R.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mat.opacity = 0.9 * (t.life / t.max);
    }
    for (const s of R.sparks) {
      if (!s.sprite.visible) continue;
      s.life -= dt;
      if (s.life <= 0) s.sprite.visible = false;
      else {
        const k = s.life / s.max;
        s.mat.opacity = k;
        const sz = s.size * (1.6 - 0.6 * k);
        s.sprite.scale.set(sz, sz, 1);
      }
    }
    RV.fx.update(dt);
  };

  // ---------------------------------------------------------------------------
  // Viewmodel scene (own camera: never clips into geometry). Models + animation
  // live in viewmodel.js; the weapon is attached to this camera, not the world.
  // ---------------------------------------------------------------------------
  R._buildViewmodel = function () {
    R.vmScene = new THREE.Scene();
    R.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.02, 20);
    R.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a8, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 1.9);
    dl.position.set(1, 2, 1.5);
    R.vmScene.add(dl);
    R.vmRoot = new THREE.Group();
    R.vmScene.add(R.vmRoot);
    R.vm = { hidden: false };
    RV.viewmodel.build(R);
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  R.updateCamera = function (ex, ey, ez, yaw, pitch, roll, hfov) {
    const c = R.camera;
    c.position.set(ex, ey, ez);
    c.rotation.set(pitch, yaw, roll);
    R.skyCam.rotation.set(pitch, yaw, roll);
    if (hfov !== R._lastFov) {
      R._lastFov = hfov;
      R._applyFov(hfov);
    }
    if (R.cyls) {
      for (let i = 0; i < R.cyls.length; i++) {
        const q = R.cyls[i];
        const dx = ex - q.x, dz = ez - q.z;
        const inside = dx * dx + dz * dz < q.r * q.r && ey > q.y0 && ey < q.y1;
        q.mesh.visible = q.want && !inside;
      }
    }
    if (R.shadowLevel !== 'off') {
      // keep the shadow box centred on the player, snapped to avoid shimmer
      const sn = 4;
      const sx = Math.round(ex / sn) * sn, sz = Math.round(ez / sn) * sn;
      R.sun.target.position.set(sx, ey - 1.5, sz);
      R.sun.position.set(sx + 40, ey + 90, sz + 30);
    }
  };

  /**
   * Compile every shader and upload every texture/buffer once, with all pooled
   * effect objects visible, so the first shot / hit / reload never hitches.
   */
  R.warmup = function () {
    if (!R.ready) return;
    try {
      RV.viewmodel.warm(true);
      for (const t of R.tracers) t.mesh.visible = true;
      for (const s of R.sparks) s.sprite.visible = true;
      RV.fx.warm();
      const r = R.renderer;
      r.compile(R.skyScene, R.skyCam);
      r.compile(R.scene, R.camera);
      r.compile(R.vmScene, R.vmCamera);
      r.clear(true, true, false);
      r.render(R.skyScene, R.skyCam);
      r.clearDepth();
      r.render(R.scene, R.camera);
      r.clearDepth();
      r.render(R.vmScene, R.vmCamera);
    } catch (e) {
      /* warm-up is best effort */
    }
    RV.viewmodel.warm(false);
    for (const t of R.tracers) t.mesh.visible = false;
    for (const s of R.sparks) s.sprite.visible = false;
  };

  R.render = function (dt) {
    if (!R.ready) return;
    R._updateEffects(dt);
    if (R.texPad) R.texPad.offset.y -= dt * 1.2;
    const cp = R.camera.position;
    for (const b of R.botMeshes) {
      if (!b.group.visible) continue;
      // billboard health bars
      b.bar.rotation.y = Math.atan2(cp.x - b.group.position.x, cp.z - b.group.position.z) - b.group.rotation.y;
      // far LOD: a single block body beyond ~34 m (fewer draw calls for distant opponents)
      const dx = cp.x - b.group.position.x,
        dz = cp.z - b.group.position.z;
      const far = dx * dx + dz * dz > 1156;
      if (far !== b.far) {
        b.far = far;
        b.detail.visible = !far;
        b.low.visible = far;
      }
      // outlines follow the animated legs
      if (!far && R.outlines) {
        b.legL.userData.outline.rotation.copy(b.legL.rotation);
        b.legR.userData.outline.rotation.copy(b.legR.rotation);
      }
    }
    // ring pulse
    if (R.rings) {
      const t = performance.now() * 0.004;
      for (const r of R.rings) if (r.state === 1) r.group.scale.setScalar(1 + Math.sin(t) * 0.04);
    }
    const r = R.renderer;
    r.info.reset();
    r.clear(true, true, false);
    r.render(R.skyScene, R.skyCam); // sky first (never fogged, infinitely far)
    r.clearDepth();
    r.render(R.scene, R.camera);
    if (RV.settings.showWeapon && !R.vm.hidden) {
      r.clearDepth();
      r.render(R.vmScene, R.vmCamera);
    }
    R.stats.calls = r.info.render.calls;
    R.stats.tris = r.info.render.triangles;
  };

  RV.GeoBuilder = GeoBuilder;
  RV.mixHex = mixHex;
})();
