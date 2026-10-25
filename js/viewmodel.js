/* DASHDUEL - first-person weapon models, pose application, muzzle flash, shell casings.
 *
 * The weapon lives in its own scene + camera (so it never clips into walls) and is
 * attached to that camera: its transform is relative to the view. Everything here
 * is cosmetic: it reads game state, it never changes the aim, the camera or hits.
 *
 * Models are built from a handful of boxes / cylinders each (about 30-60 meshes,
 * a few thousand triangles for the weapon in view) using shared geometries and a
 * small set of metal / polymer materials that reflect the sky of the current map.
 *
 * Four weapons only: rifle, pistol (handgun), fists, grenade. Every one of them is
 * held by the same pair of blocky hands (a simple Roblox-style block hand with a
 * short sleeve), so the style is consistent. The hands are children of the weapon's
 * root, so they follow every weapon animation for free; the animator only adds small
 * per-hand offsets (supporting hand on a reload, punches, the grenade pin...).
 */
(function () {
  'use strict';
  const RV = window.RV;
  const A = RV.vmanim;
  const SPEC = A.SPEC;

  const VM = (RV.viewmodel = {
    ready: false,
    models: {},
    anim: new A.Animator(),
    casings: [],
    shotCount: 0,
    lastOut: null,
  });

  // -------------------------------------------------------------------------
  // geometry + material helpers
  // -------------------------------------------------------------------------
  let BOX = null;
  const geoCache = {};
  function boxGeo() {
    return BOX || (BOX = new THREE.BoxGeometry(1, 1, 1));
  }
  function cylGeo(rt, rb, len, seg, axis) {
    const key = [rt, rb, len, seg, axis].join('|');
    let g = geoCache[key];
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, len, seg);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      else if (axis === 'x') g.rotateZ(Math.PI / 2);
      geoCache[key] = g;
    }
    return g;
  }

  function box(parent, mat, w, h, d, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(boxGeo(), mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  /** Cylinder along z (default), y or x. */
  function cyl(parent, mat, rt, rb, len, x, y, z, seg, axis) {
    const m = new THREE.Mesh(cylGeo(rt, rb, len, seg || 10, axis || 'z'), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function ring(parent, mat, r, tube, x, y, z, seg) {
    const key = 'torus|' + r + '|' + tube + '|' + (seg || 14);
    let g = geoCache[key];
    if (!g) g = geoCache[key] = new THREE.TorusGeometry(r, tube, 6, seg || 14);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /** Group that animates: remembers its rest transform. */
  function part(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.userData.base = { x, y, z };
    parent.add(g);
    return g;
  }

  function noiseTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const id = g.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      // subtle scuffs: mostly bright with a few darker flecks and streaks
      let v = 215 + Math.random() * 40;
      if (Math.random() < 0.05) v -= 60 + Math.random() * 40;
      if ((i % 64) % 9 === 0 && Math.random() < 0.3) v -= 25;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function makeMaterials() {
    const noise = noiseTexture();
    const std = (color, metal, rough, extra) =>
      new THREE.MeshStandardMaterial(Object.assign({ color, metalness: metal, roughness: rough, roughnessMap: noise, envMapIntensity: 1.0 }, extra || {}));
    const M = {
      steel: std(0xc9d0dc, 0.92, 0.5),
      gun: std(0x3c4454, 0.8, 0.6),
      dark: std(0x151922, 0.45, 0.7),
      poly: std(0x2c313c, 0.05, 0.78),
      rubber: new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.95, metalness: 0 }),
      brass: std(0xe2ac40, 0.95, 0.32),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fe3ff, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.3, depthWrite: false }),
      skin: new THREE.MeshStandardMaterial({ color: 0xd9a581, roughness: 0.8, metalness: 0 }),
      sleeve: new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.92, metalness: 0 }),
      cuff: new THREE.MeshStandardMaterial({ color: 0x353a43, roughness: 0.85, metalness: 0 }),
      cuffLine: new THREE.MeshBasicMaterial({ color: 0x2fb9a5 }),
      alloyCache: {},
      glowCache: {},
    };
    M.alloy = (c, metal) => M.alloyCache[c + '|' + metal] || (M.alloyCache[c + '|' + metal] = std(c, metal === undefined ? 0.55 : metal, 0.42));
    M.glow = (c) => M.glowCache[c] || (M.glowCache[c] = new THREE.MeshBasicMaterial({ color: c }));
    return M;
  }

  // -------------------------------------------------------------------------
  // the six weapons (original designs; sights match SPEC[...].sight exactly)
  // -------------------------------------------------------------------------
  const BUILD = {
    // SCAR-STYLE ASSAULT RIFLE: monolithic tan receiver with one long flat top rail, boxy slotted handguard,
    // birdcage flash hider, curved STANAG magazine, angled pistol grip, adjustable stock with a cheek riser.
    // Sights: flip-up rear aperture (centre (0, 0.1, 0.11)) and a front post whose tip is at y = 0.1.
    rifle(g, M, P) {
      const fde = M.alloy(0xb7a47a, 0.3), // flat dark earth
        fdeDark = M.alloy(0x8d7d5a, 0.3),
        acc = M.glow(0x2ee6ff);
      // receiver (upper + lower) and magwell
      box(g, fde, 0.068, 0.064, 0.44, 0, 0.034, 0.05); // upper receiver, z -0.17 .. 0.27
      box(g, fde, 0.07, 0.066, 0.23, 0, -0.03, 0.065); // lower receiver
      box(g, fde, 0.075, 0.074, 0.075, 0, -0.034, -0.05); // magwell
      box(g, M.dark, 0.004, 0.026, 0.07, 0.035, 0.046, 0.065); // ejection port (right)
      box(g, fdeDark, 0.0705, 0.006, 0.1, 0, 0.0, 0.0); // seam between upper and lower
      // handguard: boxy, slotted, with a bottom rail
      box(g, fde, 0.073, 0.072, 0.31, 0, 0.027, -0.315); // z -0.47 .. -0.16
      for (let i = 0; i < 4; i++) box(g, M.dark, 0.0745, 0.016, 0.045, 0, 0.03, -0.215 - i * 0.065); // slots (both sides)
      box(g, M.gun, 0.03, 0.01, 0.22, 0, -0.014, -0.33); // bottom rail
      // one continuous flat top rail from the stock hinge to the end of the handguard
      box(g, M.gun, 0.032, 0.016, 0.74, 0, 0.07, -0.1); // top at y = 0.078
      for (let i = 0; i < 18; i++) box(g, M.dark, 0.034, 0.004, 0.008, 0, 0.0785, -0.455 + i * 0.04);
      // barrel, gas block and birdcage flash hider
      cyl(g, M.steel, 0.012, 0.012, 0.13, 0, 0.022, -0.53, 10);
      box(g, M.gun, 0.03, 0.03, 0.04, 0, 0.034, -0.49); // gas block
      cyl(g, M.gun, 0.019, 0.019, 0.07, 0, 0.022, -0.6, 10);
      for (let i = 0; i < 3; i++) box(g, M.dark, 0.042, 0.007, 0.018, 0, 0.022, -0.585 - i * 0.02);
      box(g, M.dark, 0.007, 0.042, 0.018, 0, 0.022, -0.605);
      // front sight post (tip exactly at the sight line y = 0.1)
      box(g, M.gun, 0.026, 0.03, 0.03, 0, 0.075, -0.41);
      box(g, M.steel, 0.005, 0.014, 0.005, 0, 0.093, -0.41);
      box(g, M.gun, 0.004, 0.026, 0.02, 0.013, 0.09, -0.41);
      box(g, M.gun, 0.004, 0.026, 0.02, -0.013, 0.09, -0.41);
      // rear flip-up aperture sight centred on (0, 0.1, 0.11)
      box(g, M.gun, 0.036, 0.02, 0.04, 0, 0.088, 0.11);
      ring(g, M.gun, 0.0155, 0.0035, 0, 0.1, 0.11, 14);
      box(g, M.gun, 0.008, 0.03, 0.03, 0.0205, 0.1, 0.11);
      box(g, M.gun, 0.008, 0.03, 0.03, -0.0205, 0.1, 0.11);
      // pistol grip, trigger guard
      box(g, M.rubber, 0.05, 0.125, 0.06, 0, -0.118, 0.145, -0.38);
      box(g, M.poly, 0.012, 0.008, 0.075, 0, -0.07, 0.07);
      box(g, M.poly, 0.012, 0.032, 0.008, 0, -0.054, 0.03);
      // adjustable stock: hinge, body, cheek riser, rubber butt pad
      box(g, fdeDark, 0.058, 0.07, 0.04, 0, 0.0, 0.285);
      box(g, fde, 0.05, 0.068, 0.13, 0, -0.012, 0.345);
      box(g, fde, 0.046, 0.014, 0.1, 0, 0.034, 0.335);
      box(g, M.dark, 0.052, 0.012, 0.08, 0, -0.03, 0.34); // stock cut-out shadow
      box(g, M.rubber, 0.056, 0.1, 0.022, 0, -0.014, 0.42);
      box(g, acc, 0.006, 0.006, 0.006, 0.037, -0.005, 0.1); // status light
      // moving parts
      P.mag = part(g, 0, -0.07, -0.05);
      box(P.mag, M.poly, 0.044, 0.055, 0.068, 0, -0.01, 0);
      box(P.mag, M.poly, 0.044, 0.055, 0.068, 0, -0.06, -0.008, 0.13);
      box(P.mag, M.poly, 0.044, 0.055, 0.068, 0, -0.108, -0.028, 0.27);
      box(P.mag, acc, 0.048, 0.01, 0.07, 0, -0.14, -0.05, 0.3);
      for (let i = 0; i < 3; i++) box(P.mag, M.dark, 0.0465, 0.004, 0.07, 0, -0.03 - i * 0.04, -0.006 * i, 0.1 * i);
      P.bolt = part(g, 0.037, 0.047, 0.085);
      box(P.bolt, M.steel, 0.012, 0.016, 0.045, 0, 0, 0);
      box(P.bolt, M.steel, 0.016, 0.018, 0.01, 0.006, 0, 0.026);
      P.trigger = part(g, 0, -0.045, 0.085);
      box(P.trigger, M.steel, 0.008, 0.03, 0.01, 0, -0.012, 0);
    },

    // SIDEKICK: pistol; the whole slide (with its 3-dot sights) cycles on every shot
    pistol(g, M, P) {
      const acc = M.glow(0xffc400);
      box(g, M.poly, 0.05, 0.036, 0.22, 0, 0, 0); // frame
      box(g, M.gun, 0.052, 0.02, 0.1, 0, -0.025, -0.06);
      box(g, M.poly, 0.05, 0.13, 0.07, 0, -0.075, 0.075, -0.15); // grip
      for (let i = 0; i < 4; i++) box(g, M.dark, 0.052, 0.008, 0.06, 0, -0.045 - i * 0.022, 0.078, -0.15);
      box(g, M.poly, 0.012, 0.008, 0.06, 0, -0.034, 0.03); // trigger guard
      box(g, M.poly, 0.012, 0.03, 0.008, 0, -0.019, -0.03);
      box(g, acc, 0.003, 0.05, 0.06, 0.0265, -0.075, 0.078, -0.15); // grip stripe
      box(g, acc, 0.003, 0.05, 0.06, -0.0265, -0.075, 0.078, -0.15);
      cyl(g, M.steel, 0.011, 0.011, 0.04, 0, 0.034, -0.15, 8); // barrel tip, under the slide's nose
      box(g, M.gun, 0.012, 0.024, 0.014, 0, 0.05, 0.118); // hammer
      P.slide = part(g, 0, 0.04, -0.02);
      box(P.slide, M.gun, 0.056, 0.052, 0.25, 0, -0.006, 0); // (reaches down into the frame: it rides on it, nothing floats)
      box(P.slide, M.dark, 0.05, 0.01, 0.2, 0, -0.03, 0.0); // the rails it slides on
      box(P.slide, acc, 0.0035, 0.008, 0.16, 0.0285, 0.008, -0.02);
      box(P.slide, acc, 0.0035, 0.008, 0.16, -0.0285, 0.008, -0.02);
      for (let i = 0; i < 4; i++) box(P.slide, M.dark, 0.058, 0.038, 0.004, 0, 0, 0.09 + i * 0.012); // serrations
      box(P.slide, M.dark, 0.004, 0.016, 0.04, 0.0285, 0.004, 0.0); // ejection port
      // 3-dot sights, aperture centre (0, 0.08, 0.095): local y = 0.04, z = 0.115
      box(P.slide, M.gun, 0.01, 0.028, 0.016, 0.0145, 0.032, 0.115); // rear sight blocks, standing on the slide top
      box(P.slide, M.gun, 0.01, 0.028, 0.016, -0.0145, 0.032, 0.115);
      box(P.slide, M.gun, 0.039, 0.01, 0.016, 0, 0.022, 0.115); // ...joined at the base so the notch is one piece
      box(P.slide, M.glow(0xffffff), 0.004, 0.004, 0.002, 0.0145, 0.038, 0.1065);
      box(P.slide, M.glow(0xffffff), 0.004, 0.004, 0.002, -0.0145, 0.038, 0.1065);
      box(P.slide, M.gun, 0.01, 0.022, 0.014, 0, 0.03, -0.115); // front post: tip at local y = 0.041
      box(P.slide, M.glow(0xffffff), 0.004, 0.004, 0.002, 0, 0.034, -0.1225);
      P.mag = part(g, 0, -0.13, 0.078);
      box(P.mag, M.gun, 0.04, 0.04, 0.06, 0, 0.0, 0);
      box(P.mag, acc, 0.048, 0.01, 0.075, 0, -0.024, 0);
      P.trigger = part(g, 0, -0.02, 0.03);
      box(P.trigger, M.steel, 0.008, 0.026, 0.01, 0, -0.01, 0);
    },

    // FISTS: nothing is held; the two hands are the weapon (see HAND rig below)
    fists(g, M, P) {},

    // GRENADE: a small ribbed fragmentation grenade with a lever (spoon) and a pull-pin ring.
    // Built around the origin; it is parented to the right hand.
    grenade(g, M, P) {
      const acc = M.glow(0x3fd8c0);
      const olive = M.alloy(0x3d4a3f, 0.15);
      cyl(g, olive, 0.032, 0.032, 0.07, 0, 0, 0, 12, 'y'); // body
      cyl(g, olive, 0.027, 0.027, 0.02, 0, 0.044, 0, 12, 'y'); // shoulder
      cyl(g, M.steel, 0.015, 0.015, 0.03, 0, 0.066, 0, 10, 'y'); // fuze
      cyl(g, acc, 0.0335, 0.0335, 0.007, 0, 0.012, 0, 12, 'y'); // status band
      for (let i = 0; i < 3; i++) cyl(g, M.dark, 0.0332, 0.0332, 0.004, 0, -0.012 - i * 0.012, 0, 12, 'y'); // ribs
      cyl(g, M.dark, 0.026, 0.026, 0.01, 0, -0.04, 0, 10, 'y'); // base
      // lever (spoon) hugging the side of the body
      P.spoon = part(g, 0.036, 0.03, 0);
      box(P.spoon, M.steel, 0.006, 0.07, 0.016, 0, -0.025, 0);
      box(P.spoon, M.steel, 0.012, 0.012, 0.016, -0.006, 0.014, 0);
      // pull pin: a ring and a short shaft
      P.pin = part(g, 0.004, 0.058, 0.02);
      ring(P.pin, M.brass, 0.011, 0.0025, 0.012, 0, 0.008, 10);
      box(P.pin, M.brass, 0.022, 0.004, 0.004, -0.004, 0, 0);
    },
  };

  const FLASH_SCALE = { rifle: 0.26, pistol: 0.17, fists: 0, grenade: 0 };
  const FLASH_COL = { rifle: 0xffe29a, pistol: 0xffe08a };
  const CASING = {
    rifle: { s: [0.011, 0.011, 0.04], mat: 'brass' },
    pistol: { s: [0.009, 0.009, 0.024], mat: 'brass' },
  };

  // -------------------------------------------------------------------------
  // Models made in Blender (tools/blender/*.py -> js/models-weapons.js). A model is {parts: {body, mag, slide...}}; every
  // part has a pivot and triangles grouped by material NAME. Animated parts become pivoted groups (P.mag, P.slide ...),
  // exactly like the hand-built fallbacks below, so the animator does not care where a weapon came from.
  // -------------------------------------------------------------------------
  function modelMaterial(M, name) {
    const t = M.named || (M.named = {
      steel: M.steel, gun: M.gun, dark: M.dark, poly: M.poly, rubber: M.rubber, brass: M.brass, skin: M.skin, sleeve: M.sleeve, cuff: M.cuff, cuffLine: M.cuffLine,
      tan: M.alloy(0xb7a47a, 0.3), tanDark: M.alloy(0x8d7d5a, 0.3), olive: M.alloy(0x3d4a3f, 0.15),
      // the RIVALS look: flat chunky colours (orange rifle with black parts, green / gold / navy grenade, black handgun, tan block fists)
      orange: M.alloy(0xe8922a, 0.1), orangeDark: M.alloy(0xb86a14, 0.1), black: M.alloy(0x16181d, 0.25), green: M.alloy(0x2f9a3e, 0.1), greenDark: M.alloy(0x1f6e2c, 0.1),
      navy: M.alloy(0x3a4672, 0.2), skinDark: new THREE.MeshStandardMaterial({ color: 0xb98462, roughness: 0.85, metalness: 0 }),
      acc: M.glow(0x2ee6ff), accY: M.glow(0xffc400), white: M.glow(0xffffff),
    });
    return t[name] || M.gun;
  }
  function modelGeometry(m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
    geo.setIndex(m.i);
    return geo;
  }
  /** Add the parts of `model` to group g; `only` = a part name to build into g itself (hands), P = the animated-part table. */
  function addModel(g, M, P, model, only) {
    for (const name in model.parts) {
      if (only && name !== only) continue;
      const part_ = model.parts[name];
      let target = g;
      if (name !== 'body' && !only) {
        target = part(g, part_.pivot[0], part_.pivot[1], part_.pivot[2]);
        P[name] = target;
      }
      for (const mat in part_.mats) {
        const mesh = new THREE.Mesh(modelGeometry(part_.mats[mat]), modelMaterial(M, mat));
        target.add(mesh);
      }
    }
  }
  const MODEL_FOR = { rifle: 'rifle', pistol: 'pistol', grenade: 'grenade' };

  // -------------------------------------------------------------------------
  // Blocky hands. One shared design: a back-of-hand block, two curled finger blocks, a thumb
  // block, a short bare forearm, a cuff and a dark sleeve. Built facing -Z with the palm
  // down (-Y); `side` +1 = right hand, -1 = left hand (the thumb is on the inside).
  // Proportions are first-person realistic: the palm is ~5 cm wide.
  // -------------------------------------------------------------------------
  function buildHand(M, side) {
    const h = new THREE.Group();
    if (RV.models && RV.models.hands) {
      addModel(h, M, {}, RV.models.hands, side > 0 ? 'handR' : 'handL');
      h.rotation.order = 'YXZ';
      RV.mergeGroup(h);
      return h;
    }
    const sk = M.skin;
    box(h, sk, 0.052, 0.03, 0.058, 0, 0, 0); // back of hand
    box(h, sk, 0.05, 0.024, 0.034, 0, -0.004, -0.044); // fingers, first block
    box(h, sk, 0.05, 0.034, 0.022, 0, -0.026, -0.066); // fingers, curled block
    box(h, sk, 0.018, 0.02, 0.046, -0.034 * side, 0.004, -0.02); // thumb
    box(h, sk, 0.016, 0.018, 0.026, -0.03 * side, -0.012, -0.05); // thumb tip
    box(h, sk, 0.046, 0.04, 0.09, 0, 0.002, 0.072); // wrist + forearm
    box(h, M.cuff, 0.062, 0.058, 0.018, 0, 0.002, 0.125); // cuff
    box(h, M.cuffLine, 0.0635, 0.0595, 0.004, 0, 0.002, 0.136); // thin accent line
    box(h, M.sleeve, 0.064, 0.06, 0.34, 0, 0.002, 0.3); // sleeve
    h.rotation.order = 'YXZ';
    RV.mergeGroup(h);
    return h;
  }

  /**
   * Rest pose of each hand per weapon: position (root space, view units) and YXZ rotation.
   * The forearm extends backwards along +Z of the hand, so rotation x lifts the front of the
   * hand (arm rises towards the weapon), y turns it inwards, z rolls the palm.
   */
  const HAND = {
    rifle: { R: { p: [0.03, -0.074, 0.092], r: [0.3, 0.2, -1.1] }, L: { p: [-0.03, -0.03, -0.135], r: [0.2, -0.5, 0.95] } },
    pistol: { R: { p: [0.027, -0.05, 0.05], r: [0.35, 0.2, -1.1] }, L: { p: [-0.025, -0.075, 0.035], r: [0.2, -0.5, 0.95] } },
    fists: { R: { p: [0.12, -0.1, -0.36], r: [0.95, 0.22, -0.1] }, L: { p: [-0.12, -0.1, -0.36], r: [0.95, -0.22, 0.1] } },
    grenade: { R: { p: [0.13, -0.12, -0.38], r: [0.8, 0.15, -0.4] }, L: { p: [-0.12, -0.17, -0.4], r: [0.9, -0.2, 0.3] } },
  };
  /** Where the grenade sits in the throwing hand (hand space). */
  const NADE_IN_HAND = { p: [0.0, 0.012, -0.06], r: [0.2, 0, 0] };

  // -------------------------------------------------------------------------
  VM.build = function (R) {
    VM.R = R;
    VM.M = makeMaterials();
    VM.M.shell = new THREE.MeshStandardMaterial({ color: 0xd8402e, roughness: 0.55, metalness: 0.1 });
    for (const id in BUILD) {
      const root = new THREE.Group();
      const g = new THREE.Group(); // the model (scaled)
      const parts = {};
      if (RV.models && RV.models[MODEL_FOR[id]]) addModel(g, VM.M, parts, RV.models[MODEL_FOR[id]]);
      else BUILD[id](g, VM.M, parts); // (fallback: the hand-built boxes, used if the model data did not load)
      // bake the static meshes into one mesh per material (animated parts stay separate)
      const animated = [];
      g.traverse((o) => {
        if (o.userData && o.userData.base) animated.push(o);
      });
      for (let i = animated.length - 1; i >= 0; i--) RV.mergeGroup(animated[i]); // children before parents
      RV.mergeGroup(g);
      g.scale.setScalar(SPEC[id].scale);
      // both hands, placed on the weapon (or in front of the camera for fists / grenade)
      const rig = HAND[id];
      const hands = {};
      for (const side of ['L', 'R']) {
        const h = buildHand(VM.M, side === 'R' ? 1 : -1);
        h.position.set(rig[side].p[0], rig[side].p[1], rig[side].p[2]);
        h.rotation.set(rig[side].r[0], rig[side].r[1], rig[side].r[2]);
        root.add(h);
        hands[side] = h;
      }
      if (id === 'grenade') {
        // the grenade is carried by the right hand
        g.position.set(NADE_IN_HAND.p[0], NADE_IN_HAND.p[1], NADE_IN_HAND.p[2]);
        g.rotation.set(NADE_IN_HAND.r[0], NADE_IN_HAND.r[1], NADE_IN_HAND.r[2]);
        hands.R.add(g);
      } else root.add(g);
      root.visible = false;
      // muzzle flash: crossed star planes + a side-on cone
      const flash = new THREE.Group();
      if (FLASH_SCALE[id] > 0) {
        const tex = R.texFx;
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: FLASH_COL[id], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const geo = R.makeFxPlane(4);
        const a = new THREE.Mesh(geo, mat),
          b = new THREE.Mesh(geo, mat),
          c = new THREE.Mesh(geo, mat);
        b.rotation.z = Math.PI / 4;
        c.rotation.y = Math.PI / 2;
        c.position.z = 0.35;
        flash.add(a, b, c);
        flash.scale.setScalar(FLASH_SCALE[id]);
        const mz = SPEC[id].muzzle;
        flash.position.set(mz[0], mz[1], mz[2]);
        flash.visible = false;
        g.add(flash);
        flash.userData.mat = mat;
      }
      R.vmRoot.add(root);
      VM.models[id] = { root, g, parts, flash, spec: SPEC[id], hands, rig };
    }
    // pool of ejected casings (they live in view space)
    const cg = boxGeo();
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(cg, VM.M.brass);
      m.visible = false;
      R.vmScene.add(m);
      VM.casings.push({ mesh: m, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, life: 0, s: [1, 1, 1] });
    }
    VM.tmp = new THREE.Vector3();
    VM.ready = true;
    VM.reset('rifle');
  };

  /**
   * A static copy of a weapon's model for display (the 3D lobby's loadout rack): the same Blender model and materials the
   * first-person view uses, nothing animated. Faces -z, about one metre long (rifle); the caller scales / places it.
   */
  VM.makeDisplay = function (id) {
    const g = new THREE.Group();
    if (!VM.M) return g;
    if (id === 'fists') {
      for (const side of [-1, 1]) {
        const h = buildHand(VM.M, side);
        h.position.set(side * 0.14, 0, 0);
        h.rotation.set(0.3, -side * 0.18, side * 0.1);
        g.add(h);
      }
    } else {
      const parts = {};
      if (RV.models && RV.models[MODEL_FOR[id]]) addModel(g, VM.M, parts, RV.models[MODEL_FOR[id]]);
      else if (BUILD[id]) BUILD[id](g, VM.M, parts);
      const animated = [];
      g.traverse((o) => {
        if (o.userData && o.userData.base) animated.push(o);
      });
      for (let i = animated.length - 1; i >= 0; i--) RV.mergeGroup(animated[i]);
      RV.mergeGroup(g);
    }
    return g;
  };

  /** Snap straight to a weapon with no animation (new match, respawn...). */
  VM.reset = function (id) {
    VM.anim = new A.Animator();
    VM.anim.lastId = id;
    VM.shown = null;
    VM.setShown(id);
    for (const c of VM.casings) c.mesh.visible = false;
  };

  VM.setShown = function (id) {
    if (VM.shown === id) return;
    VM.shown = id;
    for (const k in VM.models) VM.models[k].root.visible = k === id;
  };

  VM.onFire = function (id) {
    VM.anim.onFire(id);
    VM.shotCount++;
  };
  VM.onJump = function () {
    VM.anim.onJump();
  };
  VM.onDoubleJump = function () {
    VM.anim.onDoubleJump();
  };
  /** A punch was thrown; `landed` = it hit something (the hand reacts a little). */
  VM.onPunch = function (landed) {
    if (landed) VM.anim.onPunchHit();
  };
  VM.onLand = function (impact) {
    VM.anim.onLand(impact);
  };

  /** Cosmetic tracer start in camera space (hip: near the muzzle; ADS: near the sight line). */
  VM.tracerOffset = function (ads) {
    const k = ads || 0;
    VM._to = VM._to || [0, 0, 0];
    VM._to[0] = 0.13 * (1 - k); // (aimed: the muzzle is on the line of the crosshair)
    VM._to[1] = -0.12 * (1 - k) - 0.025 * k;
    VM._to[2] = -0.55;
    return VM._to;
  };

  const rad = (v) => v;

  /**
   * Advance animation and apply the pose to the models.
   * st: see vmanim Animator.update (+ fx level string).
   */
  VM.update = function (dt, st) {
    if (!VM.ready) return;
    const R = VM.R;
    const o = VM.anim.update(dt, st);
    VM.lastOut = o;
    VM.setShown(o.id);
    const m = VM.models[o.id];
    if (!m) return;
    const spec = m.spec;

    // root pose (camera space)
    m.root.position.set(o.x, o.y, o.z);
    m.root.rotation.set(o.rx, o.ry, o.rz);

    // moving parts (positions in model units; the group is scaled)
    const P = m.parts;
    if (P.mag) {
      const b = P.mag.userData.base;
      P.mag.position.set(b.x, b.y + o.magY, b.z + o.magZ);
      P.mag.rotation.x = o.magRx;
      P.mag.visible = o.magVis > 0.5;
    }
    if (P.bolt) {
      const b = P.bolt.userData.base;
      P.bolt.position.z = b.z + o.boltZ;
    }
    if (P.slide) P.slide.position.z = P.slide.userData.base.z + o.slideZ;
    if (P.trigger) P.trigger.rotation.x = o.trigRx;

    // hands: rest pose of this weapon + the animator's offsets
    const hl = m.hands.L,
      hr = m.hands.R;
    hl.position.set(m.rig.L.p[0] + o.lh.x, m.rig.L.p[1] + o.lh.y, m.rig.L.p[2] + o.lh.z);
    hl.rotation.set(m.rig.L.r[0] + o.lh.rx, m.rig.L.r[1] + o.lh.ry, m.rig.L.r[2] + o.lh.rz);
    hr.position.set(m.rig.R.p[0] + o.rh.x, m.rig.R.p[1] + o.rh.y, m.rig.R.p[2] + o.rh.z);
    hr.rotation.set(m.rig.R.r[0] + o.rh.rx, m.rig.R.r[1] + o.rh.ry, m.rig.R.r[2] + o.rh.rz);
    if (o.id === 'grenade') {
      m.g.visible = o.nade > 0.02;
      m.g.scale.setScalar(Math.max(0.001, o.nade));
      if (P.spoon) P.spoon.rotation.z = -0.95 * o.spoon;
      if (P.pin) {
        const b = P.pin.userData.base;
        P.pin.position.set(b.x - 0.06 * o.pin, b.y + 0.012 * o.pin, b.z);
        P.pin.visible = o.pin < 0.97;
      }
    }

    // muzzle flash (cosmetic; orientation varies per shot)
    const fxLevel = st.fx || 'high';
    if (m.flash && m.flash.userData.mat) {
      const on = o.flash > 0 && fxLevel !== 'off';
      m.flash.visible = on;
      if (on) {
        m.flash.userData.mat.opacity = o.flash;
        m.flash.rotation.z = VM.shotCount * 2.4;
        m.flash.scale.setScalar(FLASH_SCALE[o.id] * (0.8 + 0.5 * o.flash));
      }
    }

    // pending casings: spawn at the ejection port in view space
    const queued = VM.anim.casingQ;
    VM.anim.casingQ = 0;
    if (queued > 0 && fxLevel !== 'off' && spec.eject) {
      m.root.updateMatrixWorld(true);
      const limit = fxLevel === 'low' ? 4 : 10;
      for (let i = 0; i < queued; i++) VM._spawnCasing(m, spec, limit);
    }

    // casing physics (view space; they fall and tumble, then shrink away)
    for (const c of VM.casings) {
      if (!c.mesh.visible) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.visible = false;
        continue;
      }
      c.vy -= 3.4 * dt;
      const p = c.mesh.position;
      p.x += c.vx * dt;
      p.y += c.vy * dt;
      p.z += c.vz * dt;
      c.mesh.rotation.x += c.sx * dt;
      c.mesh.rotation.y += c.sy * dt;
      c.mesh.rotation.z += c.sz * dt;
      const k = Math.min(1, c.life / 0.22);
      c.mesh.scale.set(c.s[0] * k, c.s[1] * k, c.s[2] * k);
    }
  };

  VM._spawnCasing = function (m, spec, limit) {
    let slot = null;
    let n = 0;
    for (const c of VM.casings) {
      if (c.mesh.visible) n++;
      else if (!slot) slot = c;
    }
    if (!slot || n >= limit) return;
    const def = CASING[spec.cas] || CASING.rifle;
    const e = spec.eject;
    VM.tmp.set(e[0], e[1], e[2]);
    m.g.localToWorld(VM.tmp);
    slot.mesh.material = VM.M[def.mat];
    slot.mesh.position.copy(VM.tmp);
    slot.s = def.s;
    slot.mesh.scale.set(def.s[0], def.s[1], def.s[2]);
    slot.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    slot.vx = 0.7 + Math.random() * 0.6;
    slot.vy = 0.5 + Math.random() * 0.5;
    slot.vz = 0.1 + Math.random() * 0.35;
    slot.sx = (Math.random() - 0.5) * 30;
    slot.sy = (Math.random() - 0.5) * 30;
    slot.sz = (Math.random() - 0.5) * 30;
    slot.life = 0.85;
    slot.mesh.visible = true;
  };

  /** Used by the pre-warm pass so the first shot never hitches. */
  VM.warm = function (on) {
    if (!VM.ready) return;
    for (const k in VM.models) {
      const m = VM.models[k];
      if (on) {
        m.root.userData.wasVisible = m.root.visible;
        m.root.visible = true;
        if (m.flash) m.flash.visible = true;
      } else {
        m.root.visible = !!m.root.userData.wasVisible;
        if (m.flash) m.flash.visible = false;
      }
    }
    for (const c of VM.casings) {
      if (on) {
        c.mesh.visible = true;
        c.mesh.scale.set(0.001, 0.001, 0.001);
      } else c.mesh.visible = false;
    }
  };
})();
