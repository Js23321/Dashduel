/* DASHDUEL - post processing on top of the game's own renderer (js/render.js). Purely cosmetic: nothing here touches the simulation.
 *
 *  - SMOOTH EDGES. The renderer is created with hardware multisampling (MSAA) when the graphics preset is Medium or better. Without it
 *    (Low preset, or MSAA unavailable) a cheap FXAA pass smooths the finished picture instead: the frame is copied into a texture and
 *    drawn back through the FXAA filter. Potato does neither (that preset is for the weakest devices).
 *  - CINEMATIC (the highest preset). The whole frame is drawn into a 4x multisampled half-float (HDR) target, then: a two-level bloom,
 *    a soft highlight shoulder (bright areas roll off instead of clipping), a little saturation / contrast grade, a sharpen, a subtle
 *    chromatic edge, a vignette and a trace of film grain, and the result is encoded to sRGB. Needs WebGL2 + float render targets;
 *    where that is missing the preset quietly behaves like High (RV.post.failed says why).
 */
(function () {
  'use strict';
  const RV = window.RV;
  const P = (RV.post = { failed: null, cineReady: false, fxaaReady: false });
  let renderer = null,
    canvas = null,
    scene = null,
    cam = null,
    quad = null;
  let fbTex = null,
    fbW = 0,
    fbH = 0;
  let rt = null,
    rtW = 0,
    rtH = 0,
    half = [],
    quarter = [],
    ao = [];
  let t0 = 0;
  const MAT = {};
  const ZERO = () => new THREE.Vector2(0, 0);
  let zero = null;

  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const FXAA_FRAG = [
    'uniform sampler2D tDiffuse; uniform vec2 rcp; varying vec2 vUv;',
    '#define REDUCE_MIN (1.0/128.0)',
    '#define REDUCE_MUL (1.0/8.0)',
    '#define SPAN_MAX 8.0',
    'void main() {',
    '  vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * rcp).rgb;',
    '  vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * rcp).rgb;',
    '  vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * rcp).rgb;',
    '  vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * rcp).rgb;',
    '  vec3 rgbM = texture2D(tDiffuse, vUv).rgb;',
    '  vec3 luma = vec3(0.299, 0.587, 0.114);',
    '  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma), lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma), lM = dot(rgbM, luma);',
    '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
    '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
    '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
    '  float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * REDUCE_MUL), REDUCE_MIN);',
    '  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);',
    '  dir = min(vec2(SPAN_MAX), max(vec2(-SPAN_MAX), dir * rcpDirMin)) * rcp;',
    '  vec3 rgbA = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);',
    '  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);',
    '  float lB = dot(rgbB, luma);',
    '  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);',
    '}',
  ].join('\n');

  const BRIGHT_FRAG = [
    'uniform sampler2D tSrc; uniform float threshold; uniform float knee; varying vec2 vUv;',
    'void main() {',
    '  vec3 c = texture2D(tSrc, vUv).rgb;',
    '  float l = max(c.r, max(c.g, c.b));',
    '  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);',
    '  soft = soft * soft / (4.0 * knee + 1e-4);',
    '  float w = max(soft, l - threshold) / max(l, 1e-4);',
    '  gl_FragColor = vec4(c * w, 1.0);',
    '}',
  ].join('\n');

  // 9-tap gaussian in 5 bilinear fetches
  const BLUR_FRAG = [
    'uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;',
    'void main() {',
    '  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;',
    '  c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;',
    '  c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;',
    '  c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;',
    '  c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}',
  ].join('\n');

  const COMPOSE_FRAG = [
    'uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB;',
    'uniform vec2 res; uniform float time; uniform float bloomA; uniform float bloomB; uniform float vignette; uniform float grain;',
    'uniform float aberration; uniform float sharpen; uniform float saturation; uniform float contrast; uniform float shoulder;',
    'varying vec2 vUv;',
    'vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
    'vec3 roll(vec3 c, float k) { vec3 over = max(c - k, vec3(0.0)); return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k))); }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  vec2 off = (uv - 0.5);',
    '  vec2 ca = off * aberration * dot(off, off) * 4.0;',
    '  vec3 col;',
    '  col.r = texture2D(tScene, uv + ca).r;',
    '  col.g = texture2D(tScene, uv).g;',
    '  col.b = texture2D(tScene, uv - ca).b;',
    '  vec2 px = 1.0 / res;',
    '  vec3 n = texture2D(tScene, uv + vec2(0.0, px.y)).rgb + texture2D(tScene, uv - vec2(0.0, px.y)).rgb + texture2D(tScene, uv + vec2(px.x, 0.0)).rgb + texture2D(tScene, uv - vec2(px.x, 0.0)).rgb;',
    '  col = max(col + (col - n * 0.25) * sharpen, vec3(0.0));',
    '  col += texture2D(tBloomA, uv).rgb * bloomA + texture2D(tBloomB, uv).rgb * bloomB;',
    '  col = roll(col, shoulder);',
    '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(l), col, saturation);',
    '  col = (col - 0.18) * contrast + 0.18;',
    '  col = max(col, vec3(0.0));',
    '  float d = length(off * vec2(res.x / res.y, 1.0));',
    '  col *= mix(1.0, smoothstep(1.1, 0.3, d), vignette);',
    '  col = oetf(col);',
    '  float g = fract(sin(dot(uv * res + fract(time) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
    '  col += g * grain;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');


  // screen-space ambient occlusion (Alchemy-style) from the world's depth: darkens creases, the feet of walls and the undersides of ledges
  const AO_FRAG = [
    'uniform sampler2D tDepth; uniform vec2 res; uniform vec2 tanHalf; uniform vec2 nearFar; uniform float radius; uniform float intensity; uniform float bias;',
    'varying vec2 vUv;',
    'float viewZ(float d) { float z = d * 2.0 - 1.0; return (2.0 * nearFar.x * nearFar.y) / (nearFar.y + nearFar.x - z * (nearFar.y - nearFar.x)); }',
    'vec3 posAt(vec2 uv) { float z = viewZ(texture2D(tDepth, uv).x); return vec3((uv * 2.0 - 1.0) * tanHalf * z, -z); }',
    'void main() {',
    '  float d0 = texture2D(tDepth, vUv).x;',
    '  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }',
    '  vec3 P = posAt(vUv);',
    '  vec2 px = 1.0 / res;',
    '  vec3 a = posAt(vUv + vec2(px.x, 0.0)), b = posAt(vUv - vec2(px.x, 0.0)), c = posAt(vUv + vec2(0.0, px.y)), d = posAt(vUv - vec2(0.0, px.y));',
    '  vec3 dx = (abs(a.z - P.z) < abs(b.z - P.z)) ? a - P : P - b;',
    '  vec3 dy = (abs(c.z - P.z) < abs(d.z - P.z)) ? c - P : P - d;',
    '  vec3 N = normalize(cross(dx, dy));',
    '  if (N.z < 0.0) N = -N;',
    '  float rpx = clamp(radius / max(-P.z, 0.1) / tanHalf.y * 0.5 * res.y, 3.0, 80.0);',
    '  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    '  float occ = 0.0;',
    '  for (int i = 0; i < 14; i++) {',
    '    float fi = float(i);',
    '    float ang = (fi + noise) * 2.399963;',
    '    float rr = (fi + 0.5) / 14.0;',
    '    vec2 off = vec2(cos(ang), sin(ang)) * (0.15 + 0.85 * rr) * rpx * px;',
    '    vec3 v = posAt(vUv + off) - P;',
    '    float dd = dot(v, v);',
    '    float range = smoothstep(radius * 2.5, radius * 1.2, sqrt(dd));',
    '    occ += max(0.0, dot(v, N) - bias * -P.z) / (dd + 0.01) * range;',
    '  }',
    '  float ao = clamp(1.0 - intensity * occ / 14.0, 0.0, 1.0);',
    '  ao = mix(1.0, ao, smoothstep(0.5, 2.0, -P.z));',
    '  gl_FragColor = vec4(ao, ao, ao, 1.0);',
    '}',
  ].join('\n');

  // depth-aware blur of the occlusion (so it does not bleed over edges)
  const AOBLUR_FRAG = [
    'uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 dir; uniform vec2 nearFar; varying vec2 vUv;',
    'float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return (2.0 * nearFar.x * nearFar.y) / (nearFar.y + nearFar.x - z * (nearFar.y - nearFar.x)); }',
    'void main() {',
    '  float z0 = lin(vUv);',
    '  float sum = texture2D(tAO, vUv).r * 0.25, wsum = 0.25;',
    '  for (int i = 1; i <= 4; i++) {',
    '    float fi = float(i);',
    '    float g = exp(-fi * fi * 0.12);',
    '    vec2 o = dir * fi;',
    '    float w1 = g * exp(-abs(lin(vUv + o) - z0) * 2.5 / max(z0 * 0.1, 0.05));',
    '    float w2 = g * exp(-abs(lin(vUv - o) - z0) * 2.5 / max(z0 * 0.1, 0.05));',
    '    sum += texture2D(tAO, vUv + o).r * w1 + texture2D(tAO, vUv - o).r * w2;',
    '    wsum += w1 + w2;',
    '  }',
    '  float v = sum / wsum;',
    '  gl_FragColor = vec4(v, v, v, 1.0);',
    '}',
  ].join('\n');

  const AOAPPLY_FRAG = [
    'uniform sampler2D tAO; uniform float strength; varying vec2 vUv;',
    'void main() { float a = texture2D(tAO, vUv).r; float v = mix(1.0, a, strength); gl_FragColor = vec4(v, v, v, 1.0); }',
  ].join('\n');

  function mat(frag, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, transparent: false });
  }

  function init() {
    if (P.ready) return true;
    const R = RV.render;
    if (!R || !R.renderer) return false;
    renderer = R.renderer;
    canvas = R.canvas;
    scene = new THREE.Scene();
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    scene.add(quad);
    zero = ZERO();
    MAT.fxaa = mat(FXAA_FRAG, { tDiffuse: { value: null }, rcp: { value: new THREE.Vector2(1, 1) } });
    MAT.bright = mat(BRIGHT_FRAG, { tSrc: { value: null }, threshold: { value: 1.0 }, knee: { value: 0.5 } });
    MAT.blur = mat(BLUR_FRAG, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    MAT.ao = mat(AO_FRAG, { tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) }, tanHalf: { value: new THREE.Vector2(1, 1) }, nearFar: { value: new THREE.Vector2(0.08, 1500) }, radius: { value: 0.85 }, intensity: { value: 2.6 }, bias: { value: 0.03 } });
    MAT.aoBlur = mat(AOBLUR_FRAG, { tAO: { value: null }, tDepth: { value: null }, dir: { value: new THREE.Vector2() }, nearFar: { value: new THREE.Vector2(0.08, 1500) } });
    MAT.aoApply = mat(AOAPPLY_FRAG, { tAO: { value: null }, strength: { value: 0.9 } });
    MAT.aoApply.transparent = true;
    MAT.aoApply.blending = THREE.CustomBlending;
    MAT.aoApply.blendEquation = THREE.AddEquation;
    MAT.aoApply.blendSrc = THREE.ZeroFactor;
    MAT.aoApply.blendDst = THREE.SrcColorFactor;
    MAT.compose = mat(COMPOSE_FRAG, {
      tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
      bloomA: { value: 0.16 }, bloomB: { value: 0.22 }, vignette: { value: 0.3 }, grain: { value: 0.014 }, aberration: { value: 0.0018 },
      sharpen: { value: 0.35 }, saturation: { value: 1.1 }, contrast: { value: 1.06 }, shoulder: { value: 0.82 },
    });
    P.ready = true;
    t0 = performance.now();
    return true;
  }

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  }

  // ---------------------------------------------------------------------------------------------------- smooth edges (FXAA)
  /** Is the cheap FXAA pass wanted right now? (Not with hardware MSAA, not on Potato, not when the player turned smoothing off.) */
  P.wantFxaa = function () {
    const S = RV.settings;
    if (!renderer || S.smooth === false || S.quality === 'potato') return false;
    if (P.cinematicActive()) return false;
    const a = renderer.getContextAttributes && renderer.getContextAttributes();
    return !(a && a.antialias);
  };

  /** After the scene was drawn to the screen: smooth the finished picture. */
  P.afterScene = function () {
    if (!init() || !P.wantFxaa()) return;
    const w = canvas.width,
      h = canvas.height;
    if (!fbTex || fbW !== w || fbH !== h) {
      if (fbTex) fbTex.dispose();
      fbTex = new THREE.FramebufferTexture(w, h);
      fbTex.minFilter = fbTex.magFilter = THREE.LinearFilter;
      fbTex.generateMipmaps = false;
      fbW = w;
      fbH = h;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(zero, fbTex);
    MAT.fxaa.uniforms.tDiffuse.value = fbTex;
    MAT.fxaa.uniforms.rcp.value.set(1 / w, 1 / h);
    pass(MAT.fxaa, null);
    P.fxaaReady = true;
  };

  // ---------------------------------------------------------------------------------------------------- cinematic
  function makeTargets(w, h) {
    disposeTargets();
    const gl = renderer.getContext();
    const ok = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    if (!ok) throw new Error('this browser cannot draw to float textures (WebGL2 + EXT_color_buffer_float are needed)');
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false };
    const maxS = renderer.capabilities.maxSamples || 4;
    rt = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: Math.min(4, maxS) }, opts));
    rt.depthTexture = new THREE.DepthTexture(w, h); // the world's depth (resolved after each pass) feeds the occlusion pass
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    const small = (ww, hh) => new THREE.WebGLRenderTarget(Math.max(2, ww), Math.max(2, hh), Object.assign({}, opts, { depthBuffer: false }));
    half = [small(w >> 1, h >> 1), small(w >> 1, h >> 1)];
    quarter = [small(w >> 2, h >> 2), small(w >> 2, h >> 2)];
    const aoOpts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false };
    ao = [new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), aoOpts), new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), aoOpts)];
    rtW = w;
    rtH = h;
    void gl;
  }

  function disposeTargets() {
    for (const t of [rt].concat(half, quarter, ao)) if (t) t.dispose();
    if (rt && rt.depthTexture) rt.depthTexture.dispose();
    rt = null;
    half = [];
    quarter = [];
    ao = [];
  }

  /** Called after the world was drawn into the target (before the weapon): darken creases and contact areas in place. */
  function occlusion() {
    const c = RV.render.camera;
    const th = Math.tan((c.fov * Math.PI) / 360);
    const u = MAT.ao.uniforms;
    u.tDepth.value = rt.depthTexture;
    u.res.value.set(ao[0].width, ao[0].height);
    u.tanHalf.value.set(th * c.aspect, th);
    u.nearFar.value.set(c.near, c.far);
    pass(MAT.ao, ao[0]);
    const bu = MAT.aoBlur.uniforms;
    bu.tDepth.value = rt.depthTexture;
    bu.nearFar.value.set(c.near, c.far);
    bu.tAO.value = ao[0].texture;
    bu.dir.value.set(1 / ao[0].width, 0);
    pass(MAT.aoBlur, ao[1]);
    bu.tAO.value = ao[1].texture;
    bu.dir.value.set(0, 1 / ao[0].height);
    pass(MAT.aoBlur, ao[0]);
    MAT.aoApply.uniforms.tAO.value = ao[0].texture;
    pass(MAT.aoApply, rt); // multiplies into the frame
  }

  /** Is the cinematic pipeline on (preset chosen and the device can do it)? */
  P.cinematicActive = function () {
    if (!RV.settings.cinematic || P.failed) return false;
    return true;
  };

  /**
   * Draw one frame the cinematic way. `drawScene()` renders the sky, the world and the weapon into whatever target is bound.
   * Returns false (and remembers why) if the pipeline cannot run here, so the caller draws the frame normally.
   */
  P.renderCinematic = function (drawScene) {
    if (!init()) return false;
    try {
      const w = canvas.width,
        h = canvas.height;
      if (!rt || rtW !== w || rtH !== h) makeTargets(w, h);
      renderer.setRenderTarget(rt);
      drawScene(() => {
        if (P.ssao !== false) occlusion();
        renderer.setRenderTarget(rt);
      });
      // bloom: bright parts of the frame, blurred at half and at quarter size
      const b = MAT.bright.uniforms;
      b.tSrc.value = rt.texture;
      pass(MAT.bright, half[0]);
      const bl = MAT.blur.uniforms;
      bl.tSrc.value = half[0].texture;
      bl.dir.value.set(1 / half[0].width, 0);
      pass(MAT.blur, half[1]);
      bl.tSrc.value = half[1].texture;
      bl.dir.value.set(0, 1 / half[0].height);
      pass(MAT.blur, half[0]);
      bl.tSrc.value = half[0].texture; // quarter level: blur the half-size result again, smaller and wider
      bl.dir.value.set(1 / quarter[0].width, 0);
      pass(MAT.blur, quarter[0]);
      bl.tSrc.value = quarter[0].texture;
      bl.dir.value.set(0, 1 / quarter[0].height);
      pass(MAT.blur, quarter[1]);
      bl.tSrc.value = quarter[1].texture;
      bl.dir.value.set(1 / quarter[0].width, 0);
      pass(MAT.blur, quarter[0]);
      bl.tSrc.value = quarter[0].texture;
      bl.dir.value.set(0, 1 / quarter[0].height);
      pass(MAT.blur, quarter[1]);
      const c = MAT.compose.uniforms;
      c.tScene.value = rt.texture;
      c.tBloomA.value = half[0].texture;
      c.tBloomB.value = quarter[1].texture;
      c.res.value.set(w, h);
      c.time.value = (performance.now() - t0) * 0.001;
      pass(MAT.compose, null);
      return true;
    } catch (e) {
      P.failed = String((e && e.message) || e);
      renderer.setRenderTarget(null);
      disposeTargets();
      if (window.console) console.warn('DASHDUEL: cinematic mode is not available here (' + P.failed + '); drawing as High');
      return false;
    }
  };

  /** (tests / tooling) the internal targets and materials */
  P._internals = () => ({ rt, ao, half, quarter, MAT, renderer });

  /** Turn the cinematic effects off (the auto-quality governor calls this first when the frame rate drops). */
  P.setCinematic = function (on) {
    RV.settings.cinematic = !!on;
    if (RV.settingsApi) RV.settingsApi.markCustom();
    if (!on) disposeTargets();
  };
})();
