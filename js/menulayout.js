/* DASHDUEL - main menu layouts.
 *
 * Two arrangements of the SAME main menu (same buttons, same handlers, same Arcade styling):
 *   B - Cinematic: a centred Play hero over the 3D arena, navigation in a slim bar above it.
 *   D - Arcade Lobby: side navigation, the play panel on the right, the loadout bottom-left.
 * A layout is only an attribute on <html> (data-menu="b" | "d") that css/theme-arcade.css reacts to, so switching
 * is instant, needs no reload, rebuilds nothing and cannot touch a running match, the connection or any setting
 * other than this one. The saved choice is applied by a tiny script in <head> before the first paint.
 */
(function () {
  'use strict';
  const RV = window.RV;
  const KEY = 'rivel.menuLayout';

  const LIST = [
    { id: 'B', name: 'B — Cinematic' },
    { id: 'D', name: 'D — Arcade Lobby' },
  ];
  const L = (RV.menuLayout = { id: 'B', list: LIST });
  const valid = (id) => LIST.some((o) => o.id === id);

  /** Mark the current layout everywhere it is shown (main-menu switch + Settings), nothing else. */
  function refresh() {
    document.documentElement.setAttribute('data-menu', L.id.toLowerCase());
    document.querySelectorAll('[data-layout]').forEach((b) => {
      const on = b.dataset.layout === L.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  L.set = function (id) {
    if (!valid(id)) return false;
    L.id = id;
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      /* storage blocked: the layout still applies for this visit */
    }
    refresh();
    return true;
  };
  L.toggle = () => L.set(L.id === 'B' ? 'D' : 'B');

  // one delegated handler serves the switch on the main menu and the buttons in Settings
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-layout]');
    if (!b) return;
    if (RV.audio) {
      RV.audio.init();
      RV.audio.play('click');
    }
    L.set(b.dataset.layout);
  });

  // ---- interface style: 'rivals' (default) or 'arcade' - an attribute on <html> (data-ui), the css does the rest
  const US = (RV.uiStyle = { id: document.documentElement.getAttribute('data-ui') === 'arcade' ? 'arcade' : 'rivals', list: [{ id: 'rivals', name: 'RIVALS' }, { id: 'arcade', name: 'Arcade' }] });
  US.set = function (id) {
    if (id !== 'rivals' && id !== 'arcade') return false;
    US.id = id;
    document.documentElement.setAttribute('data-ui', id);
    try {
      localStorage.setItem('rivel.uiStyle', id);
    } catch (e) {
      /* storage blocked: the style still applies for this visit */
    }
    document.querySelectorAll('[data-uistyle]').forEach((b) => {
      b.classList.toggle('on', b.dataset.uistyle === id);
      b.setAttribute('aria-pressed', b.dataset.uistyle === id ? 'true' : 'false');
    });
    return true;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-uistyle]');
    if (!b) return;
    if (RV.audio) {
      RV.audio.init();
      RV.audio.play('click');
    }
    US.set(b.dataset.uistyle);
  });

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
    localStorage.removeItem('rivel.theme'); // the Tactical theme and its switch were removed
  } catch (e) {
    /* ignore */
  }
  L.id = valid(saved) ? saved : 'B';
  refresh();
})();
