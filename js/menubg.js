/* DASHDUEL - the slow 3D arena behind the main menu.
 *
 * Reuses the game's own renderer and a normal map (nothing is copied or mocked): while the main menu is the
 * visible screen and no match is running, the camera drifts around the arena and the scene is drawn at a capped
 * 30 fps (20 on the Low preset). Any other screen, a hidden tab or a running match stops it completely, and the
 * map is rebuilt by the match itself when one starts.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const B = (RV.menuBg = { map: 'toybox', t: 0, acc: 0, was: false, world: null, cam: { radius: 0.72, height: 12, look: 1.5, fov: 74, speed: 0.05, bob: 1 } });

  B.frame = function (dt) {
    const R = RV.render;
    const on = !!R && R.ready && RV.ui && RV.ui.current === 'main' && !document.hidden;
    if (!on) {
      B.was = false;
      return;
    }
    if (!B.was) {
      // just arrived (boot, or back from a match): wipe whatever frame the canvas still holds
      B.was = true;
      B.acc = 1;
      R.renderer.clear(true, true, false);
    }
    B.acc += dt;
    const step = RV.settings.quality === 'low' ? 1 / 20 : 1 / 30;
    if (B.acc < step) return;
    const d = Math.min(B.acc, 0.1);
    B.acc = 0;

    const def = RV.maps[B.map];
    if (!def) return;
    if (!B.world) B.world = new RV.World(def);
    if (R.def !== def || !R.mapGroup) {
      R.buildMap(def, B.world);
      B.t = 0;
    }
    B.t += d;
    const bd = B.world.bounds;
    const cx = (bd.minX + bd.maxX) / 2,
      cz = (bd.minZ + bd.maxZ) / 2;
    const half = Math.min(bd.maxX - bd.minX, bd.maxZ - bd.minZ) / 2;
    const C = B.cam;
    const rad = half * C.radius;
    const a = 0.7 + B.t * C.speed;
    const ex = cx + Math.sin(a) * rad,
      ez = cz + Math.cos(a) * rad,
      ey = C.height + Math.sin(B.t * 0.2) * C.bob;
    const dx = cx - ex,
      dz = cz - ez;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(C.look - ey, Math.hypot(dx, dz));
    R.updateCamera(ex, ey, ez, yaw, pitch, 0, C.fov);
    if (R.texPad) R.texPad.offset.y -= d * 1.2;
    const r = R.renderer;
    r.clear(true, true, false);
    r.render(R.skyScene, R.skyCam);
    r.clearDepth();
    r.render(R.scene, R.camera);
  };
})();
