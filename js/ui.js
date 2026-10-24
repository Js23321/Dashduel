/* DASHDUEL - menus, settings, loadout, records, pause and results screens, plus keyboard navigation. */
(function () {
  'use strict';
  const RV = window.RV;
  const $ = (id) => document.getElementById(id);

  const UI = (RV.ui = {
    current: 'main',
    settingsOpenFromPause: false,
    selMode: null,
    selMap: null,
    tab: 'controls',
    loadoutFromPause: false,
  });

  const SCREENS = ['main', 'select', 'settings', 'loadout', 'records', 'help', 'pause', 'results', 'name', 'queue', 'error'];
  const MODE_NAMES = { online: 'Online 1v1', duel: 'Duel', arena: 'Deathmatch', timetrial: 'Time Trial', practice: 'Practice' };

  UI.hideAll = function () {
    for (const s of SCREENS) $('scr-' + s).classList.add('hidden');
    UI.current = null;
  };

  UI.show = function (id) {
    for (const s of SCREENS) $('scr-' + s).classList.toggle('hidden', s !== id);
    UI.current = id;
    if (id === 'select') UI.renderSelect();
    if (id === 'settings') UI.renderSettings();
    if (id === 'loadout') UI.renderLoadout();
    if (id === 'records') UI.renderRecords();
    if (id === 'name') UI.renderName();
    if (id === 'main') UI.renderWho();
    RV.icons.hydrate($('scr-' + id));
    RV.audio.init();
    UI.focusFirst();
  };

  UI.showPause = function () {
    const g = RV.game;
    $('pause-info').textContent = (MODE_NAMES[g.mode] || '') + ' \u00b7 ' + (g.map ? g.map.name : '');
    $('btn-fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    const online = !!(g.modeImpl && g.modeImpl.realtime);
    $('btn-restart').classList.toggle('hidden', online); // a live online match cannot be restarted
    $('btn-quit').textContent = online ? 'Leave match (forfeit)' : 'Quit to menu';
    $('pause-title').textContent = online ? 'Menu (match still running)' : 'Match paused';
    UI.settingsOpenFromPause = false;
    UI.loadoutFromPause = false;
    UI.show('pause');
  };

  // ---------------------------------------------------------------- keyboard navigation
  /** Visible, enabled controls of the active screen, in reading order. */
  UI.focusables = function () {
    const scr = UI.current && $('scr-' + UI.current);
    if (!scr) return [];
    return Array.from(scr.querySelectorAll('button:not([disabled]), select, input, [tabindex="0"]')).filter((e) => e.offsetParent !== null);
  };

  UI.focusFirst = function () {
    const scr = UI.current && $('scr-' + UI.current);
    if (!scr) return;
    const el = scr.querySelector('[data-autofocus]') || scr.querySelector('.card.sel, .lo-card.sel') || UI.focusables()[0];
    if (el && el.focus) el.focus({ preventScroll: true });
  };

  /** Leave the current screen the way "Back" would. */
  UI.back = function () {
    const c = UI.current;
    if (c === 'settings') {
      if (UI.settingsOpenFromPause) UI.showPause();
      else UI.show('main');
    } else if (c === 'loadout') {
      if (UI.loadoutFromPause) UI.showPause();
      else UI.show('main');
    } else if (c === 'queue') UI.cancelQueue();
    else if (c === 'name') {
      if (RV.profile.get()) UI.show('main');
    } else if (c === 'select' || c === 'records' || c === 'help') UI.show('main');
    else if (c === 'pause') {
      RV.input.requestLock();
      if (RV.input.noLock) RV.game.resume();
    }
  };

  UI.onKey = function (e) {
    if (RV.input.capture || !UI.current || RV.game.state === 'playing') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (e.code === 'Escape') {
      e.preventDefault();
      UI.back();
      return;
    }
    const horiz = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
    const vert = e.code === 'ArrowUp' || e.code === 'ArrowDown';
    if (horiz || vert) {
      // sliders and drop-downs use left / right themselves
      if (horiz && (tag === 'SELECT' || (tag === 'INPUT' && t.type === 'range'))) return;
      if (vert && tag === 'SELECT') return;
      const list = UI.focusables();
      if (!list.length) return;
      e.preventDefault();
      let i = list.indexOf(document.activeElement);
      const dir = e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 1;
      i = i < 0 ? 0 : (i + dir + list.length) % list.length;
      list[i].focus({ preventScroll: false });
      return;
    }
    if ((e.code === 'Enter' || e.code === 'Space') && t && t.getAttribute && t.getAttribute('tabindex') === '0') {
      e.preventDefault();
      t.click();
    }
  };

  // ---------------------------------------------------------------- map select
  UI.openSelect = function (mode) {
    UI.selMode = mode;
    const maps = RV.mapOrder.filter((id) => RV.maps[id].modes.indexOf(mode) >= 0);
    if (!maps.includes(UI.selMap)) UI.selMap = maps[0];
    UI.show('select');
  };

  UI.renderSelect = function () {
    const mode = UI.selMode;
    $('sel-title').textContent = MODE_NAMES[mode] + ' \u00b7 map';
    const box = $('map-cards');
    box.innerHTML = '';
    const maps = RV.mapOrder.filter((id) => RV.maps[id].modes.indexOf(mode) >= 0);
    for (const id of maps) {
      const m = RV.maps[id];
      const card = document.createElement('div');
      card.className = 'card' + (id === UI.selMap ? ' sel' : '');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      let meta = '';
      if (mode === 'duel') {
        const r = RV.records.duel(id);
        meta = '<span>Wins <b>' + r.wins + '</b>/' + r.matches + '</span><span>Best streak <b>' + r.bestStreak + '</b></span>';
      } else if (mode === 'timetrial') {
        const r = RV.records.tt(id);
        meta = '<span>Best <b>' + RV.fmtTime(r.best) + '</b></span><span>Top <b>' + (r.topSpeed ? r.topSpeed.toFixed(1) : '--') + '</b> m/s</span>';
      } else if (mode === 'arena') {
        const r = RV.records.arena(id);
        meta = '<span>Best <b>' + r.bestKills + '</b> elims</span><span>Wins <b>' + r.wins + '</b>/' + r.matches + '</span>';
      } else {
        meta = '<span>Top speed <b>' + (RV.records.data.practiceTopSpeed || 0).toFixed(1) + '</b> m/s</span>';
      }
      const sw = (m.swatch || []).map((c) => '<i style="background:#' + ('000000' + c.toString(16)).slice(-6) + '"></i>').join('');
      card.innerHTML =
        '<div class="swatch">' + sw + '</div><h3>' + m.name + '<span class="tag">' + (m.size || '') + '</span></h3><p>' + m.desc + '</p><div class="meta">' + meta + '</div>';
      card.addEventListener('click', () => {
        UI.selMap = id;
        UI.renderSelect();
        const sel = $('map-cards').querySelector('.card.sel');
        if (sel) sel.focus({ preventScroll: true });
      });
      box.appendChild(card);
    }
    $('arena-opts').classList.toggle('hidden', mode !== 'arena');
    $('duel-opts').classList.toggle('hidden', mode !== 'duel');
    const s = RV.settings;
    $('opt-duelto').value = String(s.duelTo);
    $('opt-diff-duel').value = s.difficulty;
    $('opt-bots').value = s.botCount;
    $('out-bots').textContent = s.botCount;
    $('opt-diff').value = s.difficulty;
    $('opt-kills').value = String(s.killLimit);
  };

  // ---------------------------------------------------------------- settings
  function persist() {
    RV.settingsApi.save();
    if (RV.applySettings) RV.applySettings();
  }

  /** Graphics knobs edited by hand: the preset becomes 'custom' unless it matches one. */
  function persistGfx() {
    RV.settingsApi.markCustom();
    persist();
    document.querySelectorAll('.presets button[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === RV.settings.quality));
  }

  function row(label, hint, control) {
    const r = document.createElement('div');
    r.className = 'set-row';
    const l = document.createElement('div');
    l.innerHTML = label + (hint ? '<span class="hint">' + hint + '</span>' : '');
    const c = document.createElement('div');
    c.className = 'ctl';
    if (Array.isArray(control)) control.forEach((x) => c.appendChild(x));
    else c.appendChild(control);
    r.appendChild(l);
    r.appendChild(c);
    return r;
  }

  function slider(key, min, max, step, fmt, after) {
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.value = RV.settings[key];
    const out = document.createElement('output');
    out.textContent = fmt(RV.settings[key]);
    inp.addEventListener('input', () => {
      RV.settings[key] = +inp.value;
      out.textContent = fmt(+inp.value);
      persist();
      if (after) after();
    });
    return [inp, out];
  }

  function check(key, gfx) {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!RV.settings[key];
    c.addEventListener('change', () => {
      RV.settings[key] = c.checked;
      (gfx ? persistGfx : persist)();
    });
    return c;
  }

  function select(key, options, parse, gfx) {
    const s = document.createElement('select');
    for (const [v, l] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      s.appendChild(o);
    }
    s.value = String(RV.settings[key]);
    s.addEventListener('change', () => {
      RV.settings[key] = parse ? parse(s.value) : s.value;
      (gfx ? persistGfx : persist)();
    });
    return s;
  }

  UI.renderSettings = function () {
    const body = $('settings-body');
    body.innerHTML = '';
    document.querySelectorAll('#settings-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === UI.tab));
    const S = RV.settings;

    if (UI.tab === 'controls') {
      body.appendChild(row('Mouse sensitivity', 'Look speed (applies to mouse and trackpad)', slider('sens', 0.1, 4, 0.05, (v) => (+v).toFixed(2))));
      body.appendChild(row('Invert Y axis', '', check('invertY')));
      body.appendChild(row('Auto bunny-hop', 'Hold Space to keep hopping the instant you land', check('autoHop')));
      body.appendChild(row('Always sprint', 'Sprint by default; the Sprint key then walks', check('alwaysSprint')));
      body.appendChild(row('Mouse wheel switches weapons', 'Handy when Ctrl+number would switch browser tabs', check('wheelSwitch')));
      body.appendChild(row('Aim down sights', 'Hold = keep the right mouse button down. Toggle = click once to aim, again to stop', select('adsToggle', [['false', 'Hold'], ['true', 'Toggle']], (v) => v === 'true')));
      body.appendChild(row('ADS sensitivity', 'Look speed multiplier while aiming', slider('adsSens', 0.3, 1.6, 0.05, (v) => (+v).toFixed(2) + 'x')));
      body.appendChild(row('Scale look speed with zoom', 'Keeps aiming 1:1 with how far the view is zoomed in', check('scopeSens')));
      body.appendChild(row('Results screen after matches', 'Off (default): the next duel / deathmatch starts automatically with the mouse still locked', check('resultsScreen')));
    } else if (UI.tab === 'keybinds') {
      const tbl = document.createElement('table');
      tbl.className = 'bind-table';
      let group = '';
      for (const a of RV.ACTIONS) {
        if (a.group !== group) {
          group = a.group;
          const g = document.createElement('tr');
          g.className = 'grp';
          g.innerHTML = '<td colspan="2">' + group + '</td>';
          tbl.appendChild(g);
        }
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.textContent = a.label;
        const td2 = document.createElement('td');
        for (let slot = 0; slot < 2; slot++) {
          const btn = document.createElement('button');
          btn.className = 'keybtn';
          btn.textContent = RV.codeLabel(S.binds[a.id][slot]);
          btn.title = slot ? 'Secondary key' : 'Primary key';
          btn.addEventListener('click', () => UI.captureKey(a.id, slot, btn));
          td2.appendChild(btn);
        }
        tr.appendChild(td1);
        tr.appendChild(td2);
        tbl.appendChild(tr);
      }
      body.appendChild(tbl);
      const rb = document.createElement('div');
      rb.className = 'row';
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = 'Reset key bindings';
      b.addEventListener('click', () => {
        RV.settingsApi.resetBinds();
        RV.input.rebuild();
        UI.renderSettings();
      });
      rb.appendChild(b);
      body.appendChild(rb);
      const note = document.createElement('p');
      note.className = 'fine';
      note.textContent = 'Click a key box, then press a key or mouse button. Esc cancels, Backspace clears the slot. Esc in-game always pauses.';
      body.appendChild(note);
    } else if (UI.tab === 'view') {
      body.appendChild(row('Field of view', 'Horizontal degrees', slider('fov', 80, 125, 1, (v) => v + '°', () => RV.render.setFov(RV.settings.fov))));
      body.appendChild(row('Speed FOV kick', 'The view widens a little as you speed up', check('fovKick')));
      body.appendChild(row('Wall-run camera tilt', 'Lean away from the wall while wall running', check('cameraTilt')));
      body.appendChild(row('Show weapon and hands', 'First-person model; purely cosmetic, never affects aim', check('showWeapon')));
      const prev = document.createElement('div');
      prev.className = 'xh-preview';
      prev.innerHTML = '<div id="crosshair-prev"><i class="xh xt"></i><i class="xh xb"></i><i class="xh xl"></i><i class="xh xr"></i><i class="xdot"></i></div>';
      body.appendChild(row('Crosshair', 'Fixed in the centre of the screen', prev));
      const redraw = () => RV.hud.applyCrosshair();
      body.appendChild(row('Crosshair size', '', slider('xhSize', 2, 24, 1, (v) => v + ' px', redraw)));
      body.appendChild(row('Crosshair gap', '', slider('xhGap', 0, 16, 1, (v) => v + ' px', redraw)));
      body.appendChild(row('Crosshair thickness', '', slider('xhThick', 1, 5, 1, (v) => v + ' px', redraw)));
      body.appendChild(row('Centre dot', '', (() => {
        const c = check('xhDot');
        c.addEventListener('change', redraw);
        return c;
      })()));
      const col = document.createElement('input');
      col.type = 'color';
      col.value = S.xhColor;
      col.addEventListener('input', () => {
        S.xhColor = col.value;
        persist();
        redraw();
      });
      body.appendChild(row('Crosshair colour', '', col));
      redraw();
    } else if (UI.tab === 'graphics') {
      // one-click presets (Low is tuned for weak Chromebooks)
      const presets = document.createElement('div');
      presets.className = 'presets';
      for (const [q, label] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = document.createElement('button');
        b.dataset.q = q;
        b.textContent = label;
        b.className = RV.settings.quality === q ? 'on' : '';
        b.addEventListener('click', () => {
          RV.settingsApi.applyQuality(q);
          persist();
          UI.renderSettings();
        });
        presets.appendChild(b);
      }
      body.appendChild(row('Graphics quality', 'Low: 60% resolution, no shadows, fewer particles (weapon animations stay). Medium: 85%. High: full resolution + soft shadows. ' + (S.quality === 'custom' ? '(Custom: you changed a setting below)' : ''), presets));
      body.appendChild(row('Render resolution', 'Lower this first if the game stutters', select('renderScale', [['0.5', '50%'], ['0.6', '60%'], ['0.65', '65%'], ['0.75', '75%'], ['0.85', '85%'], ['1', '100%']], parseFloat, true)));
      body.appendChild(row('Shadows', 'Off is fastest. Low is a good balance on decent hardware', select('shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], null, true)));
      body.appendChild(row('Visual effects', 'Particles, bullet-hole decals, muzzle flash, shell casings (cosmetic only)', select('effects', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], null, true)));
      body.appendChild(row('Target frame rate', '30 FPS mode renders every other frame for weak devices', select('targetFps', [['60', '60 FPS'], ['30', '30 FPS']], (v) => +v)));
      body.appendChild(row('Auto-adjust quality', 'Watches frame times; trims effects, resolution, shadows and outlines when FPS drops', check('autoQuality')));
      body.appendChild(row('Show FPS counter', '', check('showFps')));
      const b1 = document.createElement('button');
      b1.className = 'btn small';
      b1.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen now';
      b1.addEventListener('click', () => {
        RV.toggleFullscreen();
        setTimeout(() => (b1.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen now'), 250);
      });
      body.appendChild(row('Fullscreen', 'Start games fullscreen (also lets Ctrl-key combos reach the game). Windowed play works too.', [check('fullscreen'), b1]));
    } else if (UI.tab === 'interface') {
      UI.renderInterface(body);
    } else if (UI.tab === 'network') {
      UI.renderNetwork(body);
    } else if (UI.tab === 'audio') {
      body.appendChild(row('Master volume', '', slider('volume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', () => RV.audio.setVolume(RV.settings.volume))));
      const rb = document.createElement('div');
      rb.className = 'row';
      const b = document.createElement('button');
      b.className = 'btn small danger';
      b.textContent = 'Reset ALL settings to default';
      b.addEventListener('click', () => {
        RV.settingsApi.resetAll();
        RV.input.rebuild();
        if (RV.applySettings) RV.applySettings();
        UI.renderSettings();
      });
      rb.appendChild(b);
      body.appendChild(rb);
    }
  };

  // ---------------------------------------------------------------- settings > interface (main menu layout)
  UI.renderInterface = function (body) {
    const L = RV.menuLayout;
    const box = document.createElement('div');
    box.className = 'presets';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Main Menu Layout');
    for (const o of L.list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.layout = o.id; // the click is handled by js/menulayout.js
      b.textContent = o.name;
      b.className = o.id === L.id ? 'on' : '';
      b.setAttribute('aria-pressed', o.id === L.id ? 'true' : 'false');
      box.appendChild(b);
    }
    body.appendChild(row('Main Menu Layout', 'B \u2014 Cinematic: a large Play button in the centre over the 3D arena, navigation in a slim bar above it. D \u2014 Arcade Lobby: navigation down the left, the play panel on the right, your loadout bottom-left. Applies instantly, is remembered, and only changes the main menu (never a running match).', box));
    const note = document.createElement('p');
    note.className = 'fine';
    note.innerHTML = 'The same switch is in the top right of the main menu.';
    body.appendChild(note);
  };

  // ---------------------------------------------------------------- settings > network
  UI.renderNetwork = function (body) {
    const NC = RV.netclient;
    const r = NC.resolveUrl();
    const cur = document.createElement('div');
    cur.id = 'net-current';
    body.appendChild(row('Game server in use', r.error ? '<span style="color:var(--red)">' + r.error + '</span>' : r.url + ' <span class="hint" style="display:inline">(' + r.source + ')</span>', cur));
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'text';
    inp.style.width = '330px';
    inp.placeholder = 'wss://your-server.example/ws';
    inp.value = NC.getSavedUrl();
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    const save = document.createElement('button');
    save.className = 'btn small';
    save.textContent = 'Save';
    const reset = document.createElement('button');
    reset.className = 'btn small ghost';
    reset.textContent = 'Use default';
    body.appendChild(row('Server URL', 'Overrides js/config.js for this browser only. Leave empty to use the configured default. Must start with ws:// or wss://', [inp, save, reset]));
    const test = document.createElement('button');
    test.className = 'btn small primary';
    test.textContent = 'Test connection';
    const out = document.createElement('span');
    out.id = 'net-test';
    out.className = 'hint';
    out.style.cssText = 'display:inline;margin-left:10px';
    body.appendChild(row('Connection test', 'Opens a short connection to the server and measures the round trip. It never disturbs a running match.', [test, out]));
    const live = document.createElement('span');
    live.className = 'hint';
    live.style.cssText = 'display:inline';
    live.textContent = NC.describe();
    body.appendChild(row('Current connection', 'Status of the persistent game connection (only open while you queue or play online).', live));
    const note = document.createElement('p');
    note.className = 'fine';
    note.textContent = 'Online 1v1 needs the game server (see docs/ONLINE_BACKEND.md). The server runs the match and decides every hit; your browser only sends your movement and requests. The URL is not a secret and no credentials are ever stored here.';
    body.appendChild(note);
    save.addEventListener('click', () => {
      const v = inp.value.trim();
      if (v && !/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(v)) {
        out.style.color = 'var(--red)';
        out.textContent = 'Not a valid ws:// or wss:// address.';
        return;
      }
      NC.setSavedUrl(v);
      UI.renderSettings();
    });
    reset.addEventListener('click', () => {
      NC.setSavedUrl('');
      UI.renderSettings();
    });
    test.addEventListener('click', async () => {
      out.style.color = '';
      out.textContent = 'Testing\u2026';
      const typed = inp.value.trim();
      const res = await NC.probe(typed || undefined);
      if (res.ok) {
        out.style.color = 'var(--hi)';
        out.textContent = 'Connected \u00b7 ' + res.ms + ' ms \u00b7 ' + res.online + ' online \u00b7 ' + res.queued + ' in queue';
      } else {
        out.style.color = 'var(--red)';
        out.textContent = res.error;
      }
    });
  };

  UI.captureKey = function (action, slot, btn) {
    btn.classList.add('listening');
    btn.textContent = 'press a key…';
    RV.input.beginCapture((code, cancelled) => {
      btn.classList.remove('listening');
      if (!cancelled) {
        const binds = RV.settings.binds;
        if (code === 'Backspace') binds[action][slot] = '';
        else {
          // a key can only do one thing: take it away from any other action
          for (const a in binds) for (let i = 0; i < 2; i++) if (binds[a][i] === code) binds[a][i] = '';
          binds[action][slot] = code;
        }
        RV.settingsApi.save();
        RV.input.rebuild();
      }
      UI.renderSettings();
    });
  };

  // ---------------------------------------------------------------- username
  UI.renderWho = function () {
    const n = RV.profile.get();
    if ($('who-name')) $('who-name').textContent = n || '\u2014';
  };

  /** Run `cb` once the player has a username (asks for one first if needed). */
  UI.requireName = function (cb) {
    if (RV.profile.get()) {
      cb();
      return;
    }
    UI.nameCb = cb;
    UI.show('name');
  };

  UI.renderName = function () {
    const inp = $('name-input');
    inp.value = RV.profile.get() || '';
    UI.validateName();
    setTimeout(() => {
      inp.focus();
      inp.select();
    }, 0);
  };

  UI.validateName = function () {
    const c = RV.profile.check($('name-input').value);
    const msg = $('name-msg');
    msg.className = 'name-msg ' + (c.ok ? 'ok' : $('name-input').value ? 'bad' : '');
    msg.textContent = c.ok ? 'Looks good: ' + c.name : c.msg;
    $('btn-name-ok').disabled = !c.ok;
    return c;
  };

  UI.confirmName = function () {
    const c = RV.profile.set($('name-input').value);
    if (!c.ok) return;
    UI.renderWho();
    const cb = UI.nameCb;
    UI.nameCb = null;
    if (cb) cb();
    else UI.show('main');
  };

  // ---------------------------------------------------------------- online queue
  /** Reset the queue screen (shared by "find a match" and "rematch") and return the callbacks the online client reports to. */
  function queueScreen(title, retryLabel) {
    UI.show('queue');
    $('queue-me').textContent = RV.profile.get();
    $('queue-opp').textContent = '?';
    $('queue-title').textContent = title;
    const st = $('queue-status');
    st.className = 'queue-status';
    st.textContent = 'Connecting\u2026';
    $('btn-queue-cancel').textContent = 'Cancel';
    $('btn-queue-enter').classList.add('hidden');
    $('btn-queue-retry').classList.add('hidden');
    $('btn-queue-retry').textContent = retryLabel;
    $('btn-queue-net').classList.add('hidden');
    const t0 = Date.now();
    clearInterval(UI.queueTimer);
    UI.queueTimer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('queue-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 500);
    $('queue-time').textContent = '0:00';
    const cb = {
      onStatus: (text, ph) => {
        st.className = 'queue-status';
        st.textContent = text;
        if (ph === 'searching') $('queue-opp').textContent = '?';
      },
      onMatched: (opp) => {
        clearInterval(UI.queueTimer);
        UI.rematchActive = false;
        $('queue-opp').textContent = opp;
        $('queue-title').textContent = 'Match found';
        st.textContent = 'Starting the match\u2026';
        $('btn-queue-cancel').textContent = 'Leave';
      },
      onReady: (opp) => {
        // pointer lock needs a click: the match starts when you press Enter
        st.textContent = 'Click to enter the match against ' + opp;
        const b = $('btn-queue-enter');
        b.classList.remove('hidden');
        b.focus();
      },
      onError: (msg) => {
        clearInterval(UI.queueTimer);
        UI.rematchActive = false;
        $('btn-queue-enter').classList.add('hidden');
        $('btn-queue-retry').classList.remove('hidden');
        $('btn-queue-net').classList.remove('hidden');
        st.className = 'queue-status err';
        st.textContent = msg;
        $('queue-title').textContent = title === 'Rematch' ? 'No rematch' : 'Could not queue';
        $('btn-queue-cancel').textContent = 'Back';
      },
      // the other player's answer to a rematch request ('left' / 'closed': no rematch will happen)
      onRematch: (s) => {
        if (s === 'left' || s === 'closed') cb.onError(s === 'left' ? 'Your opponent left, so there is no rematch.' : 'The rematch window closed.');
      },
    };
    return cb;
  }

  UI.startQueue = function () {
    UI.rematchActive = false;
    RV.online.queue(queueScreen('Finding an opponent', 'Try again'));
  };

  /** From the results screen: ask the same opponent for another match (the server starts it when both agree). */
  UI.startRematch = function () {
    UI.rematchActive = true;
    const cb = queueScreen('Rematch', 'Find new match');
    $('queue-opp').textContent = RV.online.oppName;
    RV.online.rematch(cb);
  };

  UI.cancelQueue = function () {
    clearInterval(UI.queueTimer);
    if (UI.rematchActive) {
      // waiting for a rematch: the finished game is still loaded, so leaving it closes the room for the other player too
      UI.rematchActive = false;
      RV.game.stop();
      UI.show('main');
      return;
    }
    RV.online.cancelQueue();
    if (RV.online.matched && !RV.online.started) RV.online.leave();
    UI.show('main');
  };

  /** A rematch message arrived while the results screen is showing (the opponent asked, or left). */
  UI.rematchMsg = function (s) {
    if (UI.rematchActive) return;
    const note = $('res-note'),
      btn = $('btn-rematch');
    if (!note || RV.game.state !== 'results') return;
    if (s === 'opp') {
      note.textContent = RV.online.oppName + ' wants a rematch.';
      note.classList.remove('hidden');
      btn.textContent = 'Accept rematch';
    } else if (s === 'left' || s === 'closed') {
      note.textContent = s === 'left' ? RV.online.oppName + ' left, so there is no rematch.' : 'The rematch window closed.';
      note.classList.remove('hidden');
      btn.classList.add('hidden');
    }
  };

  // ---------------------------------------------------------------- loadout (weapon selection)
  /** Relative bar lengths 0..1 for: damage, fire rate, magazine, range. */
  const BARS = {
    rifle: [0.2, 1.0, 0.8, 0.95],
    pistol: [0.2, 0.72, 0.5, 0.6],
    fists: [0.5, 0.36, 1.0, 0.1],
    grenade: [1.0, 0.12, 0.2, 0.42],
  };
  const BAR_LABELS = ['Damage', 'Rate', 'Mag', 'Range'];

  function weaponCard(w, i, selected, tag) {
    const c = document.createElement(tag || 'button');
    c.className = 'lo-card' + (selected ? ' sel' : '');
    const st = w.stats;
    const vals = [st.damage + (w.kind === 'grenade' ? ' max' : ''), st.rate, st.mag, st.range];
    let bars = '';
    for (let k = 0; k < 4; k++) bars += '<div class="lo-stat"><span>' + BAR_LABELS[k] + '</span><span class="tr"><i style="width:' + Math.round(BARS[w.id][k] * 100) + '%"></i></span><b>' + vals[k] + '</b></div>';
    c.innerHTML = '<span class="lo-badge">Start weapon</span><span class="lo-slot">SLOT ' + (i + 1) + '</span><i class="ic" data-ic="' + w.id + '"></i><h3>' + w.name + '</h3><p>' + w.desc + '</p>' + bars;
    return c;
  }

  UI.renderLoadout = function () {
    const box = $('loadout-cards');
    box.innerHTML = '';
    RV.WEAPONS.forEach((w, i) => {
      const c = weaponCard(w, i, RV.settings.startWeapon === i, 'button');
      c.addEventListener('click', () => {
        RV.settings.startWeapon = i;
        RV.settingsApi.save();
        // opened from the pause menu: equip it right away
        if (UI.loadoutFromPause && RV.game.weapons) RV.game.weapons.select(i);
        UI.renderLoadout();
        RV.icons.hydrate(box);
        const sel = box.querySelector('.lo-card.sel');
        if (sel) sel.focus({ preventScroll: true });
      });
      box.appendChild(c);
    });
    RV.icons.hydrate(box);
  };

  /** The weapon strip on the main menu (slot, icon, name). */
  UI.renderMainWeapons = function () {
    const box = $('main-weapons');
    if (!box) return;
    box.innerHTML = '';
    RV.WEAPONS.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'ws';
      d.innerHTML = '<i class="ic" data-ic="' + w.id + '"></i><div><b>' + w.name + '</b><span>Slot ' + (i + 1) + '</span></div>';
      box.appendChild(d);
    });
    RV.icons.hydrate(box);
  };

  // ---------------------------------------------------------------- records
  UI.renderRecords = function () {
    const d = RV.records.data;
    let html = '<h3>Duel</h3><table><tr><th>Map</th><th>Wins / matches</th><th>Rounds</th><th>Best streak</th></tr>';
    for (const id of RV.mapOrder) {
      if (RV.maps[id].modes.indexOf('duel') < 0) continue;
      const r = RV.records.duel(id);
      html += '<tr><td>' + RV.maps[id].name + '</td><td class="v">' + r.wins + ' / ' + r.matches + '</td><td>' + r.roundsWon + ' – ' + r.roundsLost + '</td><td>' + r.bestStreak + '</td></tr>';
    }
    const on = d.online;
    html = '<h3>Online 1v1</h3><table><tr><th>Matches</th><th>Wins</th><th>Rounds</th><th>Win streak</th><th>Best streak</th></tr><tr><td class="v">' + on.matches + '</td><td class="v">' + on.wins + '</td><td>' + on.roundsWon + ' \u2013 ' + on.roundsLost + '</td><td>' + on.streak + '</td><td>' + on.bestStreak + '</td></tr></table>' + html;
    html += '</table><h3>Time Trial</h3><table><tr><th>Map</th><th>Best time</th><th>Top speed</th><th>Runs</th></tr>';
    for (const id of RV.mapOrder) {
      if (RV.maps[id].modes.indexOf('timetrial') < 0) continue;
      const r = RV.records.tt(id);
      html += '<tr><td>' + RV.maps[id].name + '</td><td class="v">' + RV.fmtTime(r.best) + '</td><td>' + (r.topSpeed ? r.topSpeed.toFixed(1) + ' m/s' : '--') + '</td><td>' + r.runs + '</td></tr>';
    }
    html += '</table><h3>Deathmatch</h3><table><tr><th>Map</th><th>Best elims</th><th>Fastest win</th><th>Wins / matches</th><th>K / D</th></tr>';
    for (const id of RV.mapOrder) {
      if (RV.maps[id].modes.indexOf('arena') < 0) continue;
      const r = RV.records.arena(id);
      html += '<tr><td>' + RV.maps[id].name + '</td><td class="v">' + r.bestKills + '</td><td>' + (r.fastestWin != null ? RV.fmtTime(r.fastestWin, 1) : '--') + '</td><td>' + r.wins + ' / ' + r.matches + '</td><td>' + (r.deaths ? (r.kills / r.deaths).toFixed(2) : r.kills) + '</td></tr>';
    }
    const t = d.totals;
    html += '</table><h3>Lifetime</h3><table><tr><td>Fastest speed ever</td><td class="v">' + (t.topSpeed || 0).toFixed(1) + ' m/s</td></tr>' +
      '<tr><td>Practice top speed</td><td class="v">' + (d.practiceTopSpeed || 0).toFixed(1) + ' m/s</td></tr>' +
      '<tr><td>Arena eliminations</td><td class="v">' + t.kills + '</td></tr>' +
      '<tr><td>Arena accuracy</td><td class="v">' + (t.shots ? Math.round((t.hits / t.shots) * 100) + '%' : '--') + '</td></tr></table>';
    $('records-body').innerHTML = html;
  };

  // ---------------------------------------------------------------- results
  UI.showResults = function (r) {
    $('res-title').textContent = r.title;
    $('btn-retry').textContent = r.online ? 'Find new match' : 'Play again';
    let html = '<div class="res-big ' + (r.bigClass || '') + '">' + r.big + '</div><div class="res-sub">' + r.sub + '</div>';
    html += '<table class="res-table">';
    for (const [k, v] of r.rows) html += '<tr><td>' + k + '</td><td>' + v + '</td></tr>';
    html += '</table>';
    if (r.splits && r.splits.length) {
      html += '<div class="res-sub" style="margin-top:12px">Splits: ' + r.splits.map((s) => RV.fmtTime(s)).join(' · ') + '</div>';
    }
    $('res-body').innerHTML = html;
    const rm = $('btn-rematch');
    rm.classList.toggle('hidden', !r.rematch);
    rm.textContent = 'Rematch';
    $('res-note').classList.add('hidden');
    UI.show('results');
  };

  // ---------------------------------------------------------------- wiring
  UI.init = function () {
    document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => {
      RV.audio.play('click');
      if (b.dataset.mode === 'online') UI.requireName(() => UI.startQueue());
      else UI.openSelect(b.dataset.mode);
    }));
    // username screen
    $('name-input').addEventListener('input', () => UI.validateName());
    $('name-input').addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !$('btn-name-ok').disabled) UI.confirmName();
      else if (e.code === 'Escape') UI.back();
      e.stopPropagation(); // typing must not drive the menu navigation
    });
    $('btn-name-ok').addEventListener('click', () => UI.confirmName());
    $('btn-name-rand').addEventListener('click', () => {
      $('name-input').value = RV.profile.random();
      UI.validateName();
      $('name-input').focus();
    });
    $('btn-name-back').addEventListener('click', () => {
      UI.nameCb = null;
      if (RV.profile.get()) UI.show('main');
      else $('name-input').focus();
    });
    $('btn-change-name').addEventListener('click', () => {
      UI.nameCb = null;
      UI.show('name');
    });
    $('btn-queue-cancel').addEventListener('click', () => UI.cancelQueue());
    $('btn-queue-retry').addEventListener('click', () => UI.startQueue());
    $('btn-queue-net').addEventListener('click', () => {
      UI.tab = 'network';
      UI.settingsOpenFromPause = false;
      UI.show('settings');
    });
    $('btn-queue-enter').addEventListener('click', () => {
      RV.audio.init();
      RV.online.enter();
    });
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      RV.audio.init();
      RV.audio.play('click');
      UI.show(b.dataset.open);
    }));
    document.querySelectorAll('#settings-tabs button').forEach((b) => b.addEventListener('click', () => {
      UI.tab = b.dataset.tab;
      UI.renderSettings();
    }));
    $('settings-back').addEventListener('click', () => UI.back());
    $('loadout-back').addEventListener('click', () => UI.back());
    $('btn-pause-loadout').addEventListener('click', () => {
      UI.loadoutFromPause = true;
      UI.show('loadout');
    });
    window.addEventListener('keydown', UI.onKey);
    RV.icons.hydrate(document);
    UI.renderMainWeapons();

    $('opt-bots').addEventListener('input', (e) => {
      RV.settings.botCount = +e.target.value;
      $('out-bots').textContent = e.target.value;
      RV.settingsApi.save();
    });
    $('opt-diff').addEventListener('change', (e) => {
      RV.settings.difficulty = e.target.value;
      RV.settingsApi.save();
    });
    $('opt-diff-duel').addEventListener('change', (e) => {
      RV.settings.difficulty = e.target.value;
      RV.settingsApi.save();
    });
    $('opt-duelto').addEventListener('change', (e) => {
      RV.settings.duelTo = +e.target.value;
      RV.settingsApi.save();
    });
    $('opt-kills').addEventListener('change', (e) => {
      RV.settings.killLimit = +e.target.value;
      RV.settingsApi.save();
    });

    $('btn-start').addEventListener('click', () => {
      RV.audio.init();
      if (RV.settings.fullscreen) RV.enterFullscreen();
      RV.game.start(UI.selMode, UI.selMap, {
        bots: RV.settings.botCount,
        diff: RV.settings.difficulty,
        kills: RV.settings.killLimit,
        duelTo: RV.settings.duelTo,
      });
    });

    // pause menu
    $('btn-resume').addEventListener('click', () => {
      RV.input.requestLock();
      if (RV.input.noLock) RV.game.resume();
    });
    $('scr-pause').addEventListener('mousedown', (e) => {
      if (e.target === $('scr-pause')) {
        RV.input.requestLock();
        if (RV.input.noLock) RV.game.resume();
      }
    });
    $('btn-restart').addEventListener('click', () => {
      RV.game.restart();
      RV.input.requestLock();
      if (RV.input.noLock) RV.game.resume();
    });
    $('btn-pause-settings').addEventListener('click', () => {
      UI.settingsOpenFromPause = true;
      UI.show('settings');
    });
    $('btn-fullscreen').addEventListener('click', () => {
      RV.toggleFullscreen();
      setTimeout(() => ($('btn-fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'), 250);
    });
    $('btn-quit').addEventListener('click', () => {
      RV.game.stop();
      UI.show('main');
    });

    // results
    $('btn-retry').addEventListener('click', () => {
      if (RV.game.modeImpl && RV.game.modeImpl.realtime) {
        // online: back to the queue for a new opponent
        RV.game.stop();
        UI.requireName(() => UI.startQueue());
        return;
      }
      UI.hideAll();
      RV.input.requestLock();
      RV.game.restart();
    });
    $('btn-res-menu').addEventListener('click', () => {
      RV.game.stop();
      UI.show('main');
    });
    $('btn-rematch').addEventListener('click', () => {
      RV.audio.play('click');
      UI.startRematch();
    });

    $('btn-reset-records').addEventListener('click', () => {
      if (window.confirm('Delete all personal bests and stats?')) {
        RV.records.reset();
        UI.renderRecords();
      }
    });
  };
})();
