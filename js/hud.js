/* DASHDUEL - in-game HUD (plain DOM, updates only when values change). */
(function () {
  'use strict';
  const RV = window.RV;
  const $ = (id) => document.getElementById(id);

  const H = (RV.hud = { el: {}, last: {}, dmg: [], visible: false });

  function setText(key, node, text) {
    if (H.last[key] !== text) {
      H.last[key] = text;
      node.textContent = text;
    }
  }

  H.init = function () {
    const ids = [
      'hud', 'hp-fill', 'hp-val', 'vital-hp', 'ammo-val', 'ammo-max', 'reload-label', 'speed-val', 'speed-fill', 'state-label',
      'top-speed', 'hud-title', 'hud-timer', 'hud-sub', 'hud-split', 'hud-center', 'hud-hint', 'hud-feed', 'fps',
      'cp-marker', 'hitmarker', 'vignette', 'blast', 'dmg-layer', 'hud-practice', 'practice-stats', 'scoreboard', 'toast',
      'hud-left', 'hud-right', 'hud-top', 'hud-elim', 'duel-banner', 'tp-you', 'tp-bot', 'tp-botname', 'tp-round', 'weapon-bar', 'weapon-name',
      'dmgnums', 'match-banner', 'crosshair', 'death-screen', 'ds-name', 'ds-resp', 'nade-hold', 'tp-me',
    ];
    for (const id of ids) H.el[id] = $(id);
    H.markerDist = H.el['cp-marker'].querySelector('.cp-dist');
    // weapon slots 1..4, built once from the weapon table
    const bar = H.el['weapon-bar'];
    bar.innerHTML = '';
    H.slots = [];
    RV.WEAPONS.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'wslot';
      d.innerHTML =
        '<span class="wn">' + (i + 1) + '</span><i class="ic" data-ic="' + w.id + '"></i>' +
        (w.kind === 'grenade' ? '<span class="cnt"></span><span class="cd"></span>' : '') +
        (w.doubleJump ? '<span class="dj"><i class="ic" data-ic="chevrons"></i></span>' : '');
      bar.appendChild(d);
      H.slots.push(d);
    });
    RV.icons.hydrate(bar);
    RV.icons.hydrate(H.el['vital-hp'].parentNode);
    H.nadeSlot = H.slots[RV.WEAPONS.findIndex((w) => w.kind === 'grenade')];
    H.djSlot = H.slots[RV.WEAPONS.findIndex((w) => w.doubleJump)];
    H.dnumCount = 0;
    H.applyCrosshair();
  };

  H.show = function () {
    H.el.hud.classList.remove('hidden');
    H.visible = true;
  };
  H.hide = function () {
    H.el.hud.classList.add('hidden');
    H.visible = false;
  };

  H.applyCrosshair = function (root) {
    const s = RV.settings;
    const r = (root || document.documentElement).style;
    r.setProperty('--xs', s.xhSize + 'px');
    r.setProperty('--xg', s.xhGap + 'px');
    r.setProperty('--xt', s.xhThick + 'px');
    r.setProperty('--xc', s.xhColor);
    document.querySelectorAll('.xdot').forEach((d) => (d.style.display = s.xhDot ? 'block' : 'none'));
  };

  H.reset = function () {
    H.last = {};
    H.dmg.length = 0;
    H.el['dmg-layer'].innerHTML = '';
    H.el['hud-feed'].innerHTML = '';
    H.el['hud-center'].className = '';
    H.el['hud-split'].className = '';
    H.el['hud-hint'].className = '';
    H.el['cp-marker'].className = '';
    H.el.scoreboard.classList.add('hidden');
    H.el['hud-practice'].classList.add('hidden');
    H.el['hitmarker'].className = '';
    H.el['vignette'].className = '';
    H.el['blast'].className = '';
    H.el['hud-elim'].className = '';
    H.el['duel-banner'].classList.add('hidden');
    H.el['dmgnums'].innerHTML = '';
    H.el['match-banner'].classList.add('hidden');
    H.el['death-screen'].classList.add('hidden');
    H.el['crosshair'].style.opacity = '';
  };

  /** Health: number + thin bar (everyone has 150, nobody has a shield). */
  H.setVitals = function (hp) {
    const v = Math.max(0, Math.ceil(hp));
    if (H.last.hp !== v) {
      H.last.hp = v;
      H.el['hp-val'].textContent = v;
      H.el['hp-fill'].style.width = Math.max(0, Math.min(100, (v / RV.MAX_HP) * 100)) + '%';
      H.el['vital-hp'].classList.toggle('low', v <= RV.MAX_HP * 0.3);
    }
  };

  /**
   * Current weapon + ammunition. Guns show rounds; fists show the double-jump state in the
   * label line; grenades show the stock and a restock / cooldown line.
   */
  H.setWeapon = function (w, ammo, reloading, grenades, gcharge, cooldownSec) {
    setText('wname', H.el['weapon-name'], w.name);
    let val, max, label, labelOn;
    if (w.kind === 'gun') {
      val = String(ammo);
      max = '/ ' + w.mag;
      label = reloading ? 'RELOADING' : '';
      labelOn = reloading;
    } else if (w.kind === 'melee') {
      val = '—';
      max = '';
      label = '';
      labelOn = false;
    } else {
      const gw = RV.WEAPON_BY_ID.grenade;
      val = String(grenades);
      max = '/ ' + gw.maxCount;
      label = grenades < gw.maxCount ? 'COOLDOWN ' + Math.ceil(cooldownSec) + ' s' : 'READY';
      labelOn = true;
    }
    setText('ammo', H.el['ammo-val'], val);
    setText('mag', H.el['ammo-max'], max);
    setText('rlab', H.el['reload-label'], label);
    if (H.last.rlOn !== labelOn) {
      H.last.rlOn = labelOn;
      H.el['reload-label'].classList.toggle('on', labelOn);
    }
    const low = w.kind === 'gun' && ammo > 0 && ammo <= w.mag * 0.25;
    const empty = (w.kind === 'gun' && ammo <= 0) || (w.kind === 'grenade' && grenades <= 0);
    const cls = (low ? 'low ' : '') + (empty ? 'empty' : '');
    if (H.last.rcls !== cls) {
      H.last.rcls = cls;
      H.el['hud-right'].className = cls;
    }
  };

  /** Highlight the selected slot; grenade stock + restock fill; double-jump pips on the fists slot. */
  H.setWeaponBar = function (cur, grenades, gcharge, dj) {
    const key = cur + '|' + grenades + '|' + Math.round(gcharge * 50) + '|' + dj;
    if (H.last.wbar === key) return;
    H.last.wbar = key;
    for (let i = 0; i < H.slots.length; i++) H.slots[i].classList.toggle('on', i === cur);
    if (H.nadeSlot) {
      H.nadeSlot.querySelector('.cnt').textContent = grenades;
      H.nadeSlot.classList.toggle('out', grenades <= 0);
      H.nadeSlot.querySelector('.cd').style.width = (gcharge < 1 ? gcharge * 100 : 0) + '%';
    }
    if (H.djSlot) H.djSlot.querySelector('.dj').classList.toggle('used', dj === 2);
  };

  /** Grenade hold timer under the crosshair: fills over the 3 s; red once the circle is coming for you. */
  H.nadeHold = function (show, frac, closing) {
    const e = H.el['nade-hold'];
    if (H.last.nhShow !== show) {
      H.last.nhShow = show;
      e.classList.toggle('hidden', !show);
    }
    if (!show) return;
    const w = Math.round(RV.clamp(frac, 0, 1) * 100);
    if (H.last.nhW !== w) {
      H.last.nhW = w;
      e.firstElementChild.style.width = w + '%';
    }
    if (H.last.nhC !== closing) {
      H.last.nhC = closing;
      e.classList.toggle('closing', closing);
    }
  };

  /** Pulse the double-jump pips when it fires. */
  H.doubleJump = function () {
    if (!H.djSlot) return;
    const e = H.djSlot.querySelector('.dj');
    e.classList.remove('pulse');
    void e.offsetWidth;
    e.classList.add('pulse');
  };

  /** Floating damage number next to the crosshair (DOM only: never moves the camera). */
  H.damageNumber = function (dmg, head, kill) {
    const box = H.el.dmgnums;
    const d = document.createElement('div');
    // white for a body shot, red for a headshot
    d.className = 'dnum' + (head ? ' head' : '') + (kill ? ' kill' : '') + (H.dnumCount++ % 2 ? ' r' : ' l');
    d.textContent = dmg;
    box.appendChild(d);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 650);
  };

  /** Minimal kill confirmation under the crosshair. */
  H.eliminated = function (text) {
    const e = H.el['hud-elim'];
    e.innerHTML = '<b>ELIMINATED</b>' + String(text).toUpperCase();
    e.className = '';
    void e.offsetWidth;
    e.className = 'show';
    clearTimeout(H._elT);
    H._elT = setTimeout(() => (e.className = ''), 1000);
  };

  /** Duel score row (YOU 2 | ROUND 3 | 1 NAME) above the timer. */
  H.duel = function (show, you, bot, botName, to, round) {
    const e = H.el['duel-banner'];
    e.classList.toggle('hidden', !show);
    if (!show) return;
    const key = you + '|' + bot + '|' + botName + '|' + to + '|' + round + '|' + RV.profile.display();
    if (H.last.duel === key) return;
    H.last.duel = key;
    H.el['tp-me'].textContent = RV.profile.display().toUpperCase().slice(0, 12);
    H.el['tp-you'].textContent = you;
    H.el['tp-bot'].textContent = bot;
    H.el['tp-botname'].textContent = String(botName).toUpperCase();
    H.el['tp-round'].textContent = 'R' + round + ' · FT' + to;
  };

  /**
   * End-of-match card that never pauses the game: it simply sits over the action
   * for a few seconds while the next match starts to load.
   */
  H.matchBanner = function (show, r) {
    const e = H.el['match-banner'];
    e.classList.toggle('hidden', !show);
    if (!show) return;
    let html = '<div class="mb-title">' + r.title + '</div><div class="mb-big ' + (r.bigClass || '') + '">' + r.big + '</div><div class="mb-sub">' + r.sub + '</div><div class="mb-rows">';
    for (const [k, v] of r.rows) html += '<span>' + k + '</span><b>' + v + '</b>';
    html += '</div><div class="mb-next">Next match starting…</div>';
    e.innerHTML = html;
  };

  /** Death screen: killer + weapon + respawn countdown (never blocks input). */
  H.deathScreen = function (show, info, respawn) {
    const e = H.el['death-screen'];
    if (H.last.ds !== show) {
      H.last.ds = show;
      e.classList.toggle('hidden', !show);
    }
    if (!show) return;
    setText('dsn', H.el['ds-name'], info ? info.name : '');
    setText('dsr', H.el['ds-resp'], respawn >= 0 ? 'RESPAWN IN ' + respawn.toFixed(1) : '');
  };

  /** Grenade flash for a nearby blast (white, short, fades out). */
  H.blast = function (k) {
    const e = H.el.blast;
    e.style.opacity = String(Math.min(0.85, 0.25 + 0.6 * k));
    e.className = 'on';
    clearTimeout(H._blT);
    H._blT = setTimeout(() => {
      e.style.opacity = '';
      e.className = '';
    }, 70);
  };

  /** Fade the crosshair while aiming down sights so the sight picture stays clean. */
  H.setAdsFade = function (ads) {
    const v = ads > 0.01 ? String(1 - 0.62 * ads) : '';
    if (H.last.xa !== v) {
      H.last.xa = v;
      H.el['crosshair'].style.opacity = v;
    }
  };

  H.setSpeed = function (speed, top, label) {
    const v = speed.toFixed(1);
    setText('spd', H.el['speed-val'], v);
    const pct = Math.min(100, (speed / 45) * 100) | 0;
    if (H.last.spct !== pct) {
      H.last.spct = pct;
      H.el['speed-fill'].style.width = pct + '%';
    }
    setText('top', H.el['top-speed'], 'top ' + top.toFixed(1));
    setText('state', H.el['state-label'], label);
  };

  H.setTitle = (t) => setText('title', H.el['hud-title'], t);
  H.setTimer = (t) => setText('timer', H.el['hud-timer'], t);
  H.setSub = (t) => setText('sub', H.el['hud-sub'], t);

  H.split = function (text, cls) {
    const e = H.el['hud-split'];
    e.textContent = text;
    e.className = 'on ' + (cls || '');
    clearTimeout(H._splitT);
    H._splitT = setTimeout(() => (e.className = ''), 3200);
  };

  H.center = function (text, color, pop, ms) {
    const e = H.el['hud-center'];
    e.textContent = text;
    e.style.color = color || '#fff';
    e.className = 'show';
    if (pop) {
      void e.offsetWidth;
      e.className = 'show pop';
    }
    clearTimeout(H._cT);
    if (ms) H._cT = setTimeout(() => (e.className = ''), ms);
  };
  H.centerHide = function () {
    H.el['hud-center'].className = '';
  };

  H.hint = function (text) {
    const e = H.el['hud-hint'];
    if (!text) {
      e.className = '';
      return;
    }
    e.innerHTML = text;
    e.className = 'show';
  };

  H.hitMarker = function (kill) {
    const e = H.el.hitmarker;
    e.className = 'on' + (kill ? ' kill' : '');
    void e.offsetWidth;
    clearTimeout(H._hmT);
    H._hmT = setTimeout(() => (e.className = (kill ? 'kill ' : '') + 'fade'), 60);
  };

  H.damageFlash = function () {
    const v = H.el.vignette;
    v.className = 'on';
    clearTimeout(H._vT);
    H._vT = setTimeout(() => (v.className = ''), 80);
  };

  /** Directional indicator: remembers where the damage came from and keeps pointing at it. */
  H.addDamageSource = function (x, z) {
    const div = document.createElement('div');
    div.className = 'dmg';
    H.el['dmg-layer'].appendChild(div);
    H.dmg.push({ x, z, life: 1.2, div });
  };

  H.updateDamage = function (dt, px, pz, yaw) {
    if (!H.dmg.length) return;
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw),
      rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    for (let i = H.dmg.length - 1; i >= 0; i--) {
      const d = H.dmg[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.div.remove();
        H.dmg.splice(i, 1);
        continue;
      }
      const dx = d.x - px,
        dz = d.z - pz;
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      d.div.style.transform = 'rotate(' + ((ang * 180) / Math.PI).toFixed(1) + 'deg)';
      d.div.style.opacity = Math.min(1, d.life / 0.6);
    }
  };

  /** Plain feed line (legacy callers). */
  H.feed = function (text, cls) {
    const f = H.el['hud-feed'];
    const d = document.createElement('div');
    d.className = 'kf ' + (cls || '');
    d.textContent = text;
    f.appendChild(d);
    while (f.children.length > 5) f.removeChild(f.firstChild);
    setTimeout(() => d.remove(), 4500);
  };

  /** Kill feed row: killer [weapon icon] victim. cls: 'k' you killed, 'd' you died. */
  H.killfeed = function (killer, weaponId, victim, cls) {
    const f = H.el['hud-feed'];
    const d = document.createElement('div');
    d.className = 'kf ' + (cls || '');
    const icon = weaponId && RV.icons[weaponId] ? '<i class="ic" data-ic="' + weaponId + '"></i>' : '<i class="ic" data-ic="skull"></i>';
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
    d.innerHTML = '<span class="' + (killer === RV.profile.display() ? 'you' : '') + '">' + esc(killer) + '</span>' + icon + '<b>' + esc(victim) + '</b>';
    RV.icons.hydrate(d);
    f.appendChild(d);
    while (f.children.length > 5) f.removeChild(f.firstChild);
    setTimeout(() => d.remove(), 4500);
  };

  H.toast = function (text, ms) {
    const t = H.el.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(H._tT);
    H._tT = setTimeout(() => t.classList.remove('on'), ms || 2200);
  };

  H.setFps = (text) => setText('fps', H.el.fps, text);

  H.practice = function (show, text) {
    H.el['hud-practice'].classList.toggle('hidden', !show);
    if (show && text != null) setText('pstats', H.el['practice-stats'], text);
  };

  H.scoreboard = function (show, html) {
    H.el.scoreboard.classList.toggle('hidden', !show);
    if (show && html != null && H.last.sb !== html) {
      H.last.sb = html;
      H.el.scoreboard.innerHTML = html;
    }
  };

  /**
   * Position the checkpoint diamond over a world point, or pin an arrow to the
   * screen edge when it is off-screen / behind us.
   */
  const _v = new THREE.Vector3();
  const _p = new THREE.Vector3();
  H.marker = function (cam, x, y, z, distText, finish) {
    const e = H.el['cp-marker'];
    const W = window.innerWidth,
      Hh = window.innerHeight;
    _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v.z > 0;
    _p.set(x, y, z).project(cam);
    let sx = (_p.x * 0.5 + 0.5) * W,
      sy = (-_p.y * 0.5 + 0.5) * Hh;
    const m = 46,
      mt = 104, // keep clear of the timer
      mb = 150; // ...and of the weapon bar
    let edge = false,
      rot = 0;
    if (behind || sx < m || sx > W - m || sy < mt || sy > Hh - mb) {
      edge = true;
      let dx = _v.x,
        dy = _v.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = -1;
      const kx = dx === 0 ? Infinity : (W / 2 - m) / Math.abs(dx);
      const ky = dy === 0 ? Infinity : dy > 0 ? (Hh / 2 - mt) / dy : (Hh / 2 - mb) / -dy;
      const k = Math.min(kx, ky);
      sx = W / 2 + dx * k;
      sy = Hh / 2 - dy * k;
      rot = (Math.atan2(dx, dy) * 180) / Math.PI;
    }
    e.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
    const cls = 'on' + (edge ? ' edge' : '') + (finish ? ' fin' : '');
    if (H.last.mcls !== cls) {
      H.last.mcls = cls;
      e.className = cls;
    }
    if (edge) e.style.setProperty('--rot', rot.toFixed(1) + 'deg');
    setText('mdist', H.markerDist, distText);
  };
  H.markerHide = function () {
    if (H.last.mcls !== '') {
      H.last.mcls = '';
      H.el['cp-marker'].className = '';
    }
  };
})();
