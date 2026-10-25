/* DASHDUEL - small, sharp, single-colour interface icons (inline SVG, drawn with currentColor). */
(function () {
  'use strict';
  const RV = window.RV;

  const svg = (vb, body) => '<svg viewBox="' + vb + '" fill="currentColor" aria-hidden="true" focusable="false">' + body + '</svg>';

  RV.icons = {
    // weapons (side views, barrel to the right)
    rifle: svg(
      '0 0 48 20',
      '<path d="M1 7.5h4V7h2.5l1-1H31V4.2h12.5V6H46v2.2h-2.5V11H31.5l-.7.9h-5.6l1.3 7.1h-4.1l-1.8-7.1h-3.5l-2.6 6.5h-3.6l2.4-6.5H9.5V13H5.5l-.7.8H1z"/>'
    ),
    pistol: svg(
      '0 0 32 20',
      '<path d="M3 3h22l2 1.5V9h-3v1H13v1h-1l-1.5 8h-6L6 11H3z"/><path d="M13 11h6v1.5h-6z" opacity=".55"/>'
    ),
    fists: svg(
      '0 0 24 24',
      '<path d="M5 8h3.4v3H5zM8.9 6.5h3.4V10H8.9zM12.8 6.5h3.4V10h-3.4zM16.7 8H20v3h-3.3z"/><path d="M5 11.5h15V17H5z"/><path d="M2.5 12.5H5v4H2.5z"/><path d="M7 17.5h11V21H7z" opacity=".6"/>'
    ),
    grenade: svg(
      '0 0 24 24',
      '<path d="M7.5 10h9l1.5 2v6l-2 2.5H8L6 18v-6z"/><path d="M10 5.5h4V10h-4z"/><path d="M14 6.2l5 1.6v2.4l-3-.7z" opacity=".75"/><circle cx="6.5" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/>'
    ),
    // interface
    health: svg('0 0 24 24', '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
    shield: svg('0 0 24 24', '<path d="M12 2.5l8 3v6.2c0 4.6-3.2 8.1-8 9.8-4.8-1.7-8-5.2-8-9.8V5.5z"/>'),
    chevrons: svg('0 0 24 24', '<path d="M12 4l7 7h-4l-3-3-3 3H5zM12 12l7 7h-4l-3-3-3 3H5z"/>'),
    skull: svg('0 0 24 24', '<path d="M12 2.5c4.4 0 7.5 3 7.5 7 0 2.4-1 4-2.5 5V19h-3.5v-2h-3v2H7v-4.5c-1.5-1-2.5-2.6-2.5-5 0-4 3.1-7 7.5-7zM9 9.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2zm6 0a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z"/>'),
    arrow: svg('0 0 24 24', '<path d="M8 4l9 8-9 8V4z"/>'),
    check: svg('0 0 24 24', '<path d="M9.5 16.2L5.3 12l-1.8 1.8 6 6L21 8l-1.8-1.8z"/>'),
  };

  /** Fill every <i class="ic" data-ic="name"> with its icon. */
  RV.icons.hydrate = function (root) {
    (root || document).querySelectorAll('[data-ic]').forEach((el) => {
      const k = el.getAttribute('data-ic');
      if (RV.icons[k] && el.getAttribute('data-done') !== k) {
        el.innerHTML = RV.icons[k];
        el.setAttribute('data-done', k);
      }
    });
  };
})();
