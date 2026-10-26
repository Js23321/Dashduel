/* DASHDUEL - map definitions.
 *
 * Maps are plain data built with a tiny builder. Units are metres, +Y up.
 *   box / deck / pillar : axis-aligned solid blocks
 *   ramp                : axis-aligned wedge (walkable, slideable, launches you)
 *   wall                : a box whose vertical faces can be wall-run
 *   pad                 : launch pad (trigger on top of a thin solid)
 *   cp                  : time trial checkpoint ring (last one is the finish)
 *   decor / beacon      : non-colliding scenery for orientation
 *
 * Colours: pass a number, or a palette ROLE name ('floor', 'plat', 'block'...).
 * Roles that hold a list (plat, platLight, block) cycle through the list, which
 * is what gives every map its toy-block colour mix.
 */
(function () {
  'use strict';
  const RV = window.RV;

  /** Accent colours used for trims, beacons and checkpoints. */
  const COL = {
    cyan: 0x00b8d9,
    magenta: 0xd946ef,
    lime: 0x65d000,
    orange: 0xff7a00,
    yellow: 0xffc300,
    red: 0xff4d4d,
    blue: 0x3b82f6,
    white: 0xffffff,
  };

  /** One palette per map theme. */
  const PAL = {
    sunrise: {
      floor: 0xe6dcc0,
      ramp: 0xb9c9dd,
      ceil: 0x8c7ab8,
      wallTop: 0x2bb3a8,
      plat: [0x4d96ff, 0x2ec4b6, 0xff7aa8, 0xffc94d],
      platLight: [0xfff1c1, 0xdff3ff],
      block: [0xff9f43, 0x9b5de5],
    },
    dusk: {
      floor: 0xecd2b8,
      ramp: 0xe8b9a3,
      ceil: 0x7c5cff,
      wallTop: 0x2bb3a8,
      plat: [0xff7b54, 0xffb347, 0xf25f8c, 0x7c5cff],
      platLight: [0xfff0d6, 0xffd9c2],
      block: [0x7c5cff, 0x38bdf8, 0xff7b54],
    },
    meadow: {
      floor: 0x93cf6a,
      ramp: 0xf2d49b,
      ceil: 0xb184ff,
      wallTop: 0x2bb3a8,
      plat: [0xff8a5b, 0x3ec1d3, 0xffd24d, 0xb184ff],
      platLight: [0xffffff, 0xffe4a8],
      block: [0xffb347, 0x6ec6ff, 0xff7aa8],
    },
    toy: {
      floor: 0xbfdff5,
      ramp: 0xffe08a,
      ceil: 0xb878ff,
      wallTop: 0x2bb3a8,
      plat: [0xff5d5d, 0xffd23f, 0x3ec5ff, 0x5ae07a],
      platLight: [0xffffff, 0xfff0b3],
      block: [0xff5d5d, 0xffd23f, 0x3ec5ff, 0x5ae07a, 0xb878ff],
    },
    candy: {
      floor: 0xe9d0e4,
      ramp: 0xd8b4fe,
      ceil: 0x8b5cf6,
      wallTop: 0x2bb3a8,
      plat: [0xff6fa5, 0x8b5cf6, 0xffb86b, 0x4cd0e1],
      platLight: [0xffffff, 0xfde2f3],
      block: [0xffb86b, 0x4cd0e1, 0xff6fa5],
    },
    arena: {
      floor: 0xd3d8e2,
      ramp: 0x9db7e0,
      ceil: 0x8c7ab8,
      wallTop: 0x2bb3a8,
      plat: [0xe9edf5, 0xbfcbe3, 0xdfe5f1, 0xa7bbe0],
      platLight: [0xffffff, 0xe3ebfa],
      block: [0x5b7fd6, 0xe9edf5, 0xff8a5b],
    },
    mint: {
      floor: 0xcfe9de,
      ramp: 0x99e0cf,
      ceil: 0x2dd4bf,
      wallTop: 0x2bb3a8,
      plat: [0x2dd4bf, 0xf472b6, 0xfacc15, 0x60a5fa],
      platLight: [0xffffff, 0xd1fae5],
      block: [0xf472b6, 0xfacc15, 0x60a5fa],
    },
  };

  function Builder(id, name, palName) {
    const pal = PAL[palName];
    const counters = {};
    const m = {
      id,
      name,
      palette: palName,
      solids: [],
      pads: [],
      checkpoints: [],
      spawns: [],
      decor: [],
      beacons: [],
      dummies: [],
      decals: [],
      killY: -60,
      clouds: 10,
      swatch: [pal.floor].concat(pal.plat.slice(0, 3)),
    };
    function colour(c, role) {
      const v = c == null ? role : c;
      if (typeof v === 'number') return v;
      const e = pal[v];
      if (Array.isArray(e)) {
        counters[v] = counters[v] || 0;
        return e[counters[v]++ % e.length];
      }
      return e;
    }
    const api = {
      m,
      /** Block from min/max corners. o: {c: colour|role, trim: colour, wall: bool} */
      boxMM(x0, y0, z0, x1, y1, z1, o) {
        o = o || {};
        const s = {
          type: 'box',
          min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
          max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
          color: colour(o.c, 'plat'),
          wall: !!o.wall,
          trim: o.trim,
          metal: !!o.metal,
          invisible: !!o.invisible, // collision only: the picture comes from a mesh (m.mesh)
        };
        // cover blocks get crate frames / pillar bases + neon rings when drawn
        if (o.detail) s.detail = o.detail;
        else if (o.c === 'block') {
          const w = s.max[0] - s.min[0],
            h = s.max[1] - s.min[1],
            d = s.max[2] - s.min[2];
          if (h >= 4.4 && w <= 3.8 && d <= 3.8) s.detail = 'pillar';
          else if (w <= 5.2 && d <= 5.2 && h <= 3.8 && h >= 0.9) s.detail = 'crate';
        }
        m.solids.push(s);
        return s;
      },
      /** Block from centre x/z, bottom y and size. */
      box(cx, y, cz, w, h, d, o) {
        return api.boxMM(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, o);
      },
      /** Platform whose top face is at `top`, `thick` deep. */
      deck(x0, x1, z0, z1, top, thick, o) {
        return api.boxMM(x0, top - (thick || 3), z0, x1, top, z1, o);
      },
      /** Runnable wall. */
      wall(x0, y0, z0, x1, y1, z1, o) {
        o = Object.assign({ c: 'wallTop' }, o || {});
        o.wall = true;
        return api.boxMM(x0, y0, z0, x1, y1, z1, o);
      },
      /** Wedge. `rise` is '+x' | '-x' | '+z' | '-z' (direction height increases). */
      ramp(x0, z0, x1, z1, yLow, yHigh, rise, o) {
        o = o || {};
        const s = {
          type: 'ramp',
          x0,
          z0,
          x1,
          z1,
          yLow,
          yHigh,
          rise,
          bottom: o.bottom != null ? o.bottom : Math.min(yLow, yHigh),
          color: colour(o.c, 'ramp'),
          trim: o.trim,
          invisible: !!o.invisible,
        };
        m.solids.push(s);
        return s;
      },
      /** Launch pad: `top` is the surface height. vel = [vx, vy, vz]. */
      pad(x, top, z, w, d, vel, keep) {
        m.pads.push({ x, y: top, z, w, d, vel, keep: keep != null ? keep : 0.3 });
        api.boxMM(x - w / 2, top - 0.25, z - d / 2, x + w / 2, top, z + d / 2, { c: 0x4b5a70, metal: true });
      },
      cp(x, y, z) {
        m.checkpoints.push({ x, y, z });
      },
      spawn(x, y, z, yaw) {
        // default: face the middle of the map
        m.spawns.push({ x, y, z, yaw: yaw != null ? yaw : Math.atan2(x, z) });
      },
      decor(x0, y0, z0, x1, y1, z1, color) {
        m.decor.push({ min: [x0, y0, z0], max: [x1, y1, z1], color });
      },
      /** Flat marking painted on a floor: t = ring | arrow | cross | stripe | dot | glow. rot 0 = pointing +z. */
      decal(t, x, z, size, color, rot, y, w) {
        m.decals.push({ t, x, z, size, color, rot: rot || 0, y: y || 0, w });
      },
      beacon(x, z, y0, y1, color, r) {
        m.beacons.push({ x, z, y0, y1, color, r: r || 1.2 });
      },
      /** Perimeter walls around [-hx,hx] x [-hz,hz] (inner faces), t thick, h tall. */
      perimeter(hx, hz, h, t) {
        t = t || 4;
        api.wall(-hx - t, -3, -hz - t, hx + t, h, -hz);
        api.wall(-hx - t, -3, hz, hx + t, h, hz + t);
        api.wall(-hx - t, -3, -hz, -hx, h, hz);
        api.wall(hx, -3, -hz, hx + t, h, hz);
      },
    };
    return api;
  }

  /** Bright daytime light rigs, one per theme. */
  const SKY = {
    sunrise: { hill: 0x5fa0b8, top: 0x3b8cff, bottom: 0xbfe3ff, fog: 0xcfe8ff, fogNear: 80, fogFar: 430, hemi: [0xffffff, 0xb7c7e8, 2.1], sun: [0xfff4e0, 1.68] },
    dusk: { hill: 0x8a5a9a, top: 0x5b4bd6, bottom: 0xffb59a, fog: 0xf6c0a8, fogNear: 70, fogFar: 320, hemi: [0xffe3d0, 0xb08ac0, 2.02], sun: [0xffd0a0, 1.6] },
    meadow: { hill: 0x4f9a56, top: 0x3f9bff, bottom: 0xd4f0ff, fog: 0xd4f0ff, fogNear: 90, fogFar: 480, hemi: [0xffffff, 0x9ec27a, 2.1], sun: [0xfff6e0, 1.68] },
    toy: { hill: 0x6aa7d8, top: 0x62c0ff, bottom: 0xfff2cc, fog: 0xfff2cc, fogNear: 70, fogFar: 300, hemi: [0xffffff, 0xc9d3ea, 2.1], sun: [0xfff0d0, 1.6] },
    candy: { hill: 0xb06ad0, top: 0x8b5cf6, bottom: 0xffc2e0, fog: 0xffd6ea, fogNear: 70, fogFar: 300, hemi: [0xfff0f8, 0xc4a7e8, 2.02], sun: [0xffe0f0, 1.6] },
    arena: { hill: 0x7f93c4, top: 0x5aa8ff, bottom: 0xe6f1ff, fog: 0xe6f1ff, fogNear: 80, fogFar: 360, hemi: [0xffffff, 0xc3cde6, 2.1], sun: [0xfff6e6, 1.62] },
    mint: { hill: 0x3fb596, top: 0x38bdf8, bottom: 0xe0f7fa, fog: 0xe0f7fa, fogNear: 70, fogFar: 300, hemi: [0xffffff, 0xa7d8c9, 2.1], sun: [0xf0fff8, 1.6] },
    // the maps made in Blender (tools/blender/build_*.py)
    city: { hill: 0x8fa0b5, top: 0x4f9bff, bottom: 0xdcecff, fog: 0xdbe8f5, fogNear: 100, fogFar: 380, hemi: [0xffffff, 0xb9c3d6, 2.15], sun: [0xfff3dc, 1.6] },
    field: { hill: 0x5f9e5a, top: 0x3f8fff, bottom: 0xd9f0ff, fog: 0xd4ecff, fogNear: 120, fogFar: 520, hemi: [0xffffff, 0x9ec27a, 2.15], sun: [0xfff6e0, 1.7] },
    harbour: { hill: 0x5d7388, top: 0x3a72d8, bottom: 0xffe0bd, fog: 0xe9dccb, fogNear: 100, fogFar: 430, hemi: [0xfff0dd, 0x9fb4c8, 2.1], sun: [0xffd9a8, 1.55] },
    western: { hill: 0xc8925a, top: 0x4c9aff, bottom: 0xffe4b8, fog: 0xf2dfc0, fogNear: 110, fogFar: 470, hemi: [0xfff4e0, 0xd2b48a, 2.15], sun: [0xfff0d0, 1.75] },
    // enclosed: no sun, hills or clouds are drawn; a short yellow haze and a strong ambient light keep every corridor readable
    office: { indoor: true, hill: 0xb7a54e, top: 0xe8dca0, bottom: 0xe8dca0, fog: 0xd8c874, fogNear: 28, fogFar: 95, hemi: [0xfff6c8, 0xd9c577, 2.7], sun: [0xfff1b0, 0.55] },
  };

  // ===========================================================================
  // GAUNTLET - time trial. A one-way speed course: slide, gap, wall run,
  // launch pad, slide tunnel, wall-jump zig-zag, ramp jump.
  // ===========================================================================
  function gauntlet() {
    const b = Builder('gauntlet', 'Gauntlet', 'sunrise');
    const m = b.m;
    m.desc = 'A one-way speed course. Slide the hill, wall-run the pit, ride the pad, duck the tunnel, zig-zag the walls and launch off the final ramp.';
    m.modes = ['timetrial', 'practice'];
    m.size = 'Course';
    m.sky = SKY.sunrise;
    m.killY = -45;

    // 1. start deck + slide hill
    b.deck(-9, 9, -6, 14, 0, 3, { c: 'platLight', trim: COL.lime });
    b.ramp(-7, -42, 7, -6, -8, 0, '+z', { bottom: -11, trim: COL.cyan });
    // 2. run-out then 6m gap
    b.deck(-7, 7, -62, -42, -8, 3, { c: 'plat', trim: COL.cyan });
    b.deck(-7, 7, -90, -68, -8, 3, { c: 'plat', trim: COL.cyan });
    // 3. wall-run wall along the pit, then landing deck
    b.wall(-9, -22, -120, -7, 4, -84);
    b.deck(-7, 7, -146, -120, -12, 3, { c: 'plat', trim: COL.magenta });
    // 4. launch pad -> high deck
    b.pad(0, -12, -137, 6, 6, [0, 25.5, -16], 0.3);
    b.deck(-8, 8, -206, -152, -4, 3, { c: 'platLight', trim: COL.orange });
    // slide tunnel (clearance 1.25m: sliding fits, standing does not)
    b.boxMM(-8, -2.75, -190, 8, 1.2, -172, { c: 'ceil', trim: COL.orange });
    b.boxMM(-10, -10, -190, -8, 1.2, -172, { c: 'ceil' });
    b.boxMM(8, -10, -190, 10, 1.2, -172, { c: 'ceil' });
    // 5. wall-jump zig-zag corridor (faces 6m apart, long overlaps so the jump window is generous)
    b.wall(-6, -24, -238, -3, 4, -206);
    b.wall(3, -24, -254, 6, 4, -222);
    b.wall(-6, -24, -270, -3, 4, -238);
    b.wall(3, -24, -286, 6, 4, -254);
    // 6. run-in, ramp, 8m gap, finish deck
    b.deck(-7, 7, -324, -286, -12, 3, { c: 'plat', trim: COL.lime });
    b.ramp(-7, -344, 7, -324, -12, -6.5, '-z', { bottom: -15, trim: COL.yellow });
    b.deck(-11, 11, -388, -352, -10, 3, { c: 'platLight', trim: COL.yellow });

    // start grid, chevrons along the course and landing rings
    b.decal('stripe', 0, 12.2, 18, COL.yellow, 0, 0, 1.6);
    b.decal('arrow', 0, 3, 5, COL.lime, Math.PI, 0);
    b.decal('arrow', 0, -1.5, 5, COL.lime, Math.PI, 0);
    b.decal('arrow', 0, -48, 6, COL.cyan, Math.PI, -8);
    b.decal('ring', 0, -78, 9, COL.cyan, 0, -8);
    b.decal('ring', 0, -133, 9, COL.magenta, 0, -12);
    b.decal('arrow', 0, -160, 6, COL.orange, Math.PI, -4);
    b.decal('arrow', 0, -300, 6, COL.lime, Math.PI, -12);
    b.decal('stripe', 0, -352.6, 20, COL.yellow, 0, -10, 1.4);
    b.decal('cross', 0, -370, 12, COL.yellow, 0, -10);
    b.spawn(0, 0, 9, 0);
    m.dummies = [
      { x: -5, y: 0, z: -1, yaw: 0 },
      { x: 5, y: 0, z: -1, yaw: 0 },
    ];
    // checkpoints (ring centre heights)
    b.cp(0, -6.2, -52);
    b.cp(0, -6.2, -78);
    b.cp(0, -10.2, -132);
    b.cp(0, -2.2, -163);
    b.cp(0, -2.2, -201);
    b.cp(0, -10.2, -306);
    b.cp(0, -8.2, -368); // finish

    // scenery / landmarks
    b.decor(-10.3, 0, -3, -9.7, 9, -2.4, COL.lime);
    b.decor(9.7, 0, -3, 10.3, 9, -2.4, COL.lime);
    b.decor(-10.3, 8.4, -3, 10.3, 9, -2.4, COL.lime);
    b.beacon(-30, -52, -8, 80, COL.cyan);
    b.beacon(30, -100, -8, 90, COL.magenta);
    b.beacon(-30, -140, -13, 90, COL.magenta);
    b.beacon(32, -170, -4, 90, COL.orange);
    b.beacon(-34, -250, -10, 90, COL.cyan);
    b.beacon(30, -314, -12, 90, COL.lime);
    b.beacon(0, -430, -8, 140, COL.yellow, 2.5);
    // pastel hills / towers in the distance
    const rng = RV.makeRng(7);
    const tint = [0xb7c3ee, 0xc7b8ee, 0xa8d4ee, 0xd7bde8];
    for (let i = 0; i < 40; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * (70 + rng() * 170);
      const z = 40 - rng() * 520;
      const w = 12 + rng() * 22,
        h = 20 + rng() * 80,
        d = 12 + rng() * 22;
      b.decor(x - w / 2, -60, z - d / 2, x + w / 2, -60 + h, z + d / 2, tint[i % tint.length]);
    }
    m.clouds = 14;
    return m;
  }

  // ===========================================================================
  // YARD - practice field. Stations for every mechanic + a shooting range.
  // ===========================================================================
  function yard() {
    const b = Builder('yard', 'The Yard', 'meadow');
    const m = b.m;
    m.desc = 'A huge open practice field: slide hills, wall-run walls, gap lanes, launch pads, a bunny-hop lane, stairs and a shooting range with targets at every distance.';
    m.modes = ['practice', 'arena'];
    m.size = 'Huge';
    m.sky = SKY.meadow;
    m.killY = -40;

    const R = 120;
    b.boxMM(-R - 4, -3, -R - 4, R + 4, 0, R + 4, { c: 'floor' });
    b.perimeter(R, R, 14, 4);

    // A. north: slide hills
    b.ramp(-10, -50, 10, -30, 0, 6, '-z', { trim: COL.cyan }); // up
    b.boxMM(-10, 0, -62, 10, 6, -50, { c: 'plat', trim: COL.cyan });
    b.ramp(-10, -82, 10, -62, 0, 6, '+z', { trim: COL.cyan }); // down
    b.ramp(22, -52, 40, -30, 0, 9, '-z', { trim: COL.magenta }); // steeper
    b.boxMM(22, 0, -64, 40, 9, -52, { c: 'plat', trim: COL.magenta });
    b.ramp(22, -88, 40, -64, 0, 9, '+z', { trim: COL.magenta });
    b.ramp(-40, -52, -22, -30, 0, 12, '-z', { trim: COL.orange }); // steepest
    b.boxMM(-40, 0, -68, -22, 12, -52, { c: 'plat', trim: COL.orange });
    b.ramp(-40, -94, -22, -68, 0, 12, '+z', { trim: COL.orange });

    // B. west: wall-run field
    b.wall(-52, 0, -20, -49, 14, 40); // long single wall (face +x at -49)
    b.wall(-74, 0, -20, -71, 14, 40); // double corridor (6m): faces at -71 / -65
    b.wall(-65, 0, -20, -62, 14, 40);
    for (let i = 0; i < 4; i++) {
      // zig-zag (faces 6m apart, alternate sides, 6m overlap)
      const z0 = 44 + i * 16;
      if (i % 2 === 0) b.wall(-100, 0, z0, -97, 14, z0 + 22);
      else b.wall(-91, 0, z0, -88, 14, z0 + 22);
    }

    // C. south-east: gap lanes (platforms 6 long, top 3)
    function lane(z, gaps, trim) {
      let x = 20;
      b.deck(x, x + 6, z - 4, z + 4, 3, 3, { c: 'platLight', trim });
      x += 6;
      for (const g of gaps) {
        x += g;
        b.deck(x, x + 6, z - 4, z + 4, 3, 3, { c: 'plat', trim });
        x += 6;
      }
    }
    lane(36, [5, 7, 9, 11], COL.lime);
    lane(52, [12, 14, 16, 18], COL.yellow);
    lane(68, [20, 22, 24], COL.red);
    // run-up ramps onto each lane's first platform
    for (const [z, c] of [
      [36, COL.lime],
      [52, COL.yellow],
      [68, COL.red],
    ])
      b.ramp(2, z - 4, 20, z + 4, 0, 3, '+x', { trim: c });
    // D. launch pads and towers
    b.pad(60, 0, -20, 6, 6, [0, 22, -15.8], 0.2);
    b.deck(52, 70, -50, -34, 5.5, 5.5, { c: 'plat', trim: COL.cyan });
    b.pad(86, 0, -20, 6, 6, [0, 28, -17.1], 0.2);
    b.deck(77, 95, -56, -38, 11, 11, { c: 'plat', trim: COL.magenta });
    b.pad(106, 0, -20, 6, 6, [0, 34, -17.5], 0.2);
    b.deck(97, 115, -64, -44, 17, 17, { c: 'plat', trim: COL.orange });

    // E. east: bunny-hop lane with hurdles
    for (let i = 0; i < 6; i++) {
      const h = [0.5, 0.8, 1.0, 1.2, 0.8, 1.4][i];
      b.box(40 + i * 12, 0, 0, 1.5, h, 10, { c: 'block', trim: i % 2 ? COL.yellow : COL.red });
    }
    // F. stairs (step-up test) and a few crates
    for (let i = 0; i < 10; i++) b.boxMM(-30, 0, 20 + i * 2, -22, 0.4 * (i + 1), 22 + i * 2, { c: 'plat' });
    b.box(-14, 0, 14, 4, 1.2, 4, { c: 'block' });
    b.box(-10, 0, 20, 4, 2.4, 4, { c: 'block' });
    b.box(14, 0, 14, 5, 1.8, 5, { c: 'block' });
    b.box(20, 0, -14, 6, 3.2, 6, { c: 'block' });
    // scatter cover for arena fights
    for (const [x, z, h] of [
      [-14, -14, 3],
      [14, -22, 2.4],
      [30, 10, 4],
      [-30, -20, 3.6],
      [8, 40, 3],
      [-8, 56, 4],
      [100, 20, 3],
      [88, 60, 4],
      [-60, -60, 4],
      [60, 90, 3],
    ])
      b.box(x, 0, z, 4, h, 4, { c: 'block', trim: COL.blue });

    const sp = [
      [0, 0, 0, 0],
      [30, 0, -10],
      [-20, 0, 40],
      [60, 0, 30],
      [-60, 0, -40],
      [90, 0, -80],
      [-40, 0, 100],
      [40, 0, 100],
      [-100, 0, -80],
      [100, 0, 100],
    ];
    for (const s of sp) b.spawn(s[0], s[1], s[2], s[3]);

    // practice dummies: close ones for warm-up, plus a range down the +Z lane
    m.dummies = [
      { x: 8, y: 0, z: -14 },
      { x: -8, y: 0, z: -14 },
      { x: 0, y: 0, z: -26 },
      { x: 16, y: 0, z: -8, pace: { dx: 0, dz: 10, speed: 0.6 } },
      { x: -16, y: 0, z: -8, pace: { dx: 10, dz: 0, speed: 0.8 } },
      { x: 0, y: 0, z: 22 },
      { x: 4, y: 0, z: 42, yaw: Math.PI },
      { x: -4, y: 0, z: 64, yaw: Math.PI },
      { x: 0, y: 0, z: 90, yaw: Math.PI, pace: { dx: 12, dz: 0, speed: 0.5 } },
    ];
    // range markers every 20 m down the lane
    for (let i = 1; i <= 5; i++) b.decor(-7, 0, 20 * i + 2, 7, 0.03, 20 * i + 2.5, i % 2 ? COL.orange : COL.cyan);

    for (const z of [14, 34, 54, 74, 94]) b.decal('arrow', 0, z, 5, COL.orange, 0, 0);
    for (const z of [28, 66]) b.decal('ring', 0, z, 11, COL.cyan, 0, 0);
    for (let i = 0; i < 6; i++) b.decal('arrow', 45 + i * 12, 8, 4, COL.yellow, -Math.PI / 2, 0);
    b.decal('cross', 0, 0, 14, COL.white, 0, 0);
    b.beacon(0, -100, 0, 90, COL.cyan);
    b.beacon(-76, 15, 0, 90, COL.magenta);
    b.beacon(50, 52, 0, 90, COL.lime);
    b.beacon(85, -50, 0, 100, COL.orange);
    b.beacon(80, 0, 0, 90, COL.red);
    b.beacon(-26, 30, 0, 70, COL.yellow);
    for (let i = 0; i <= 10; i++) b.decor(40 + i * 10, 0, -6, 40.4 + i * 10, 0.02, 6, i % 5 === 0 ? COL.yellow : 0xffffff);
    m.clouds = 16;
    return m;
  }

  // ===========================================================================
  // MAPS MADE IN BLENDER. tools/blender/build_<id>.py authors each one (boxes / ramps / prisms, collections per map) and exports
  //   js/mapdata-<id>.js   collision solids + spawns (loaded by the browser AND by the server)
  //   js/mesh-<id>.js      the triangles of the picture (browser only; if it is missing the solids are drawn as plain boxes)
  // Both come from the same Blender scene, so what you see is what you collide with. Here only the per-map settings live.
  // ===========================================================================
  const FALLBACK = 0x9aa3b2;
  function fromData(id, name, palName, cfg) {
    const md = RV.mapdata && RV.mapdata[id];
    if (!md) return null; // data file missing: the map is simply not offered (never a broken map)
    const b = Builder(id, name, palName);
    const m = b.m;
    for (const s of md.solids) {
      if (s[0] === 'b') b.boxMM(s[1], s[2], s[3], s[4], s[5], s[6], { c: FALLBACK, invisible: true, wall: s[7] === 1 });
      else b.ramp(s[1], s[2], s[3], s[4], s[5], s[6], s[7], { c: FALLBACK, invisible: true, bottom: s[8] });
    }
    for (const sp of md.spawns) b.spawn(sp[0], sp[1], sp[2], sp.length > 3 ? sp[3] : undefined);
    m.dummies = md.dummies.map((d) => ({ x: d[0], y: d[1], z: d[2], yaw: d[3] }));
    m.mesh = id;
    m.meshColor = FALLBACK;
    m.modes = ['duel', 'arena', 'practice'];
    Object.assign(m, cfg);
    return m;
  }

  /** Add a map to the registry (used below, and by the archived maps-legacy.js). */
  RV.registerMap = function (m, last) {
    if (!m) return;
    RV.maps[m.id] = m;
    if (RV.mapOrder.indexOf(m.id) < 0) RV.mapOrder.splice(last ? RV.mapOrder.length : RV.mapOrder.indexOf('yard') >= 0 ? RV.mapOrder.indexOf('yard') : RV.mapOrder.length, 0, m.id);
    // maps that support the 1v1 duel are also online 1v1 maps
    if (m.modes.indexOf('duel') >= 0 && m.modes.indexOf('online') < 0) m.modes.push('online');
    // ... and every one of them has an always-running free-for-all room on the server
    if (m.modes.indexOf('duel') >= 0 && m.modes.indexOf('ffa') < 0) m.modes.push('ffa');
  };

  RV.maps = {};
  RV.mapOrder = [];
  // the active pool, in menu order
  RV.registerMap(
    fromData('testarena', 'Arena', 'arena', {
      desc: 'The duel arena: a walled rectangle of white panelled concrete. A long ramp leads to a high ledge on each side wall, a catwalk bridges the middle over a low plinth, turned slabs and a tall bar break the floor, and a hollowed gate hides each spawn.',
      size: 'Compact',
      sky: SKY.arena,
      killY: -30,
      play: [-14, -22, 14, 22, 14], // the invisible fence: the inner faces of the outer walls (and a ceiling 4 m above them)
      barrier: { y0: 10, y1: 14, color: 0x5fd4ff }, // ... drawn as a faint force field above the wall tops
      navStep: 1.5, // a tight map: the bots walking graph needs a fine grid
      clouds: 6,
      meshColor: 0xa9aeb8,
      swatch: [0xe9ebf0, 0xb4bbc8, 0x4a7bd6, 0xf0883a],
    })
  );
  RV.registerMap(
    fromData('bridge', 'Bridge', 'arena', {
      desc: 'A raised bridge crosses a city intersection with a yellow bus stopped on its middle. Fight on the high deck, under it on the street, or cut across by the stairs. Parked cars, barriers and buildings with windows.',
      size: 'Medium',
      sky: SKY.city,
      killY: -30,
      play: [-40, -30, 40, 30, 18],
      navStep: 2.0,
      clouds: 8,
      swatch: [0x4b5160, 0xffc533, 0x9aa2ae, 0xe8d8c4],
    })
  );
  RV.registerMap(
    fromData('crossroads', 'Crossroads', 'meadow', {
      desc: 'Two roads cross in an open field around a stepped stone monument. A stone fort and a warehouse (with their twins across the field) have windows, interiors and roofs; rock outcrops, hay and trees are the cover.',
      size: 'Large',
      sky: SKY.field,
      killY: -30,
      play: [-46, -46, 46, 46, 16],
      navStep: 2.5,
      clouds: 12,
      swatch: [0x7fcf6a, 0x555b66, 0xb9b3a6, 0xc7553d],
    })
  );
  RV.registerMap(
    fromData('docks', 'Docks', 'sunrise', {
      desc: 'A waterfront cargo yard: container alleys, a gantry crane, a harbour office and a warehouse to fight through. The north edge and the piers are open water - fall in and you are out.',
      size: 'Large',
      sky: SKY.harbour,
      killY: -5.5,
      play: [-46, -46, 46, 29.8, 16],
      water: { y: -2.4, color: 0x2a86c8, opacity: 0.88 },
      navStep: 2.0,
      clouds: 9,
      swatch: [0x2a86c8, 0xc0392b, 0xe67e22, 0xb8b5ad],
    })
  );
  RV.registerMap(
    fromData('station', 'Station', 'dusk', {
      desc: 'A Western railway station: two steam trains with an island platform between them, a station hall and a depot with two floors each. Fight through the carriages, along the platform or inside the buildings.',
      size: 'Large',
      sky: SKY.western,
      killY: -30,
      play: [-38, -30, 38, 30, 16],
      navStep: 2.0,
      clouds: 6,
      swatch: [0xb23a32, 0x2f5d8a, 0xc89a63, 0xd9b77e],
    })
  );
  RV.registerMap(
    fromData('backrooms', 'Backrooms', 'sunrise', {
      desc: 'An endless-looking office maze under buzzing lights: 4 m corridors, red carpet rooms, pool-tile rooms and a lit atrium with a raised platform in the middle. Corners everywhere, no sky.',
      size: 'Medium',
      sky: SKY.office,
      killY: -30,
      play: [-27.6, -27.6, 27.6, 27.6, 6],
      navStep: 1.6,
      clouds: 0,
      swatch: [0xd6c46a, 0x8e2b2b, 0x9fd8e0, 0x9c8a46],
    })
  );
  // the practice field and the time trial course are not part of the duel pool
  RV.registerMap(yard(), true);
  RV.registerMap(gauntlet(), true);
  RV.mapkit = { Builder, COL, PAL, SKY };

  // The pictures (js/mesh-<id>.js, 130 - 850 KB each) are not part of the first page load: they are fetched in the background once the
  // lobby is up, or on demand when a match on that map starts. A map whose picture cannot be fetched is still playable (its solids are
  // drawn as plain boxes), and the loader never blocks or throws.
  if (typeof document !== 'undefined') {
    const loads = {};
    const stamp = () => {
      const s = document.querySelector('script[src*="js/maps.js"]');
      const q = s && s.src.indexOf('?') >= 0 ? s.src.slice(s.src.indexOf('?')) : '';
      return q;
    };
    /** Promise<boolean>: the mesh of map `id` is available (true) or could not be loaded (false). */
    RV.loadMeshes = function (id) {
      const m = RV.maps[id];
      if (!m || !m.mesh || (RV.meshes && RV.meshes[m.mesh])) return Promise.resolve(true);
      if (!loads[m.mesh]) {
        loads[m.mesh] = new Promise((res) => {
          const el = document.createElement('script');
          el.src = 'js/mesh-' + m.mesh + '.js' + stamp();
          el.onload = () => res(!!(RV.meshes && RV.meshes[m.mesh]));
          el.onerror = () => res(false);
          document.head.appendChild(el);
        });
      }
      return loads[m.mesh];
    };
    /** Quietly fetch every map's picture, one at a time. */
    RV.preloadMeshes = async function () {
      for (const id of RV.mapOrder) {
        await RV.loadMeshes(id);
        await new Promise((r) => setTimeout(r, 300));
      }
    };
  }
  RV.COL = COL;
})();
