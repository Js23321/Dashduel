/* DASHDUEL - settings, key bindings and persistence. */
(function () {
  'use strict';
  const RV = window.RV;

  /** Every bindable action. Each action has two slots (primary + secondary). */
  RV.ACTIONS = [
    { id: 'forward', label: 'Move forward', group: 'Movement' },
    { id: 'back', label: 'Move backward', group: 'Movement' },
    { id: 'left', label: 'Strafe left', group: 'Movement' },
    { id: 'right', label: 'Strafe right', group: 'Movement' },
    { id: 'jump', label: 'Jump / wall jump', group: 'Movement' },
    { id: 'slide', label: 'Slide / crouch', group: 'Movement' },
    { id: 'fire', label: 'Shoot', group: 'Combat' },
    { id: 'aim', label: 'Aim down sights', group: 'Combat' },
    { id: 'reload', label: 'Reload', group: 'Combat' },
    { id: 'weapon1', label: 'Slot 1: Assault Rifle', group: 'Weapons' },
    { id: 'weapon2', label: 'Slot 2: Handgun', group: 'Weapons' },
    { id: 'weapon3', label: 'Slot 3: Fists', group: 'Weapons' },
    { id: 'weapon4', label: 'Slot 4: Grenade', group: 'Weapons' },
    { id: 'lastweapon', label: 'Previous weapon', group: 'Weapons' },
    { id: 'quickmelee', label: 'Quick melee: fists out, one punch, back to your weapon', group: 'Weapons' },
    { id: 'quickgrenade', label: 'Quick grenade: throw one, back to your weapon', group: 'Weapons' },
    { id: 'restart', label: 'Quick restart', group: 'Game' },
    { id: 'respawn', label: 'Back to checkpoint / spawn', group: 'Game' },
    { id: 'setspawn', label: 'Practice: set spawn point', group: 'Game' },
    { id: 'scoreboard', label: 'Show scoreboard', group: 'Game' },
  ];

  RV.DEFAULT_BINDS = {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space', ''],
    // Shift slides (there is no sprint key: you always run); C is bound too because Ctrl+W closes a Chromebook tab.
    slide: ['ShiftLeft', 'KeyC'],
    fire: ['Mouse0', ''],
    aim: ['Mouse2', ''],
    reload: ['KeyR', ''],
    weapon1: ['Digit1', ''],
    weapon2: ['Digit2', ''],
    weapon3: ['Digit3', ''],
    weapon4: ['Digit4', ''],
    lastweapon: ['KeyV', ''],
    quickmelee: ['KeyF', ''],
    quickgrenade: ['KeyG', ''],
    restart: ['KeyT', ''],
    respawn: ['KeyQ', ''],
    setspawn: ['KeyE', ''],
    scoreboard: ['Tab', ''],
  };

  RV.DEFAULT_SETTINGS = {
    // controls
    sens: 1.0,
    invertY: false,
    autoHop: true,
    wheelSwitch: true, // mouse wheel cycles weapons
    scopeSens: true, // scale look speed with the zoom while aiming
    adsToggle: false, // false = hold right mouse to aim, true = click to toggle
    adsPull: 1, // 0..1: how much of the aiming movement is done by turning the view toward the sights (1) instead of sliding the gun (0)
    adsCentre: true, // while aiming: true = the gun is centred and the rear sight hole is dead on the crosshair (default); false = the gun sits to the right, turned in so its front sight is on the crosshair
    adsZoom: 1, // 0..2: how strongly aiming zooms the view (1 = each weapon's own zoom)
    adsVer: 2, // 2: the centred gun became the default (older saves are moved to it once)
    adsSens: 1.0, // extra multiplier on look speed while aiming
    resultsScreen: false, // pause on a results screen after duel / deathmatch matches (default: keep playing)
    username: '', // chosen by the player (3-16 characters); shown to opponents in online matches
    startWeapon: 0, // slot equipped at the start of every life (0 = rifle .. 3 = grenade)
    uiVer: 2, // bumped when the interface was redesigned (resets the crosshair to its new default)
    bindsVer: 4, // 3: there is no sprint key and Shift slides; 4: F = quick melee, G = quick grenade (previous weapon moved to V)
    // view
    fov: 100,
    fovKick: true,
    cameraTilt: true,
    showWeapon: true,
    // crosshair
    xhSize: 6,
    xhGap: 4,
    xhThick: 2,
    xhDot: false,
    xhColor: '#ffffff',
    // graphics (quality = preset name or 'custom')
    quality: 'medium',
    cinematic: false, // the highest preset: HDR + bloom + grade (js/post.js)
    smooth: true, // smooth edges: MSAA (Medium and up) or the cheap FXAA pass (Low)
    renderScale: 0.85,
    shadows: 'off', // off | low | high
    effects: 'low', // off | low | high
    targetFps: 60, // 60 | 30
    autoQuality: true,
    showFps: false,
    fullscreen: false,
    lobby3d: true, // the 3D lobby is the start screen (off = the classic flat menu)
    // audio
    volume: 0.5,
    // arena
    botCount: 4,
    difficulty: 'normal',
    killLimit: 15,
    duelTo: 5,
    binds: null,
  };

  const KEY = 'settings.v1';

  function cloneBinds(b) {
    const out = {};
    for (const k in b) out[k] = [b[k][0] || '', b[k][1] || ''];
    return out;
  }

  RV.settings = Object.assign({}, RV.DEFAULT_SETTINGS);
  RV.settings.binds = cloneBinds(RV.DEFAULT_BINDS);

  /** Graphics presets: every knob that costs GPU time. */
  RV.QUALITY = {
    // POTATO: the cheapest picture the game can draw: 40% resolution, no shadows, no particles / decals / casings /
    // muzzle flash, no outlines, clouds, sun glow, reflections, floor decals or contact shadows, and no interface
    // animations. Gameplay, hit detection and the weapon animations are unchanged.
    potato: { renderScale: 0.4, shadows: 'off', effects: 'off', cinematic: false },
    low: { renderScale: 0.6, shadows: 'off', effects: 'low', cinematic: false },
    medium: { renderScale: 0.85, shadows: 'off', effects: 'high', cinematic: false },
    high: { renderScale: 1.0, shadows: 'low', effects: 'high', cinematic: false },
    // CINEMATIC: everything High has, plus 4x multisampling, high-resolution shadows and the HDR pipeline (bloom, soft highlight roll-off,
    // grade, sharpen, vignette, film grain). Needs a good GPU; devices that cannot do float render targets quietly draw it as High.
    cinematic: { renderScale: 1.0, shadows: 'high', effects: 'high', cinematic: true },
  };

  /** Pick a sensible first-run preset from what the browser tells us about the device. */
  function detectQuality() {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    if (mem <= 2 || cores <= 2) return 'potato';
    if (mem <= 4 || cores <= 4) return 'low';
    if (mem >= 8 && cores >= 8) return 'high';
    return 'medium';
  }

  RV.settingsApi = {
    applyQuality(name) {
      const q = RV.QUALITY[name];
      if (!q) return;
      Object.assign(RV.settings, q);
      RV.settings.quality = name;
    },
    /** Called whenever a graphics knob is edited by hand. */
    markCustom() {
      const s = RV.settings;
      let match = 'custom';
      for (const k in RV.QUALITY) {
        const q = RV.QUALITY[k];
        if (q.renderScale === s.renderScale && q.shadows === s.shadows && q.effects === s.effects && !!q.cinematic === !!s.cinematic) match = k;
      }
      s.quality = match;
    },
    load() {
      const saved = RV.store.get(KEY, null);
      if (!saved) {
        // first run: choose a preset for this device
        this.applyQuality(detectQuality());
      } else if (typeof saved === 'object') {
        if (!saved.quality) saved.quality = 'custom'; // pre-preset save: keep their values

        for (const k in RV.DEFAULT_SETTINGS) {
          if (k === 'binds') continue;
          if (saved[k] !== undefined && typeof saved[k] === typeof RV.DEFAULT_SETTINGS[k]) {
            RV.settings[k] = saved[k];
          }
        }
        if (saved.uiVer !== RV.DEFAULT_SETTINGS.uiVer) {
          // interface redesign: start from the new, smaller crosshair
          for (const k of ['xhSize', 'xhGap', 'xhThick', 'xhDot', 'xhColor']) RV.settings[k] = RV.DEFAULT_SETTINGS[k];
          RV.settings.uiVer = RV.DEFAULT_SETTINGS.uiVer;
        }
        if (saved.binds && typeof saved.binds === 'object') {
          for (const id in RV.DEFAULT_BINDS) {
            const b = saved.binds[id];
            if (Array.isArray(b)) RV.settings.binds[id] = [String(b[0] || ''), String(b[1] || '')];
          }
        }
        if (!(saved.adsVer >= RV.DEFAULT_SETTINGS.adsVer)) {
          RV.settings.adsCentre = RV.DEFAULT_SETTINGS.adsCentre;
          RV.settings.adsVer = RV.DEFAULT_SETTINGS.adsVer;
        }
        if (!(saved.bindsVer >= 3)) {
          // older saves: Shift was Sprint and Ctrl / C slid. Now you always run and Shift slides. (Saves from version 3 on already had that:
          // their own slide key must survive the later bumps.)
          for (const id in RV.settings.binds) for (let i = 0; i < 2; i++) if (RV.settings.binds[id][i] === 'ShiftLeft') RV.settings.binds[id][i] = '';
          RV.settings.binds.slide = RV.DEFAULT_BINDS.slide.slice();
        }
        if (!(saved.bindsVer >= 4)) {
          // F and G are the quick melee / quick grenade keys now: whatever an older save had on them (F was "previous weapon") moves away
          for (const id in RV.settings.binds) {
            if (id === 'quickmelee' || id === 'quickgrenade') continue;
            const b = RV.settings.binds[id];
            for (let i = 0; i < 2; i++) if (b[i] === 'KeyF' || b[i] === 'KeyG') b[i] = '';
            if (id === 'lastweapon' && !b[0] && !b[1]) RV.settings.binds[id] = RV.DEFAULT_BINDS[id].slice();
          }
        }
        if (!(saved.bindsVer >= RV.DEFAULT_SETTINGS.bindsVer)) RV.settings.bindsVer = RV.DEFAULT_SETTINGS.bindsVer;
      }
    },
    save() {
      RV.store.set(KEY, RV.settings);
    },
    resetBinds() {
      RV.settings.binds = cloneBinds(RV.DEFAULT_BINDS);
      this.save();
    },
    resetAll() {
      const name = RV.settings.username; // a reset never throws away who you are
      RV.settings = Object.assign({}, RV.DEFAULT_SETTINGS);
      RV.settings.binds = cloneBinds(RV.DEFAULT_BINDS);
      RV.settings.username = name;
      this.save();
    },
  };

  /** Human friendly label for a key code ("KeyW" -> "W"). */
  RV.codeLabel = function (code) {
    if (!code) return '—';
    if (code.indexOf('Mouse') === 0) {
      const n = +code.slice(5);
      return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][n] || 'Mouse ' + (n + 1);
    }
    const map = {
      Space: 'Space',
      ShiftLeft: 'L-Shift',
      ShiftRight: 'R-Shift',
      ControlLeft: 'L-Ctrl',
      ControlRight: 'R-Ctrl',
      AltLeft: 'L-Alt',
      AltRight: 'R-Alt',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      Tab: 'Tab',
      Enter: 'Enter',
      Backspace: 'Backspace',
      CapsLock: 'Caps',
      Backquote: '`',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backslash: '\\',
    };
    if (map[code]) return map[code];
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    return code;
  };

  RV.settingsApi.load();

  // ---------------------------------------------------------------------------
  // Username: 3-16 characters, letters / digits / space / underscore / hyphen. Everything that
  // arrives from another player goes through clean() before it is ever displayed.
  // ---------------------------------------------------------------------------
  RV.profile = {
    MIN: 3,
    MAX: 16,
    /** Strip anything that is not allowed, collapse spaces, trim and cut to the maximum length. */
    clean(s) {
      return String(s == null ? '' : s)
        .replace(/[^A-Za-z0-9_\- ]/g, '')
        .replace(/ +/g, ' ')
        .trim()
        .slice(0, 16);
    },
    /** {ok, name} or {ok:false, msg}. */
    check(s) {
      const raw = String(s == null ? '' : s).trim();
      if (!raw) return { ok: false, msg: 'Type a name' };
      if (/[^A-Za-z0-9_\- ]/.test(raw)) return { ok: false, msg: 'Letters, numbers, spaces, _ and - only' };
      const n = this.clean(raw);
      if (n.length < this.MIN) return { ok: false, msg: 'At least ' + this.MIN + ' characters' };
      if (raw.length > this.MAX) return { ok: false, msg: 'At most ' + this.MAX + ' characters' };
      return { ok: true, name: n };
    },
    get() {
      return RV.settings.username || '';
    },
    /** Name used in the interface (falls back to "You" before one is chosen). */
    display() {
      return RV.settings.username || 'You';
    },
    set(s) {
      const c = this.check(s);
      if (c.ok) {
        RV.settings.username = c.name;
        RV.settingsApi.save();
      }
      return c;
    },
    random() {
      const a = ['Swift', 'Silent', 'Rapid', 'Neon', 'Static', 'Lunar', 'Ember', 'Cobalt', 'Vector', 'Nimble', 'Hollow', 'Zenith'];
      const b = ['Fox', 'Rook', 'Viper', 'Comet', 'Orbit', 'Falcon', 'Wolf', 'Pixel', 'Raven', 'Drift', 'Spark', 'Lynx'];
      const r = (n) => Math.floor(Math.random() * n);
      return a[r(a.length)] + b[r(b.length)] + (10 + r(90));
    },
  };
})();
