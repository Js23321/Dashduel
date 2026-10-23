/* DASHDUEL - world effects: impact particles and bullet-hole decals.
 *
 * Both are single draw calls (one Points object, one InstancedMesh) with fixed
 * pools, so there is no allocation while playing and no frame-time spikes.
 * Everything is cosmetic and is spawned AFTER a shot has been resolved.
 * Effects stay small and short so enemies are always easy to see.
 */
(function () {
  'use strict';
  const RV = window.RV;

  const LEVELS = {
    off: { particles: 0, decals: 0, dust: 0, sparks: 0 },
    low: { particles: 18, decals: 8, dust: 2, sparks: 2 },
    high: { particles: 64, decals: 28, dust: 5, sparks: 4 },
  };

  const FX = (RV.fx = { ready: false, level: 'high', cap: 64 });
  const N = 64;

  const VERT = [
    'attribute float size;',
    'attribute vec4 color;',
    'uniform float uScale;',
    'varying vec4 vColor;',
    'void main() {',
    '  vColor = color;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = max(1.0, size * uScale / max(0.1, -mv.z));',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\n');
  const FRAG = [
    'varying vec4 vColor;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5) * 2.0;',
    '  float a = smoothstep(1.0, 0.45, d);',
    '  gl_FragColor = vec4(vColor.rgb, vColor.a * a);',
    '}',
  ].join('\n');

  FX.init = function (R) {
    FX.R = R;
    // ---- particles
    const geo = new THREE.BufferGeometry();
    FX.pos = new Float32Array(N * 3);
    FX.col = new Float32Array(N * 4);
    FX.size = new Float32Array(N);
    FX.vel = new Float32Array(N * 3);
    FX.life = new Float32Array(N);
    FX.maxLife = new Float32Array(N);
    FX.grav = new Float32Array(N);
    FX.alpha0 = new Float32Array(N);
    FX.size0 = new Float32Array(N);
    FX.grow = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(FX.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(FX.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(FX.size, 1).setUsage(THREE.DynamicDrawUsage));
    FX.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    FX.points = new THREE.Points(geo, FX.mat);
    FX.points.frustumCulled = false;
    R.scene.add(FX.points);
    FX.next = 0;

    // ---- decals (bullet holes): one instanced mesh
    const dg = R.makeFxPlane(3);
    const dm = new THREE.MeshBasicMaterial({
      map: R.texFx,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    FX.decalMax = 28;
    FX.decals = new THREE.InstancedMesh(dg, dm, FX.decalMax);
    FX.decals.frustumCulled = false;
    FX.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    FX.decalAge = new Float32Array(FX.decalMax).fill(-1);
    FX.decalBase = new Float32Array(FX.decalMax * 8); // x y z qx qy qz qw scale
    FX.decalNext = 0;
    FX._m = new THREE.Matrix4();
    FX._q = new THREE.Quaternion();
    FX._q2 = new THREE.Quaternion();
    FX._p = new THREE.Vector3();
    FX._s = new THREE.Vector3();
    FX._n = new THREE.Vector3();
    FX._z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < FX.decalMax; i++) FX._hideDecal(i);
    FX.decals.instanceMatrix.needsUpdate = true;
    R.scene.add(FX.decals);

    // ---- bursts: a small pool of additive billboards / flat rings (explosion flash, shock ring,
    //      punch spark, double-jump ring). Hidden meshes cost nothing.
    FX.bursts = [];
    const glow = R.makeFxPlane(0),
      ringG = R.makeFxPlane(1),
      star = R.makeFxPlane(4);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: R.texFx, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(glow, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      R.scene.add(mesh);
      FX.bursts.push({ mesh, mat, t: 0, dur: 1, s0: 1, s1: 1, flat: false, a0: 1, on: false });
    }
    FX._geo = { glow, ring: ringG, star };

    FX.setLevel(RV.settings.effects);
    FX.ready = true;
  };

  /** Start an additive burst. kind: glow | ring | star. flat = lies on the ground instead of facing the camera. */
  FX._burst = function (kind, x, y, z, s0, s1, dur, color, a0, flat) {
    let b = null;
    for (const c of FX.bursts) if (!c.on) {
      b = c;
      break;
    }
    if (!b) b = FX.bursts.reduce((m, c) => (c.t / c.dur > m.t / m.dur ? c : m), FX.bursts[0]);
    b.mesh.geometry = FX._geo[kind];
    b.mat.color.setHex(color);
    b.mesh.position.set(x, y, z);
    b.s0 = s0;
    b.s1 = s1;
    b.dur = dur;
    b.t = 0;
    b.a0 = a0;
    b.flat = !!flat;
    b.on = true;
    b.mesh.visible = true;
    if (flat) b.mesh.rotation.set(-Math.PI / 2, 0, 0);
    b.mesh.scale.setScalar(s0);
    b.mat.opacity = a0;
  };

  FX._hideDecal = function (i) {
    FX._m.makeScale(0, 0, 0);
    FX.decals.setMatrixAt(i, FX._m);
  };

  FX.setLevel = function (level) {
    const L = LEVELS[level] || LEVELS.high;
    FX.level = level;
    FX.cap = L.particles;
    FX.cfg = L;
    FX.decalCap = L.decals;
    if (L.particles === 0) FX.clear();
    if (FX.decals) {
      for (let i = L.decals; i < FX.decalMax; i++) {
        FX.decalAge[i] = -1;
        FX._hideDecal(i);
      }
      FX.decals.instanceMatrix.needsUpdate = true;
    }
  };

  FX.clear = function () {
    if (!FX.ready) return;
    FX.life.fill(0);
    for (let i = 0; i < N; i++) FX.col[i * 4 + 3] = 0;
    FX.points.geometry.attributes.color.needsUpdate = true;
    for (let i = 0; i < FX.decalMax; i++) {
      FX.decalAge[i] = -1;
      FX._hideDecal(i);
    }
    FX.decals.instanceMatrix.needsUpdate = true;
    for (const b of FX.bursts || []) {
      b.on = false;
      b.mesh.visible = false;
    }
  };

  /** Screen-space scale for point sizes: pixels per world unit at distance 1. */
  FX.setView = function (vfovDeg, heightPx) {
    FX.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((vfovDeg * Math.PI) / 360));
  };

  function spawn(x, y, z, vx, vy, vz, size, r, g, b, a, life, grav, grow) {
    if (FX.cap <= 0) return;
    // reuse the oldest slot within the active cap
    const i = FX.next % FX.cap;
    FX.next++;
    FX.pos[i * 3] = x;
    FX.pos[i * 3 + 1] = y;
    FX.pos[i * 3 + 2] = z;
    FX.vel[i * 3] = vx;
    FX.vel[i * 3 + 1] = vy;
    FX.vel[i * 3 + 2] = vz;
    FX.size0[i] = size;
    FX.size[i] = size;
    FX.col[i * 4] = r;
    FX.col[i * 4 + 1] = g;
    FX.col[i * 4 + 2] = b;
    FX.col[i * 4 + 3] = a;
    FX.alpha0[i] = a;
    FX.life[i] = life;
    FX.maxLife[i] = life;
    FX.grav[i] = grav;
    FX.grow[i] = grow;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  /**
   * An impact at (x,y,z) with surface normal (nx,ny,nz).
   * kind: 'wall' (dust + sparks + bullet hole) or 'flesh' (small red burst).
   */
  FX.impact = function (x, y, z, nx, ny, nz, kind) {
    if (!FX.ready || FX.cap <= 0) return;
    const L = FX.cfg;
    if (kind === 'flesh') {
      const n = Math.max(2, L.dust + 1);
      for (let i = 0; i < n; i++) {
        const sp = rnd(1.5, 3.5);
        spawn(x, y, z, nx * sp + rnd(-1, 1), ny * sp + rnd(0, 1.2), nz * sp + rnd(-1, 1), rnd(0.05, 0.09), 1, i % 2 ? 0.35 : 1, i % 2 ? 0.35 : 1, 0.9, rnd(0.25, 0.42), 6, 0);
      }
      return;
    }
    for (let i = 0; i < L.dust; i++) {
      const sp = rnd(0.5, 1.5);
      spawn(x, y, z, nx * sp + rnd(-0.7, 0.7), ny * sp + rnd(0, 0.6), nz * sp + rnd(-0.7, 0.7), rnd(0.1, 0.16), 0.86, 0.84, 0.78, 0.5, rnd(0.4, 0.65), 1.2, 0.5);
    }
    for (let i = 0; i < L.sparks; i++) {
      const sp = rnd(2.5, 6);
      spawn(x, y, z, nx * sp + rnd(-2, 2), ny * sp + rnd(-1, 2), nz * sp + rnd(-2, 2), rnd(0.03, 0.05), 1, 0.86, 0.45, 1, rnd(0.18, 0.34), 9, 0);
    }
    FX._decal(x, y, z, nx, ny, nz);
  };

  /** A punch connecting: a tiny star flash and a few sparks (restrained). */
  FX.punch = function (x, y, z) {
    if (!FX.ready || FX.level === 'off') return;
    FX._burst('star', x, y, z, 0.12, 0.45, 0.14, 0xffffff, 0.9, false);
    const n = Math.min(FX.cap, FX.level === 'low' ? 3 : 6);
    for (let i = 0; i < n; i++) {
      const sp = rnd(1.5, 3.5);
      spawn(x, y, z, rnd(-sp, sp), rnd(0, sp), rnd(-sp, sp), rnd(0.03, 0.05), 1, 0.9, 0.6, 1, rnd(0.15, 0.28), 8, 0);
    }
  };

  /** Double-jump ring: a thin teal shock ring on the ground under the player. */
  FX.ring = function (x, y, z) {
    if (!FX.ready || FX.level === 'off') return;
    FX._burst('ring', x, y + 0.04, z, 0.5, 2.4, 0.38, 0x5eead4, 0.8, true);
  };

  /** Grenade blast: short flash, shock ring, fire + smoke puffs, a few sparks. Never fills the screen. */
  FX.explosion = function (x, y, z, radius) {
    if (!FX.ready) return;
    const low = FX.level === 'low';
    if (FX.level !== 'off') {
      FX._burst('glow', x, y, z, radius * 0.25, radius * 0.9, 0.2, 0xffd9a0, 0.95, false);
      FX._burst('ring', x, y + 0.05, z, radius * 0.2, radius * 1.1, 0.4, 0xffb060, 0.7, true);
    }
    const nf = Math.min(FX.cap, low ? 6 : 12);
    for (let i = 0; i < nf; i++) {
      const sp = rnd(2, 6);
      const a = Math.random() * 6.283;
      spawn(x, y, z, Math.cos(a) * sp, rnd(0.5, 4), Math.sin(a) * sp, rnd(0.5, 0.9), 1, rnd(0.45, 0.75), 0.18, 0.85, rnd(0.25, 0.42), -1, 1.4);
    }
    const ns = Math.min(FX.cap, low ? 4 : 9);
    for (let i = 0; i < ns; i++) {
      const sp = rnd(0.8, 2.6);
      const a = Math.random() * 6.283;
      spawn(x, y, z, Math.cos(a) * sp, rnd(1, 3), Math.sin(a) * sp, rnd(0.7, 1.2), 0.42, 0.42, 0.44, 0.4, rnd(0.6, 0.95), -1.5, 1.6);
    }
    const nk = Math.min(FX.cap, low ? 4 : 8);
    for (let i = 0; i < nk; i++) {
      const sp = rnd(5, 11);
      const a = Math.random() * 6.283;
      spawn(x, y, z, Math.cos(a) * sp, rnd(1, 7), Math.sin(a) * sp, rnd(0.04, 0.07), 1, 0.85, 0.4, 1, rnd(0.3, 0.55), 12, 0);
    }
  };

  FX._decal = function (x, y, z, nx, ny, nz) {
    if (FX.decalCap <= 0) return;
    const i = FX.decalNext % FX.decalCap;
    FX.decalNext++;
    const n = FX._n.set(nx, ny, nz).normalize();
    FX._q.setFromUnitVectors(FX._z, n);
    FX._q2.setFromAxisAngle(n, Math.random() * 6.283);
    FX._q.premultiply(FX._q2);
    const s = rnd(0.15, 0.22);
    FX._p.set(x + n.x * 0.012, y + n.y * 0.012, z + n.z * 0.012);
    FX._s.set(s, s, s);
    FX._m.compose(FX._p, FX._q, FX._s);
    FX.decals.setMatrixAt(i, FX._m);
    FX.decals.instanceMatrix.needsUpdate = true;
    const b = FX.decalBase;
    b[i * 8] = FX._p.x;
    b[i * 8 + 1] = FX._p.y;
    b[i * 8 + 2] = FX._p.z;
    b[i * 8 + 3] = FX._q.x;
    b[i * 8 + 4] = FX._q.y;
    b[i * 8 + 5] = FX._q.z;
    b[i * 8 + 6] = FX._q.w;
    b[i * 8 + 7] = s;
    FX.decalAge[i] = 0;
  };

  FX.update = function (dt) {
    if (!FX.ready) return;
    let any = false;
    for (let i = 0; i < N; i++) {
      const l = FX.life[i];
      if (l <= 0) continue;
      any = true;
      const nl = l - dt;
      FX.life[i] = nl;
      if (nl <= 0) {
        FX.col[i * 4 + 3] = 0;
        continue;
      }
      FX.vel[i * 3 + 1] -= FX.grav[i] * dt;
      FX.pos[i * 3] += FX.vel[i * 3] * dt;
      FX.pos[i * 3 + 1] += FX.vel[i * 3 + 1] * dt;
      FX.pos[i * 3 + 2] += FX.vel[i * 3 + 2] * dt;
      const k = nl / FX.maxLife[i];
      FX.col[i * 4 + 3] = FX.alpha0[i] * k;
      FX.size[i] = FX.size0[i] * (1 + FX.grow[i] * (1 - k));
    }
    if (any || FX._dirty) {
      const a = FX.points.geometry.attributes;
      a.position.needsUpdate = true;
      a.color.needsUpdate = true;
      a.size.needsUpdate = true;
      FX._dirty = any;
    }
    // bursts: scale up and fade
    for (const b of FX.bursts) {
      if (!b.on) continue;
      b.t += dt;
      const u = b.t / b.dur;
      if (u >= 1) {
        b.on = false;
        b.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - u) * (1 - u);
      b.mesh.scale.setScalar(b.s0 + (b.s1 - b.s0) * e);
      b.mat.opacity = b.a0 * (1 - u) * (1 - u * 0.4);
      if (!b.flat) b.mesh.quaternion.copy(FX.R.camera.quaternion);
    }
    // bullet holes fade out by shrinking over the last two seconds
    let changed = false;
    const LIFE = 14,
      FADE = 2;
    for (let i = 0; i < FX.decalCap; i++) {
      const age = FX.decalAge[i];
      if (age < 0) continue;
      const na = age + dt;
      FX.decalAge[i] = na;
      if (na > LIFE - FADE) {
        const b = FX.decalBase;
        const k = Math.max(0, (LIFE - na) / FADE);
        if (na >= LIFE) {
          FX.decalAge[i] = -1;
          FX._hideDecal(i);
        } else {
          FX._q.set(b[i * 8 + 3], b[i * 8 + 4], b[i * 8 + 5], b[i * 8 + 6]);
          FX._p.set(b[i * 8], b[i * 8 + 1], b[i * 8 + 2]);
          const s = b[i * 8 + 7] * k;
          FX._s.set(s, s, s);
          FX._m.compose(FX._p, FX._q, FX._s);
          FX.decals.setMatrixAt(i, FX._m);
        }
        changed = true;
      }
    }
    if (changed) FX.decals.instanceMatrix.needsUpdate = true;
  };

  /** Make every pooled object visible/used once so shaders compile before the first real shot. */
  FX.warm = function () {
    if (!FX.ready) return;
    const old = FX.cap;
    FX.cap = Math.max(old, 1);
    spawn(0, -1000, 0, 0, 0, 0, 0.001, 1, 1, 1, 0.01, 0.05, 0, 0);
    FX.cap = old;
    FX._decal(0, -1000, 0, 0, 1, 0);
    FX.decalAge[(FX.decalNext - 1) % Math.max(1, FX.decalCap)] = LIFE_SHORT;
  };
  const LIFE_SHORT = 13.99;
})();
