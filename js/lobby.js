/* DASHDUEL - the 3D lobby: the entry point of the game (replaces the flat start screen).
 *
 * A small toy-block plaza modelled in Blender (tools/blender/build_lobby.py -> js/mesh-lobby.js) drawn by the game's own
 * renderer in its own scene. Everything in it is a real way into the game:
 *   PLAY gate + MATCHMAKING board   Online 1v1 queue (real server status), offline Duel / Deathmatch / Time Trial
 *   LOADOUT rack                    the four weapons (the same Blender models as the first-person view); click to pick your start weapon
 *   PRACTICE range                  starts Practice mode on the practice field
 *   SETTINGS panel                  the Settings screens
 *   PLAYER podium                   your avatar (the game's own blocky character, holding your start weapon), name and stats
 * The camera is a fixed set of cinematic stops it glides between (no free camera: it can never clip a wall), with a little idle
 * sway and mouse parallax. The HTML on top (css/lobby.css) only calls the same handlers the old menu used (RV.ui.*).
 * It draws only while a lobby screen is showing and no match is running; any failure falls back to the classic menu.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const $ = (id) => document.getElementById(id);
  const L = (RV.lobby = { ready: false, failed: null, zone: 'hub', active: false, shift: 0, shiftY: 0, status: { state: 'checking', text: 'Checking the game server…' } });

  /** Screens that show the lobby behind them. */
  const SCREENS = ['main', 'select', 'settings', 'loadout', 'records', 'help', 'queue', 'name'];
  const ZONE_OF_SCREEN = { select: 'play', queue: 'play', settings: 'settings', loadout: 'loadout', name: 'avatar', records: 'avatar' };
  const DOCK = [
    ['play', 'Play', 'Find a match'],
    ['loadout', 'Loadout', 'Pick your weapon'],
    ['practice', 'Practice', 'Shooting range'],
    ['settings', 'Settings', 'Controls & video'],
    ['avatar', 'You', 'Name & stats'],
  ];
  const AV_COLORS = [0xe5484d, 0x3b82f6, 0x22c55e, 0xf59e0b, 0xa855f7, 0x14b8a6, 0xec4899, 0xf97316];
  const MODE_BLURB = { duel: ['Duel', '1v1 against an AI'], arena: ['Deathmatch', 'Offline vs several bots'], timetrial: ['Time Trial', 'Race the checkpoints'] };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let R, scene, cam, dome, portal, portalMat, halo, portalOrbit, screenMesh, screenCtx, screenTex, avatar, stands, glow, cone, envRT;
  let zones = {}, cams = {}, hover = null, mouse = { x: 0, y: 0 }, camState = null, t = 0, acc = 0, lastProbe = -1e9, probing = false, resizeKey = '';
  let avatarKey = '', screenKey = '', qStart = 0;
  const V = () => window.THREE;

  // ---------------------------------------------------------------------------------------------------------------- build
  function sky() {
    const T = V();
    const g = new T.SphereGeometry(420, 24, 14);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new T.Color();
    const top = new T.Color(0x3d86ff),
      mid = new T.Color(0x8cc6ff),
      hor = new T.Color(0xe4f4ff),
      low = new T.Color(0xc4e6e0);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 420;
      if (y < 0) c.copy(low);
      else if (y < 0.08) c.copy(low).lerp(hor, y / 0.08);
      else if (y < 0.35) c.copy(hor).lerp(mid, (y - 0.08) / 0.27);
      else c.copy(mid).lerp(top, Math.min(1, (y - 0.35) / 0.65));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    m.frustumCulled = false;
    return m;
  }

  /**
   * The portal: a glowing vortex. A logarithmic spiral (three arms) bent by fractal noise, two state colours blended along the arms, a hot
   * white core, a few drifting stars sucked towards the centre and a soft pulsing rim along the gate frame. Potato mode: a flat colour.
   * `octaves` = 4 normally, 2 on Low (cheaper on weak GPUs).
   */
  function portalMaterial(quality) {
    const T = V();
    if (quality === 'potato') return new T.MeshBasicMaterial({ color: 0x6a4cff, fog: false });
    return new T.ShaderMaterial({
      uniforms: { t: { value: 0 }, a: { value: new T.Color(0x5b2bff) }, b: { value: new T.Color(0x19d3f3) }, c: { value: new T.Color(0xfff0ff) }, speed: { value: 1 }, glow: { value: 1 } },
      defines: { OCT: quality === 'low' ? 2 : 4 },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'varying vec2 vUv; uniform float t; uniform float speed; uniform float glow; uniform vec3 a; uniform vec3 b; uniform vec3 c;',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
        'float fbm(vec2 p){ float v = 0.0, k = 0.5; for (int i = 0; i < OCT; i++){ v += k * noise(p); p = p * 2.03 + vec2(1.7, 9.2); k *= 0.5; } return v; }',
        'void main(){',
        '  vec2 p = vUv * 2.0 - 1.0; p.x *= 0.92;',
        '  float r = length(p); float an = atan(p.y, p.x);',
        '  float tw = an + 2.4 * log(r + 0.07) - t * 0.85 * speed;',
        '  vec2 q = vec2(cos(tw), sin(tw)) * (0.8 + 1.2 * r);',
        '  float n = fbm(q * 1.5 + vec2(0.0, t * 0.12 * speed));',
        '  float arms = 0.5 + 0.5 * sin(tw * 3.0 + n * 5.0);',
        '  vec3 col = mix(a, b, smoothstep(0.15, 0.85, arms));',
        '  col *= 0.55 + 0.9 * n;',
        '  float core = smoothstep(0.62, 0.0, r);',
        '  col += c * pow(core, 1.6) * 1.35 * glow;',
        '  col += b * 0.5 * smoothstep(0.3, 0.0, abs(r - (0.5 + 0.06 * sin(t * 2.0 * speed)))) * glow;',   // a pulsing ring
        '  vec2 sp = vec2(an * 0.477 + t * 0.02, log(r + 0.12) * 3.0 - t * 0.55 * speed);',
        '  vec2 cell = floor(sp * vec2(14.0, 9.0)); float star = step(0.975, hash(cell));',
        '  col += star * (0.6 + 0.4 * sin(t * 6.0 + hash(cell) * 40.0)) * smoothstep(0.05, 0.35, r);',
        '  float e = max(abs(p.x) * 1.05, abs(p.y) * 1.02);',
        '  col = mix(col, c, smoothstep(0.8, 1.0, e) * (0.5 + 0.25 * sin(t * 3.0)) * glow);',
        '  col *= 1.0 - 0.5 * smoothstep(0.85, 1.35, r);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      fog: false,
    });
  }

  function addGlow(color, w, d) {
    const T = V();
    const m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ map: R.texGlow, color, transparent: true, opacity: 0.0, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    return m;
  }

  function build(mdl) {
    const T = V();
    R = RV.render;
    const potato = RV.settings.quality === 'potato';
    scene = new T.Scene();
    scene.fog = new T.Fog(0xdaf0ff, 110, 330);
    cam = new T.PerspectiveCamera(50, R.aspect || 1.78, 0.1, 900);
    cam.rotation.order = 'YXZ';
    dome = sky();
    scene.add(dome);
    scene.add(new T.HemisphereLight(0xffffff, 0xb8d2e8, 2.25));
    const sun = new T.DirectionalLight(0xfff0d8, 1.45);
    sun.position.set(30, 70, 50);
    scene.add(sun);

    // the Blender model
    scene.add(R.buildModelGroup(mdl));
    const meta = mdl.meta || {};
    cams = meta.cams || {};
    for (const k in meta.zones || {}) zones[k] = new T.Box3(new T.Vector3(...meta.zones[k].min), new T.Vector3(...meta.zones[k].max));

    // reflections for the metal weapons: this lobby's own sky (the game's map sky does not exist yet at boot)
    if (!potato) {
      try {
        const pm = new T.PMREMGenerator(R.renderer);
        const ps = new T.Scene();
        ps.add(sky());
        envRT = pm.fromScene(ps, 0, 1, 1000);
        scene.environment = envRT.texture;
        pm.dispose();
      } catch (e) {
        scene.environment = null;
      }
    }

    // PLAY portal (animated swirl between the gate's pillars) and the cubes circling the gate
    const p = meta.portal || { x: 0, y: 1.5, z: -8, w: 7.6, h: 8.8 };
    portalMat = portalMaterial(RV.settings.quality);
    portal = new T.Mesh(new T.PlaneGeometry(p.w, p.h), portalMat);
    portal.position.set(p.x, p.y + p.h / 2, p.z - 0.1);
    scene.add(portal);
    if (!potato) {
      // a soft additive halo behind the gate (the portal's glow spilling over the dais)
      halo = new T.Mesh(new T.PlaneGeometry(p.w * 2.1, p.h * 1.5), new T.MeshBasicMaterial({ map: R.texGlow, color: 0x6a4cff, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      halo.position.set(p.x, p.y + p.h / 2, p.z - 0.5);
      halo.renderOrder = 1;
      scene.add(halo);
    }
    if (!potato) {
      portalOrbit = new T.Group();
      const cg = new T.BoxGeometry(0.55, 0.55, 0.55);
      for (let i = 0; i < 8; i++) {
        const m = new T.Mesh(cg, new T.MeshBasicMaterial({ color: i % 2 ? 0xffe066 : 0x6be3ff, fog: false }));
        m.userData.a = (i / 8) * Math.PI * 2;
        portalOrbit.add(m);
      }
      portalOrbit.position.set(p.x, p.y + p.h / 2, p.z);
      scene.add(portalOrbit);
      portalOrbit.userData = { rx: p.w / 2 + 1.6, ry: p.h / 2 + 1.2 };
    }

    // MATCHMAKING board screen: a canvas drawn from real state (server probe, queue, name)
    const s = meta.screen || { x: 12, y: 7, z: -2.8, w: 8, h: 6.5 };
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = Math.round((512 * s.h) / s.w);
    screenCtx = cv.getContext('2d');
    screenTex = new T.CanvasTexture(cv);
    screenTex.colorSpace = T.SRGBColorSpace;
    screenMesh = new T.Mesh(new T.PlaneGeometry(s.w, s.h), new T.MeshBasicMaterial({ map: screenTex, fog: false }));
    screenMesh.position.set(s.x, s.y, s.z + 0.04);
    scene.add(screenMesh);

    // weapon stands: the four weapons, in loadout-slot order
    stands = [];
    const VM = RV.viewmodel;
    (meta.stands || []).forEach((a, i) => {
      const w = RV.WEAPONS[i];
      if (!w) return;
      const holder = new T.Group();
      const model = VM && VM.makeDisplay ? VM.makeDisplay(w.id) : new T.Group();
      const box = new T.Box3().setFromObject(model);
      const size = new T.Vector3();
      box.getSize(size);
      const ctr = new T.Vector3();
      box.getCenter(ctr);
      const k = 2.3 / Math.max(size.x, size.y, size.z, 0.01);
      model.scale.setScalar(k);
      model.position.set(-ctr.x * k, -ctr.y * k, -ctr.z * k);
      holder.add(model);
      holder.position.set(a.x, a.y, a.z);
      scene.add(holder);
      stands.push({ holder, a, id: w.id, box: new T.Box3(new T.Vector3(a.x - 1.5, a.y - 2, a.z - 1.5), new T.Vector3(a.x + 1.5, a.y + 1.6, a.z + 1.5)) });
    });
    glow = addGlow(0xff7aa8, 4.6, 4.6);
    scene.add(glow);

    // spotlight on the player podium
    const av = meta.avatar || { x: -13, y: 1.2, z: 6 };
    if (!potato) {
      cone = new T.Mesh(new T.CylinderGeometry(1.6, 3.4, 9, 20, 1, true), new T.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.1, depthWrite: false, side: T.DoubleSide, fog: false }));
      cone.position.set(av.x, av.y + 4.5, av.z);
      cone.renderOrder = 2;
      scene.add(cone);
    }
    makeAvatar();
    camState = { eye: new T.Vector3(), at: new T.Vector3(), fov: 78 };
    const c0 = cams.hub || { eye: [0, 9.5, 31], at: [0, 4.2, -4] };
    camState.eye.set(...c0.eye);
    camState.at.set(...c0.at);
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /** Your avatar: the game's own blocky character (colour and skin from your name), holding your start weapon. */
  function makeAvatar() {
    const T = V();
    const name = RV.profile.get() || 'You';
    const wid = (RV.WEAPONS[RV.settings.startWeapon] || RV.WEAPONS[0]).id;
    const key = name + '|' + wid;
    if (avatar && avatarKey === key) return;
    if (avatar) {
      scene.remove(avatar.group);
      avatar.group.traverse((o) => {
        if (o.geometry && o.geometry.isBufferGeometry && !o.userData.shared) o.geometry.dispose();
      });
      for (const m of avatar.mats) m.dispose();
      for (const m of avatar.weaponMats) m.dispose();
      if (avatar.nameTex) avatar.nameTex.dispose();
      avatar.tagMat.dispose();
    }
    const h = hash(name);
    const rec = R.createBotMesh(AV_COLORS[h % AV_COLORS.length], wid === 'grenade' ? 'fists' : wid, h % 6);
    R.scene.remove(rec.group); // createBotMesh adds opponents to the game scene: this one belongs to the lobby
    const i = R.botMeshes.indexOf(rec);
    if (i >= 0) R.botMeshes.splice(i, 1);
    rec.bar.visible = false;
    rec.tag.visible = false;
    const a = (window.RV.meshes.lobby.meta || {}).avatar || { x: -13, y: 1.2, z: 6 };
    rec.group.scale.setScalar(1.55);
    rec.group.position.set(a.x, a.y, a.z);
    scene.add(rec.group);
    avatar = rec;
    avatarKey = key;
  }

  // ---------------------------------------------------------------------------------------------------------------- server status (real)
  L.probe = function (force) {
    const NC = RV.netclient;
    if (!NC || probing) return;
    if (!force && performance.now() - lastProbe < 25000) return;
    lastProbe = performance.now();
    const r = NC.resolveUrl();
    if (r.error) {
      L.status = { state: 'none', text: /No game server/.test(r.error) ? 'No game server configured (offline modes only)' : 'Server address problem', detail: r.error };
      refreshStatus();
      return;
    }
    probing = true;
    L.status = { state: 'checking', text: 'Checking the game server…' };
    refreshStatus();
    NC.probe().then((res) => {
      probing = false;
      if (res.ok) L.status = { state: 'ok', text: 'Server online · ' + res.ms + ' ms' + (res.online != null ? ' · ' + res.online + ' online' : ''), ms: res.ms, online: res.online, queued: res.queued };
      else if (/No answer/.test(res.error || '')) L.status = { state: 'down', text: 'Server is not answering (a free host may be waking up; offline modes still work)', detail: res.error };
      else L.status = { state: 'down', text: 'Server not reachable (offline modes still work)', detail: res.error };
      refreshStatus();
    });
  };

  function refreshStatus() {
    const s = L.status;
    const pill = $('lb-status');
    if (pill) {
      pill.dataset.state = s.state;
      pill.title = s.detail || s.text;
      $('lb-status-text').textContent = s.text;
    }
    screenKey = '';
    if (L.zone === 'play') L.renderCard();
  }

  // ---------------------------------------------------------------------------------------------------------------- matchmaking screen
  function queueState() {
    const O = RV.online;
    if (O && O.matched) return 'matched';
    if (O && O.queueing) return 'searching';
    return 'idle';
  }

  function drawScreen() {
    if (!screenCtx) return;
    const q = queueState();
    const s = L.status;
    const name = RV.profile.get() || '—';
    if (q === 'searching') {
      if (!qStart) qStart = performance.now();
    } else qStart = 0;
    const sec = qStart ? Math.floor((performance.now() - qStart) / 1000) : 0; // how long this search has really been running
    const key = [s.text, q, name, sec].join('|');
    if (key === screenKey) return;
    screenKey = key;
    const g = screenCtx,
      w = g.canvas.width,
      h = g.canvas.height;
    g.fillStyle = '#0c1430';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#19d3f3';
    g.fillRect(0, 0, w, 8);
    g.fillStyle = '#7f90c4';
    g.font = '600 22px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText('MATCHMAKING', 28, 52);
    g.fillStyle = '#f4f7ff';
    g.font = '700 38px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText('Online 1v1', 28, 100);
    g.font = '500 22px system-ui, Segoe UI, Arial, sans-serif';
    g.fillStyle = '#aab6d6';
    g.fillText('First to 5 rounds · server decides every hit', 28, 134);
    const col = { ok: '#3ee08a', down: '#ff5a4d', none: '#ffc83d', checking: '#aab6d6' }[s.state];
    g.fillStyle = col;
    g.beginPath();
    g.arc(40, 190, 10, 0, 7);
    g.fill();
    g.font = '600 24px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText(s.state === 'ok' ? 'SERVER ONLINE' : s.state === 'down' ? 'SERVER UNREACHABLE' : s.state === 'none' ? 'NO SERVER SET' : 'CHECKING…', 62, 198);
    g.fillStyle = '#aab6d6';
    g.font = '500 22px system-ui, Segoe UI, Arial, sans-serif';
    const sub = s.state === 'ok' ? s.ms + ' ms' + (s.online != null ? ' · ' + s.online + ' online' : '') + (s.queued ? ' · ' + s.queued + ' in queue' : '') : s.state === 'down' ? 'Offline modes still work' : s.state === 'none' ? 'Offline modes only' : '';
    g.fillText(sub, 28, 238);
    g.fillStyle = '#1c2749';
    g.fillRect(28, 268, w - 56, 2);
    g.fillStyle = '#7f90c4';
    g.font = '600 20px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText('YOU', 28, 308);
    g.fillStyle = '#f4f7ff';
    g.font = '700 30px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText(name, 28, 346);
    g.fillStyle = q === 'idle' ? '#aab6d6' : '#ffc83d';
    g.font = '600 26px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText(q === 'searching' ? 'SEARCHING… ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : q === 'matched' ? 'MATCH FOUND' : 'Idle · click the gate to play', 28, h - 34);
    screenTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------------------------- camera + frame
  L.visible = function () {
    return !!(RV.ui && SCREENS.indexOf(RV.ui.current) >= 0 && RV.game.state === 'menu');
  };
  L.enabled = function () {
    return L.ready && RV.settings.lobby3d !== false && !/[?&]classic/.test(location.search); // (?classic in the address forces the flat menu)
  };

  /** A match started (or the lobby is hidden): stop drawing and let go of the cursor. */
  L.leave = function () {
    L.active = false;
    L.hover = null;
    if (R && R.canvas) R.canvas.style.cursor = '';
    const tip = $('lb-tip');
    if (tip) tip.classList.remove('on');
  };

  /** Which zone / weapon stand is under a screen point (tests / tooling). */
  L.pickAt = function (x, y) {
    return pick({ clientX: x, clientY: y });
  };

  L.focus = function (zone) {
    if (!cams[zone]) zone = 'hub';
    L.zone = zone;
    document.documentElement.dataset.lobbyZone = zone;
    document.querySelectorAll('#lb-dock [data-zone]').forEach((b) => b.classList.toggle('on', b.dataset.zone === zone));
    L.renderCard();
    if (zone === 'play') L.probe(false);
  };

  function updateCamera(dt, potato) {
    const T = V();
    const tgt = cams[L.zone] || cams.hub;
    const k = 1 - Math.exp(-dt * (potato ? 5 : 3.4));
    const eye = new T.Vector3(...tgt.eye),
      at = new T.Vector3(...tgt.at);
    // idle sway + a little parallax towards the mouse (never towards a wall: the stops sit well inside the plaza)
    const sw = potato ? 0 : 1;
    eye.x += Math.sin(t * 0.31) * 0.55 * sw + mouse.x * 0.9;
    eye.y += Math.sin(t * 0.23) * 0.22 * sw - mouse.y * 0.35;
    at.x += mouse.x * 0.5;
    camState.eye.lerp(eye, k);
    camState.at.lerp(at, k);
    cam.position.copy(camState.eye);
    cam.lookAt(camState.at);
    // the lobby interface covers part of the window: the Arcade style has a tall panel on the left (the plaza is framed in the part to its
    // right), the RIVALS style a dock along the bottom (the plaza is framed above it). An off-axis view, so nothing is squashed: `frame` is
    // the visible part, the picture is shifted into it by the size of what covers the rest
    const W = window.innerWidth,
      H = window.innerHeight;
    const dock = document.documentElement.dataset.ui === 'rivals';
    const onMain = RV.ui.current === 'main';
    const wantX = onMain && !dock && W > 1100 ? 354 : 0;
    const cardOpen = onMain && dock && L.zone !== 'hub';
    const wantY = onMain && dock ? Math.min(cardOpen ? 170 : 120, H * (cardOpen ? 0.22 : 0.16)) : 0;
    L.shift += (wantX - L.shift) * k;
    L.shiftY += (wantY - L.shiftY) * k;
    const frameW = Math.max(320, W - L.shift),
      frameH = Math.max(240, H - L.shiftY);
    const asp = frameW / frameH;
    const hf = asp < 1.25 ? 96 : asp < 1.6 ? 84 : 76; // horizontal FOV: narrower frames get a wider view so the zones stay in
    const vf = (2 * Math.atan(Math.tan((hf * Math.PI) / 360) / asp) * 180) / Math.PI;
    const key = asp.toFixed(3) + '|' + vf.toFixed(2) + '|' + W + 'x' + H + '|' + L.shift.toFixed(1) + '|' + L.shiftY.toFixed(1);
    if (key !== resizeKey) {
      resizeKey = key;
      cam.aspect = asp;
      cam.fov = vf;
      if (L.shift > 0.5 || L.shiftY > 0.5) cam.setViewOffset(frameW, frameH, -L.shift, 0, W, H);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
    dome.position.copy(cam.position);
  }

  L.frame = function (dt) {
    const T = V();
    R = RV.render;
    if (!L.enabled() || !R || !R.ready || document.hidden || !L.visible()) {
      L.active = false;
      return false;
    }
    const q = RV.settings.quality;
    const potato = q === 'potato';
    if (!L.active) {
      L.active = true;
      acc = 1;
      R.renderer.clear(true, true, false);
      L.probe(false);
      L._scr = null;
      L.focus(RV.ui.current === 'main' ? 'hub' : ZONE_OF_SCREEN[RV.ui.current] || 'hub');
    }
    if (RV.ui.current !== L._scr) {
      // a different screen opened over the lobby: the camera goes to the matching spot (and back to the hub after choosing a name)
      const prev = L._scr;
      L._scr = RV.ui.current;
      const z = ZONE_OF_SCREEN[L._scr];
      if (z && z !== L.zone) L.focus(z);
      else if (L._scr === 'main' && prev === 'name') L.focus('hub');
    }
    acc += dt;
    const step = potato ? 1 / 20 : q === 'low' ? 1 / 30 : 0;
    if (step && acc < step) return true;
    const d = Math.min(acc, 0.1);
    acc = 0;
    t += d;
    makeAvatar();
    updateCamera(d, potato);

    // animation: portal swirl, orbiting cubes, spinning weapons, podium spotlight
    if (portalMat.uniforms) {
      const u = portalMat.uniforms;
      u.t.value = t;
      const qs = queueState();
      u.speed.value = qs === 'idle' ? 1 : 2.2;
      const hot = L.hover === 'play' ? 1.25 : 1;
      u.glow.value = hot;
      // idle: violet -> cyan; searching: orange -> gold; matched: green -> cyan
      if (qs === 'idle') {
        u.a.value.setHex(0x5b2bff);
        u.b.value.setHex(0x19d3f3);
        u.c.value.setHex(0xfff0ff);
      } else if (qs === 'searching') {
        u.a.value.setHex(0xff5a1f);
        u.b.value.setHex(0xffc83d);
        u.c.value.setHex(0xfff4d0);
      } else {
        u.a.value.setHex(0x12a05c);
        u.b.value.setHex(0x19d3f3);
        u.c.value.setHex(0xf0fff6);
      }
    }
    if (halo) {
      const qs = queueState();
      halo.material.color.setHex(qs === 'idle' ? 0x6a4cff : qs === 'searching' ? 0xff8a1f : 0x2ee08a);
      halo.material.opacity = 0.42 + Math.sin(t * 1.7) * 0.1 + (L.hover === 'play' ? 0.12 : 0);
    }
    if (portalOrbit) {
      const o = portalOrbit.userData;
      portalOrbit.children.forEach((m, i) => {
        const a = m.userData.a + t * (queueState() === 'idle' ? 0.5 : 1.4);
        m.position.set(Math.cos(a) * o.rx, Math.sin(a) * o.ry, Math.sin(a * 2) * 0.6);
        m.rotation.set(a, a * 0.7, 0);
      });
    }
    const sel = RV.settings.startWeapon;
    stands.forEach((s, i) => {
      s.holder.rotation.y = t * (i === sel ? 1.1 : 0.45) + i;
      const bob = Math.sin(t * 1.6 + i) * 0.12;
      s.holder.position.y = s.a.y + bob + (i === sel ? 0.35 : 0);
      s.holder.scale.setScalar(i === sel ? 1.12 : L.hoverStand === i ? 1.06 : 1);
    });
    if (stands[sel]) {
      glow.position.set(stands[sel].a.x, 1.95, stands[sel].a.z);
      glow.material.opacity = 0.55 + Math.sin(t * 3) * 0.12;
    }
    if (avatar) {
      const turn = Math.max(-0.7, Math.min(0.7, mouse.x * 0.9)) + Math.sin(t * 0.6) * 0.06;
      avatar.group.rotation.y = Math.PI - 0.25 + turn; // facing the camera, turning a little towards the mouse
      avatar.group.position.y = ((RV.meshes.lobby.meta || {}).avatar || { y: 1.2 }).y + Math.abs(Math.sin(t * 1.8)) * 0.03;
    }
    if (cone) cone.material.opacity = 0.085 + Math.sin(t * 1.3) * 0.02;
    drawScreen();
    placeNameplate();

    const r = R.renderer;
    r.info.reset();
    r.clear(true, true, false);
    r.render(scene, cam);
    return true;
  };

  function placeNameplate() {
    const el = $('lb-name3d');
    if (!el || !avatar) return;
    const T = V();
    const p = avatar.group.position.clone();
    p.y += 3.5;
    p.project(cam);
    const on = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    el.style.opacity = on ? '1' : '0';
    el.style.transform = 'translate(' + ((p.x * 0.5 + 0.5) * window.innerWidth).toFixed(1) + 'px,' + ((-p.y * 0.5 + 0.5) * window.innerHeight).toFixed(1) + 'px) translate(-50%,-100%)';
    const w = RV.WEAPONS[RV.settings.startWeapon] || RV.WEAPONS[0];
    const html = '<b>' + esc(RV.profile.get() || 'You') + '</b><span>' + esc(w.name) + '</span>';
    if (el.dataset.k !== html) {
      el.dataset.k = html;
      el.innerHTML = html;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- picking
  const rayCache = { r: null };
  function pick(e) {
    const T = V();
    if (!rayCache.r) rayCache.r = new T.Raycaster();
    const ray = rayCache.r;
    ray.setFromCamera({ x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 }, cam);
    const hit = new T.Vector3();
    // a weapon stand wins over the zone box around it
    if (L.zone === 'loadout' || L.zone === 'hub') {
      let bs = -1,
        bd2 = 1e9;
      stands.forEach((s, i) => {
        if (ray.ray.intersectBox(s.box, hit)) {
          const d = hit.distanceTo(ray.ray.origin);
          if (d < bd2) {
            bd2 = d;
            bs = i;
          }
        }
      });
      if (bs >= 0) return { zone: 'loadout', stand: bs };
    }
    let best = null,
      bd = 1e9;
    for (const k in zones) {
      if (ray.ray.intersectBox(zones[k], hit)) {
        const d = hit.distanceTo(ray.ray.origin);
        if (d < bd) {
          bd = d;
          best = k === 'board' ? 'play' : k;
        }
      }
    }
    return { zone: best, stand: -1 };
  }

  function onMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (!L.active || RV.ui.current !== 'main' || e.target !== R.canvas) {
      if (L.hover) setHover(null, -1, e);
      return;
    }
    const p = pick(e);
    setHover(p.zone, p.stand, e);
  }

  function setHover(zone, stand, e) {
    L.hover = zone;
    L.hoverStand = stand;
    const tip = $('lb-tip');
    R.canvas.style.cursor = zone ? 'pointer' : '';
    document.querySelectorAll('#lb-dock [data-zone]').forEach((b) => b.classList.toggle('hot', !!zone && b.dataset.zone === zone));
    if (!tip) return;
    if (!zone) {
      tip.classList.remove('on');
      return;
    }
    const names = { play: 'Play — find a match', loadout: 'Loadout — pick your weapon', practice: 'Practice range', settings: 'Settings', avatar: 'Your player' };
    let txt = names[zone];
    if (stand >= 0 && RV.WEAPONS[stand]) txt = 'Equip ' + RV.WEAPONS[stand].name + ' as start weapon';
    tip.textContent = txt;
    tip.style.transform = 'translate(' + (e.clientX + 16) + 'px,' + (e.clientY + 14) + 'px)';
    tip.classList.add('on');
  }

  function onClick(e) {
    if (!L.active || RV.ui.current !== 'main' || e.target !== R.canvas) return;
    const p = pick(e);
    if (!p.zone) {
      if (L.zone !== 'hub') L.focus('hub');
      return;
    }
    RV.audio.init();
    RV.audio.play('click');
    if (p.stand >= 0) L.equip(p.stand);
    L.focus(p.zone);
  }

  /** Screen position (CSS pixels) of a point in the lobby (tests / tooling). */
  L.screenOf = function (x, y, z) {
    const v = new (V().Vector3)(x, y, z).project(cam);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind: v.z > 1 };
  };

  L.equip = function (i) {
    if (!RV.WEAPONS[i]) return;
    RV.settings.startWeapon = i;
    RV.settingsApi.save();
    if (L.zone === 'loadout') L.renderCard();
  };

  // ---------------------------------------------------------------------------------------------------------------- HTML card + actions
  L.renderCard = function () {
    const card = $('lb-card');
    if (!card) return;
    const z = L.zone;
    const S = RV.settings;
    let h = '';
    if (z === 'play') {
      const q = queueState();
      h += '<div class="lb-cols"><div class="lb-col">';
      h += '<div class="eyebrow">Play online</div>';
      h += '<button class="lb-big" data-act="find"><b>' + (q === 'searching' ? 'Searching…' : 'Find online match') + '</b><small>Online 1v1 · first to 5 · server-run</small></button>';
      h += '<button class="lb-big" data-act="ffa"><b>Free-for-all</b><small>Open server · join any time · up to 12 players</small></button>';
      h += '<div class="lb-conn" data-state="' + L.status.state + '"><i class="dot"></i><span>' + esc(L.status.state === 'ok' ? 'Online · ' + L.status.ms + ' ms' + (L.status.online != null ? ' · ' + L.status.online + ' playing' : '') : L.status.state === 'down' ? 'Server not reachable' : L.status.state === 'none' ? 'No server configured' : 'Checking…') + '</span><button class="lb-link" data-act="probe">Check again</button></div>';
      if (L.status.state === 'down' || L.status.state === 'none') h += '<p class="lb-note">Offline modes still work.</p>';
      h += '</div><div class="lb-col"><div class="eyebrow">Or play offline</div><div class="lb-modes">';
      for (const m of ['duel', 'arena', 'timetrial']) h += '<button class="lb-mode" data-act="mode" data-mode="' + m + '"><b>' + MODE_BLURB[m][0] + '</b><small>' + MODE_BLURB[m][1] + '</small></button>';
      h += '</div></div></div>';
    } else if (z === 'loadout') {
      h += '<div class="eyebrow">Loadout</div><h3>Start weapon</h3><p class="lb-note">You spawn holding this one; all four are always in your hands. Click a weapon on the rack, or here.</p>';
      RV.WEAPONS.forEach((w, i) => {
        h += '<button class="lb-row weap' + (S.startWeapon === i ? ' sel' : '') + '" data-act="weapon" data-i="' + i + '"><b>' + esc(w.name) + '</b><small>Slot ' + (i + 1) + (S.startWeapon === i ? ' · equipped' : '') + '</small></button>';
      });
      h += '<button class="lb-link wide" data-act="loadout-open">Full weapon stats…</button>';
    } else if (z === 'practice') {
      h += '<div class="eyebrow">Practice</div><h3>Shooting range</h3><p class="lb-note">The real practice field: target dummies at every distance, slide hills, wall runs, launch pads and a bunny-hop lane. No score, no opponents.</p>';
      h += '<button class="lb-big" data-act="practice"><b>Enter the practice range</b><small>Free play · all weapons</small></button>';
      h += '<button class="lb-row" data-act="mode" data-mode="practice"><b>Choose another map</b><small>Practice on a match map</small></button>';
    } else if (z === 'settings') {
      h += '<div class="eyebrow">Settings</div><h3>Control room</h3>';
      for (const [tab, name, d] of [['controls', 'Mouse & aiming', 'Sensitivity, ADS, auto-hop'], ['keybinds', 'Keybinds', 'Rebind every action'], ['graphics', 'Graphics', 'Presets incl. Potato mode'], ['network', 'Network', 'Game server address']]) {
        h += '<button class="lb-row" data-act="settings" data-tab="' + tab + '"><b>' + name + '</b><small>' + d + '</small></button>';
      }
      h += '<label class="lb-check"><input type="checkbox" data-act="lobby3d"' + (S.lobby3d !== false ? ' checked' : '') + '><span>3D lobby (turn off for the classic menu)</span></label>';
    } else if (z === 'avatar') {
      const on = RV.records && RV.records.data ? RV.records.data.online : null;
      h += '<div class="eyebrow">Player</div><h3>' + esc(RV.profile.get() || 'Choose a name') + '</h3>';
      h += '<button class="lb-row" data-act="rename"><b>Change name</b><small>Shown to opponents</small></button>';
      if (on) h += '<div class="lb-stats"><div><b>' + on.matches + '</b><span>online matches</span></div><div><b>' + on.wins + '</b><span>wins</span></div><div><b>' + on.bestStreak + '</b><span>best streak</span></div></div>';
      h += '<button class="lb-row" data-act="records"><b>Records</b><small>Personal bests and stats</small></button>';
    } else {
      h += '<div class="eyebrow">Welcome</div><h3>Pick a spot</h3><p class="lb-note">Click anything in the plaza or use the bar below. The big gate is the way into a match.</p>';
      h += '<button class="lb-big" data-act="focus" data-zone="play"><b>Play</b><small>Find a match</small></button>';
    }
    card.innerHTML = h;
  };

  function act(el) {
    const a = el.dataset.act;
    const UI = RV.ui;
    RV.audio.init();
    RV.audio.play('click');
    switch (a) {
      case 'focus':
        L.focus(el.dataset.zone);
        break;
      case 'find':
        UI.launch('online');
        break;
      case 'ffa':
        UI.launch('ffa');
        break;
      case 'mode':
        UI.launch(el.dataset.mode);
        break;
      case 'weapon':
        L.equip(+el.dataset.i);
        break;
      case 'loadout-open':
        UI.show('loadout');
        break;
      case 'practice':
        UI.quickStart('practice', 'yard');
        break;
      case 'settings':
        UI.tab = el.dataset.tab;
        UI.settingsOpenFromPause = false;
        UI.show('settings');
        break;
      case 'rename':
        UI.nameCb = null;
        UI.show('name');
        break;
      case 'records':
        UI.show('records');
        break;
      case 'probe':
        L.probe(true);
        break;
    }
  }

  function wire() {
    const root = $('lobby-ui');
    if (!root) return;
    const dock = $('lb-dock');
    if (dock && !dock.children.length) {
      dock.innerHTML = DOCK.map((d, i) => '<button data-zone="' + d[0] + '"' + (i === 0 ? ' data-autofocus' : '') + '><kbd>' + (i + 1) + '</kbd><b>' + d[1] + '</b><span>' + d[2] + '</span></button>').join('');
    }
    root.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zone]');
      const a = e.target.closest('[data-act]');
      if (a && a.tagName !== 'INPUT') {
        act(a);
        return;
      }
      if (z && !a) {
        RV.audio.init();
        RV.audio.play('click');
        L.focus(z.dataset.zone);
      }
    });
    root.addEventListener('change', (e) => {
      if (e.target.dataset && e.target.dataset.act === 'lobby3d') {
        RV.settings.lobby3d = e.target.checked;
        RV.settingsApi.save();
        L.applyMode();
      }
    });
    $('lb-rename').addEventListener('click', () => {
      RV.ui.nameCb = null;
      RV.ui.show('name');
    });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', (e) => {
      if (!L.active || RV.ui.current !== 'main' || e.ctrlKey || e.altKey || e.metaKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Escape') {
        L.focus('hub');
      } else if (/^Digit[1-5]$/.test(e.code)) {
        L.focus(DOCK[+e.code.slice(5) - 1][0]);
      }
    });
    // keep the status pill and the card honest while the queue changes
    setInterval(() => {
      if (L.active && RV.ui.current === 'main') {
        if (queueState() !== L._q) {
          L._q = queueState();
          L.renderCard();
        }
        L.probe(false);
      }
    }, 2000);
  }

  /** Show the 3D lobby UI, or the classic menu (3D lobby off in Settings, or it failed to load). */
  L.applyMode = function () {
    document.documentElement.classList.toggle('lobby3d', L.enabled());
    if (!L.enabled() && R && R.canvas) R.canvas.style.cursor = '';
    L.active = false;
  };

  L.init = function () {
    if (L.ready || L.failed) return L.ready;
    try {
      R = RV.render;
      const mdl = RV.meshes && RV.meshes.lobby;
      if (!mdl) throw new Error('the lobby model (js/mesh-lobby.js) did not load');
      if (!R || !R.ready || !window.THREE) throw new Error('the renderer is not ready');
      build(mdl);
      L.ready = true;
      wire();
    } catch (e) {
      console.error('[lobby]', e);
      L.failed = e && e.message ? e.message : String(e);
      L.ready = false;
    }
    L.applyMode();
    return L.ready;
  };
})();
