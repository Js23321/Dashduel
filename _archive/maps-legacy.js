/* DASHDUEL - the four original duel maps (Toybox, Skybridge, Pinwheel, Vertigo), archived when the active map pool became
 * Arena / Bridge / Crossroads / Docks / Station / Backrooms (2026-10-25). Nothing here is loaded by default.
 *
 * To bring them back:
 *   1. copy this file to js/maps-legacy.js and add  <script src="js/maps-legacy.js"></script>  AFTER js/maps.js in index.html
 *   2. in server/shared.js add 'maps-legacy' to the list of simulation files loaded after 'maps'
 *   3. add the ids to server/config.js MAPS if you want them in the online rotation
 * (git: the branch backup/pre-rivals-overhaul has the complete game as it was before the change.)
 */
(function () {
  'use strict';
  const RV = window.RV;
  const { Builder, COL, PAL, SKY } = RV.mapkit;

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


  for (const m of [toybox(), skybridge(), pinwheel(), vertigo()]) RV.registerMap(m);
})();
