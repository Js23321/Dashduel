/* DASHDUEL - interface themes.
 *
 * A theme is nothing but <html data-theme="..."> plus the two stylesheets (css/theme-tactical.css,
 * css/theme-arcade.css). Switching changes that attribute and nothing else: no reload, no DOM rebuild,
 * and no game state is touched, so a running match and the controls are unaffected.
 * The saved choice is applied by a tiny script in <head> before the first paint (no flash).
 */
(function () {
  'use strict';
  const RV = window.RV;
  const KEY = 'rivel.theme';

  const THEMES = [
    {
      id: 'tactical',
      name: 'Tactical',
      color: '#0c0e11',
      desc: 'Competitive and clean. Charcoal panels, crisp white type, one restrained red accent and a compact HUD that stays out of your way.',
    },
    {
      id: 'arcade',
      name: 'Arcade',
      color: '#080c18',
      desc: 'Fast and energetic. Angled navy panels, bright cyan accents, larger weapon slots and louder hit and elimination feedback.',
    },
  ];

  const T = (RV.theme = { id: 'tactical', list: THEMES, listeners: [] });
  const byId = (id) => THEMES.find((t) => t.id === id);

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  /** Keep every theme-aware control in sync (cheap: a handful of nodes). */
  function refresh() {
    const t = byId(T.id);
    const name = document.getElementById('theme-name');
    if (name) name.textContent = t.name;
    const pb = document.getElementById('btn-pause-theme');
    if (pb) pb.textContent = 'Theme: ' + t.name;
    document.querySelectorAll('.theme-card').forEach((c) => {
      const on = c.dataset.themeId === T.id;
      c.classList.toggle('sel', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.color);
  }

  T.set = function (id) {
    if (!byId(id)) return false;
    T.id = id;
    document.documentElement.setAttribute('data-theme', id);
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      /* storage blocked: the theme still applies for this visit */
    }
    refresh();
    for (const fn of T.listeners) fn(id);
    return true;
  };

  T.toggle = function () {
    return T.set(T.id === 'tactical' ? 'arcade' : 'tactical');
  };

  /** Static mock-up of the HUD and a few menu controls, drawn with the real theme variables. */
  T.previewHTML = function (id) {
    return (
      '<div class="pv-box"><div class="pv" data-theme="' + id + '" aria-hidden="true"><div class="pv-scene"></div>' +
      '<div class="pv-top"><span class="s"><i>YOU</i><b>3</b></span><span class="m">R5 &middot; FT5</span><span class="s r"><b>2</b><i>OPP</i></span></div>' +
      '<div class="pv-feed"><span><u>YOU</u> &rsaquo; OPP</span></div>' +
      '<div class="pv-xh"><i></i><i></i><i></i><i></i></div>' +
      '<div class="pv-hit"><i></i><i></i><i></i><i></i></div>' +
      '<div class="pv-hp"><b>150</b><span><i></i></span></div>' +
      '<div class="pv-slots"><span class="on">1</span><span>2</span><span>3</span><span>4</span></div>' +
      '<div class="pv-ammo"><small>ASSAULT RIFLE</small><b>24</b><em>/ 30</em></div></div></div>' +
      '<div class="pv-menu" data-theme="' + id + '" aria-hidden="true"><span class="b p">Play</span><span class="b">Loadout</span><span class="b">Settings</span><span class="sw"><i></i></span></div>'
    );
  };

  // start-up: the <head> script already set the attribute; adopt it (or the stored value)
  const fromAttr = document.documentElement.getAttribute('data-theme');
  const start = byId(fromAttr) ? fromAttr : byId(stored()) ? stored() : 'tactical';
  T.id = start;
  document.documentElement.setAttribute('data-theme', start);
  refresh();
})();
