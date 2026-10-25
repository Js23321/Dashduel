const tanV = Math.tan(30 * Math.PI / 180), asp = 16 / 9, tanH = tanV * asp;
const cam = (nx, ny, d) => [nx * tanH * d, ny * tanV * d, -d];
const rotXYZ = (rx, ry, v) => { // R = Rx * Ry   (rz = 0)
  let [x, y, z] = v;
  let x1 = x * Math.cos(ry) + z * Math.sin(ry), z1 = -x * Math.sin(ry) + z * Math.cos(ry);
  let y2 = y * Math.cos(rx) - z1 * Math.sin(rx), z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
  return [x1, y2, z2];
};
function solve(name, s, rl, ml, R, M, dR) {
  const Rc = cam(R[0], R[1], dR);
  const dl = [ml[0] - rl[0], ml[1] - rl[1], ml[2] - rl[2]].map((v) => v * s);
  const L = Math.hypot(...dl);
  // find M depth so that |M - R| = L
  let lo = dR - L * 1.2, hi = dR + L * 1.2, dM = dR;
  for (let i = 0; i < 80; i++) { dM = (lo + hi) / 2; const Mc = cam(M[0], M[1], dM); const d = Math.hypot(Mc[0] - Rc[0], Mc[1] - Rc[1], Mc[2] - Rc[2]); if (d > L) hi = dM; else lo = dM; }
  const Mc = cam(M[0], M[1], dM);
  const tgt = [Mc[0] - Rc[0], Mc[1] - Rc[1], Mc[2] - Rc[2]]; const tl = Math.hypot(...tgt); const t = tgt.map((v) => v / tl);
  let best = null;
  for (let ry = -0.2; ry <= 1.0; ry += 0.002) for (let rx = -0.4; rx <= 0.8; rx += 0.002) {
    const v = rotXYZ(rx, ry, dl.map((q) => q / L));
    const err = (v[0] - t[0]) ** 2 + (v[1] - t[1]) ** 2 + (v[2] - t[2]) ** 2;
    if (!best || err < best.err) best = { err, rx, ry };
  }
  const rs = rotXYZ(best.rx, best.ry, rl.map((q) => q * s));
  const p = [Rc[0] - rs[0], Rc[1] - rs[1], Rc[2] - rs[2]];
  // where do key points land on screen?
  const scr = (loc) => { const q = rotXYZ(best.rx, best.ry, loc.map((v) => v * s)); const c = [p[0] + q[0], p[1] + q[1], p[2] + q[2]]; return [(c[0] / (-c[2] * tanH)).toFixed(2), (c[1] / (-c[2] * tanV)).toFixed(2), (-c[2]).toFixed(2)]; };
  console.log(name, 'hip', p.map((v) => +v.toFixed(3)), 'hipYaw', +best.ry.toFixed(3), 'hipPitch', +best.rx.toFixed(3), 'err', best.err.toExponential(1));
  console.log('   rear', scr(rl), 'muzzle', scr(ml), 'butt', scr(name === 'rifle' ? [0, -0.01, 0.46] : [0, -0.05, 0.12]), 'grip', scr(name === 'rifle' ? [0, -0.12, 0.15] : [0, -0.1, 0.09]));
}
const mode = process.argv[2] || 'a';
solve('rifle', 0.6, [0, 0.1, 0.11], [0, 0.022, -0.66], [0.40, -0.40], [0.16, -0.14], 0.46);
solve('pistol', 0.64, [0, 0.082, 0.095], [0, 0.045, -0.2], [0.30, -0.44], [0.14, -0.18], 0.40);
