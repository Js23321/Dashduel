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
    mint: { hill: 0x3fb596, top: 0x38bdf8, bottom: 0xe0f7fa, fog: 0xe0f7fa, fogNear: 70, fogFar: 300, hemi: [0xffffff, 0xa7d8c9, 2.1], sun: [0xf0fff8, 1.6] },
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
  // VERTIGO - vertical arena. Central podium, corner decks, runnable
  // perimeter walls and diagonal launch pads.
  // ===========================================================================
  function vertigo() {
    const b = Builder('vertigo', 'Vertigo', 'dusk');
    const m = b.m;
    m.desc = 'A large vertical arena at dusk. Take the ramps, wall-run the perimeter between decks, or launch from the corner pads onto the central podium.';
    m.modes = ['arena', 'duel', 'practice'];
    m.size = 'Large';
    m.sky = SKY.dusk;
    m.killY = -30;

    b.boxMM(-46, -3, -46, 46, 0, 46, { c: 'floor' });
    b.perimeter(40, 40, 18, 4);

    // central podium + ramps
    b.boxMM(-9, 0, -9, 9, 6, 9, { c: 'platLight', wall: true, trim: COL.cyan });
    b.box(0, 6, 0, 4, 9, 4, { c: 'block', trim: COL.cyan });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 5.8, 6, sz * 5.8, 2.2, 1.2, 2.2, { c: 'block' });
    b.ramp(-4, -29, 4, -9, 0, 6, '+z', { trim: COL.cyan });
    b.ramp(-4, 9, 4, 29, 0, 6, '-z', { trim: COL.cyan });
    b.ramp(9, -4, 29, 4, 0, 6, '-x', { trim: COL.cyan });
    b.ramp(-29, -4, -9, 4, 0, 6, '+x', { trim: COL.cyan });

    // corner decks + ramps
    b.boxMM(26, 0, -40, 40, 6, -26, { c: 'plat', trim: COL.magenta });
    b.boxMM(-40, 0, -40, -26, 6, -26, { c: 'plat', trim: COL.orange });
    b.boxMM(26, 0, 26, 40, 6, 40, { c: 'plat', trim: COL.lime });
    b.boxMM(-40, 0, 26, -26, 6, 40, { c: 'plat', trim: COL.cyan });
    b.ramp(8, -37, 26, -29, 0, 6, '+x', { trim: COL.magenta });
    b.ramp(-26, -37, -8, -29, 0, 6, '-x', { trim: COL.orange });
    b.ramp(8, 29, 26, 37, 0, 6, '+x', { trim: COL.lime });
    b.ramp(-26, 29, -8, 37, 0, 6, '-x', { trim: COL.cyan });

    // mid-side decks (wall-run / launch access only)
    b.boxMM(-9, 0, -40, 9, 6, -34, { c: 'plat', trim: COL.yellow });
    b.boxMM(-9, 0, 34, 9, 6, 40, { c: 'plat', trim: COL.yellow });
    b.boxMM(-40, 0, -9, -34, 6, 9, { c: 'plat', trim: COL.yellow });
    b.boxMM(34, 0, -9, 40, 6, 9, { c: 'plat', trim: COL.yellow });

    // cover pillars
    for (const [x, z] of [
      [22, 12],
      [-22, 12],
      [22, -12],
      [-22, -12],
      [12, 22],
      [-12, 22],
      [12, -22],
      [-12, -22],
    ])
      b.box(x, 0, z, 3, 6, 3, { c: 'block', trim: COL.blue });

    // diagonal pads: ground -> podium top
    b.pad(15, 0, 15, 4, 4, [-7.2, 21, -7.2], 0.25);
    b.pad(-15, 0, 15, 4, 4, [7.2, 21, -7.2], 0.25);
    b.pad(15, 0, -15, 4, 4, [-7.2, 21, 7.2], 0.25);
    b.pad(-15, 0, -15, 4, 4, [7.2, 21, 7.2], 0.25);

    b.decal('ring', 0, 0, 62, COL.white, 0, 0);
    b.decal('ring', 0, 0, 46, COL.orange, 0, 0);
    b.decal('cross', 0, 0, 9, COL.orange, 0, 6);
    for (const [px, pz] of [[15, 15], [-15, 15], [15, -15], [-15, -15]]) b.decal('ring', px, pz, 8, COL.cyan, 0, 0);
    for (const [ax, az, rot] of [[0, -33, Math.PI], [0, 33, 0], [-33, 0, -Math.PI / 2], [33, 0, Math.PI / 2]]) b.decal('arrow', ax, az, 5, COL.magenta, rot, 0);
    m.dummies = [
      { x: -10, y: 0, z: -26, yaw: 0 },
      { x: 10, y: 0, z: -26, yaw: 0 },
      { x: 0, y: 0, z: -20, yaw: 0 },
      { x: -14, y: 0, z: -8, pace: { dx: 0, dz: 8, speed: 0.7 } },
    ];
    const sp = [
      [0, 0, -33, Math.PI],
      [0, 0, 33, 0],
      [-33, 0, 0, -Math.PI / 2],
      [33, 0, 0, Math.PI / 2],
      [20, 0, 20],
      [-20, 0, 20],
      [20, 0, -20],
      [-20, 0, -20],
      [30, 6, 30],
      [-30, 6, 30],
      [30, 6, -30],
      [-30, 6, -30],
    ];
    for (const s of sp) b.spawn(s[0], s[1], s[2], s[3]);

    b.beacon(0, 0, 14, 70, COL.cyan, 0.8);
    b.beacon(33, -33, 6, 60, COL.magenta);
    b.beacon(-33, -33, 6, 60, COL.orange);
    b.beacon(33, 33, 6, 60, COL.lime);
    b.beacon(-33, 33, 6, 60, COL.cyan);
    b.decor(-40, 14, -40.05, 40, 16, -39.95, COL.magenta);
    b.decor(-40, 14, 39.95, 40, 16, 40.05, COL.lime);
    b.decor(-40.05, 14, -40, -39.95, 16, 40, COL.orange);
    b.decor(39.95, 14, -40, 40.05, 16, 40, COL.cyan);
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
  // TOYBOX - compact duel arena. A stepped centre, four corner towers and
  // wall-run platforms along the sides. Mirror-symmetric, so every duel is fair.
  // ===========================================================================
  function toybox() {
    const b = Builder('toybox', 'Toybox', 'toy');
    const m = b.m;
    m.desc = 'A compact toy-block arena: a stepped centre, four corner towers, side platforms you reach by wall running, and pads that fling you onto the top tier.';
    m.modes = ['duel', 'arena', 'practice'];
    m.size = 'Compact';
    m.sky = SKY.toy;
    m.killY = -30;

    b.boxMM(-36, -3, -36, 36, 0, 36, { c: 'floor' });
    b.perimeter(32, 32, 14, 4);

    // stepped centre
    b.boxMM(-10, 0, -10, 10, 2.5, 10, { c: 'platLight', trim: COL.orange });
    b.boxMM(-5, 2.5, -5, 5, 5, 5, { c: 'plat', trim: COL.red });
    b.ramp(-3.5, -22, 3.5, -10, 0, 2.5, '+z', { trim: COL.orange });
    b.ramp(-3.5, 10, 3.5, 22, 0, 2.5, '-z', { trim: COL.orange });
    b.ramp(5, -3, 10, 3, 2.5, 5, '-x', { trim: COL.red });
    b.ramp(-10, -3, -5, 3, 2.5, 5, '+x', { trim: COL.red });

    // corner towers + ramps
    b.boxMM(17, 0, -27, 27, 4, -17, { c: 'plat', trim: COL.blue });
    b.ramp(5, -25, 17, -19, 0, 4, '+x', { trim: COL.blue });
    b.boxMM(-27, 0, -27, -17, 4, -17, { c: 'plat', trim: COL.lime });
    b.ramp(-17, -25, -5, -19, 0, 4, '-x', { trim: COL.lime });
    b.boxMM(17, 0, 17, 27, 4, 27, { c: 'plat', trim: COL.lime });
    b.ramp(5, 19, 17, 25, 0, 4, '+x', { trim: COL.lime });
    b.boxMM(-27, 0, 17, -17, 4, 27, { c: 'plat', trim: COL.blue });
    b.ramp(-17, 19, -5, 25, 0, 4, '-x', { trim: COL.blue });

    // side platforms along the walls (wall-run access)
    b.boxMM(-8, 0, -32, 8, 4, -27, { c: 'plat', trim: COL.yellow });
    b.boxMM(-8, 0, 27, 8, 4, 32, { c: 'plat', trim: COL.yellow });
    b.boxMM(-32, 0, -8, -27, 4, 8, { c: 'plat', trim: COL.yellow });
    b.boxMM(27, 0, -8, 32, 4, 8, { c: 'plat', trim: COL.yellow });

    // toy-cube cover
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.box(sx * 14, 0, sz * 9, 3, 2.4, 3, { c: 'block' });
        b.box(sx * 9, 0, sz * 17, 2.5, 1.5, 2.5, { c: 'block' });
        b.box(sx * 22, 0, sz * 8, 3, 3, 3, { c: 'block', trim: COL.white });
      }

    // pads: ground -> top tier
    b.pad(13, 0, 0, 4, 4, [-8, 20, 0], 0.2);
    b.pad(-13, 0, 0, 4, 4, [8, 20, 0], 0.2);

    const sp = [
      [0, 0, -24.5, Math.PI],
      [0, 0, 24.5, 0],
      [-24, 0, 0],
      [24, 0, 0],
      [22, 4, -22],
      [-22, 4, -22],
      [22, 4, 22],
      [-22, 4, 22],
    ];
    for (const s of sp) b.spawn(s[0], s[1], s[2], s[3]);
    m.dummies = [
      { x: 0, y: 0, z: -16 },
      { x: 12, y: 0, z: 14, yaw: Math.PI },
      { x: -12, y: 0, z: -14, pace: { dx: 8, dz: 0, speed: 0.8 } },
    ];
    b.decal('ring', 0, 0, 30, COL.orange, 0, 0);
    b.decal('ring', 0, 0, 22.5, COL.white, 0, 0);
    for (const sx of [-1, 1]) {
      b.decal('arrow', sx * 6.5, -19, 4, COL.orange, 0, 0);
      b.decal('arrow', sx * 6.5, 19, 4, COL.orange, Math.PI, 0);
      b.decal('ring', sx * 13, 0, 8, COL.yellow, 0, 0);
    }
    b.decal('cross', 0, -24.5, 6, COL.blue, 0, 0);
    b.decal('cross', 0, 24.5, 6, COL.blue, 0, 0);
    b.beacon(22, -22, 4, 50, COL.blue);
    b.beacon(-22, -22, 4, 50, COL.lime);
    b.beacon(22, 22, 4, 50, COL.lime);
    b.beacon(-22, 22, 4, 50, COL.blue);
    b.beacon(0, 0, 5, 60, COL.red, 0.7);
    m.clouds = 10;
    return m;
  }

  // ===========================================================================
  // SKYBRIDGE - compact duel arena built around a long high bridge between two
  // end platforms, with a lower ground route and pads that throw you up.
  // ===========================================================================
  function skybridge() {
    const b = Builder('skybridge', 'Skybridge', 'candy');
    const m = b.m;
    m.desc = 'Two end platforms joined by a long sky bridge. Fight on the bridge, underneath it, or ride the centre pads up. Ramps and wall-run walls connect everything.';
    m.modes = ['duel', 'arena', 'practice'];
    m.size = 'Compact';
    m.sky = SKY.candy;
    m.killY = -30;

    b.boxMM(-40, -3, -26, 40, 0, 26, { c: 'floor' });
    b.perimeter(36, 22, 14, 4);

    // end platforms + access ramps
    b.boxMM(26, 0, -22, 36, 5, 22, { c: 'plat', trim: COL.magenta });
    b.boxMM(-36, 0, -22, -26, 5, 22, { c: 'plat', trim: COL.cyan });
    b.ramp(14, -18, 26, -10, 0, 5, '+x', { trim: COL.magenta });
    b.ramp(14, 10, 26, 18, 0, 5, '+x', { trim: COL.magenta });
    b.ramp(-26, -18, -14, -10, 0, 5, '-x', { trim: COL.cyan });
    b.ramp(-26, 10, -14, 18, 0, 5, '-x', { trim: COL.cyan });

    // the bridge (walk under it: clearance 4m)
    b.boxMM(-26, 4, -3, 26, 5, 3, { c: 'platLight', trim: COL.yellow });
    // little cover on the bridge
    b.box(-10, 5, 0, 1.2, 1.2, 4, { c: 'block' });
    b.box(10, 5, 0, 1.2, 1.2, 4, { c: 'block' });

    // ground cover
    for (const [x, z, w, h, d] of [
      [-8, -11, 3, 2.4, 3],
      [8, -11, 3, 2.4, 3],
      [-8, 11, 3, 2.4, 3],
      [8, 11, 3, 2.4, 3],
      [-18, 0, 2.5, 3, 5],
      [18, 0, 2.5, 3, 5],
      [0, -17, 5, 1.5, 2],
      [0, 17, 5, 1.5, 2],
    ])
      b.box(x, 0, z, w, h, d, { c: 'block', trim: COL.white });

    // pads up to the bridge
    b.pad(0, 0, 11, 4, 4, [0, 20, -9], 0.2);
    b.pad(0, 0, -11, 4, 4, [0, 20, 9], 0.2);

    const sp = [
      [-31, 5, 0],
      [31, 5, 0],
      [-4, 0, -17],
      [4, 0, 17],
      [-12, 0, 18],
      [12, 0, -18],
      [-31, 5, -16],
      [31, 5, 16],
    ];
    for (const s of sp) b.spawn(s[0], s[1], s[2], s[3]);
    m.dummies = [
      { x: 0, y: 0, z: -17 + 4, yaw: 0 },
      { x: 18, y: 0, z: 8, yaw: Math.PI },
      { x: -18, y: 0, z: -8, pace: { dx: 0, dz: 8, speed: 0.7 } },
    ];
    b.decal('stripe', 0, -17.5, 8, COL.yellow, 0, 0, 3);
    b.decal('stripe', 0, 17.5, 8, COL.yellow, 0, 0, 3);
    b.decal('ring', 0, 11, 8, COL.cyan, 0, 0);
    b.decal('ring', 0, -11, 8, COL.cyan, 0, 0);
    b.decal('arrow', 0, 6, 5, COL.magenta, Math.PI, 0);
    b.decal('arrow', 0, -6, 5, COL.magenta, 0, 0);
    b.decal('cross', 0, 0, 12, COL.white, 0, 0);
    b.decal('arrow', 31, 8, 5, COL.magenta, Math.PI / 2, 5);
    b.decal('arrow', -31, -8, 5, COL.cyan, -Math.PI / 2, 5);
    b.beacon(31, 0, 5, 55, COL.magenta);
    b.beacon(-31, 0, 5, 55, COL.cyan);
    b.beacon(0, 0, 6, 60, COL.yellow, 0.7);
    m.clouds = 10;
    return m;
  }

  // ===========================================================================
  // PINWHEEL - compact duel arena with rotational symmetry: four corner decks,
  // a pinwheel of wall-run walls in the middle, and pads that throw you
  // clockwise onto the next deck.
  // ===========================================================================
  function pinwheel() {
    const b = Builder('pinwheel', 'Pinwheel', 'mint');
    const m = b.m;
    m.desc = 'Rotationally symmetric: four raised decks, a pinwheel of runnable walls in the middle and pads that fling you clockwise from deck to deck.';
    m.modes = ['duel', 'arena', 'practice'];
    m.size = 'Compact';
    m.sky = SKY.mint;
    m.killY = -30;

    b.boxMM(-32, -3, -32, 32, 0, 32, { c: 'floor' });
    b.perimeter(28, 28, 12, 4);

    // corner decks, each with a ramp rising along the pinwheel direction
    b.boxMM(14, 0, -26, 26, 4, -18, { c: 'plat', trim: COL.cyan });
    b.ramp(2, -26, 14, -18, 0, 4, '+x', { trim: COL.cyan });
    b.boxMM(18, 0, 14, 26, 4, 26, { c: 'plat', trim: COL.magenta });
    b.ramp(18, 2, 26, 14, 0, 4, '+z', { trim: COL.magenta });
    b.boxMM(-26, 0, 18, -14, 4, 26, { c: 'plat', trim: COL.orange });
    b.ramp(-14, 18, -2, 26, 0, 4, '-x', { trim: COL.orange });
    b.boxMM(-26, 0, -26, -18, 4, -14, { c: 'plat', trim: COL.lime });
    b.ramp(-26, -14, -18, -2, 0, 4, '-z', { trim: COL.lime });

    // pinwheel walls (runnable, 3.5 high) and a low centre block
    b.wall(-12, 0, -9.5, 2, 3.5, -8);
    b.wall(8, 0, -12, 9.5, 3.5, 2);
    b.wall(-2, 0, 8, 12, 3.5, 9.5);
    b.wall(-9.5, 0, -2, -8, 3.5, 12);
    b.boxMM(-4, 0, -4, 4, 1.4, 4, { c: 'platLight', trim: COL.yellow });

    // pads: each launches clockwise onto the next deck
    b.pad(0, 0, -24, 4, 4, [18, 17, 0], 0.2);
    b.pad(24, 0, 0, 4, 4, [0, 17, 18], 0.2);
    b.pad(0, 0, 24, 4, 4, [-18, 17, 0], 0.2);
    b.pad(-24, 0, 0, 4, 4, [0, 17, -18], 0.2);

    // a little cover in the corners
    for (const [x, z] of [
      [16, 10],
      [-16, -10],
      [10, -16],
      [-10, 16],
    ])
      b.box(x, 0, z, 3, 2.2, 3, { c: 'block', trim: COL.white });

    const sp = [
      [10, 0, -14],
      [14, 0, 10],
      [-10, 0, 14],
      [-14, 0, -10],
      [22, 4, -22],
      [22, 4, 22],
      [-22, 4, 22],
      [-22, 4, -22],
    ];
    for (const s of sp) b.spawn(s[0], s[1], s[2], s[3]);
    m.dummies = [
      { x: 0, y: 0, z: -14 },
      { x: 14, y: 0, z: 0, yaw: -Math.PI / 2 },
      { x: -14, y: 0, z: 4, pace: { dx: 0, dz: 8, speed: 0.7 } },
    ];
    b.decal('cross', 0, 0, 7, COL.yellow, 0, 1.4);
    b.decal('ring', 0, 0, 40, COL.white, 0, 0);
    b.decal('ring', 0, 0, 26, COL.cyan, 0, 0);
    for (const [px, pz, c] of [[0, -24, COL.cyan], [24, 0, COL.magenta], [0, 24, COL.orange], [-24, 0, COL.lime]]) b.decal('ring', px, pz, 9, c, 0, 0);
    for (const [ax, az, rot] of [[8, -17, -Math.PI / 2], [17, 8, 0], [-8, 17, Math.PI / 2], [-17, -8, Math.PI]]) b.decal('arrow', ax, az, 4, COL.yellow, rot, 0);
    b.beacon(20, -22, 4, 50, COL.cyan);
    b.beacon(22, 20, 4, 50, COL.magenta);
    b.beacon(-20, 22, 4, 50, COL.orange);
    b.beacon(-22, -20, 4, 50, COL.lime);
    m.clouds = 10;
    return m;
  }

  RV.maps = {
    toybox: toybox(),
    skybridge: skybridge(),
    pinwheel: pinwheel(),
    vertigo: vertigo(),
    yard: yard(),
    gauntlet: gauntlet(),
  };
  RV.mapOrder = ['toybox', 'skybridge', 'pinwheel', 'vertigo', 'yard', 'gauntlet'];
  // the four compact duel maps are also the online 1v1 maps
  for (const id of RV.mapOrder) if (RV.maps[id].modes.indexOf('duel') >= 0 && RV.maps[id].modes.indexOf('online') < 0) RV.maps[id].modes.push('online');
  RV.COL = COL;
})();
