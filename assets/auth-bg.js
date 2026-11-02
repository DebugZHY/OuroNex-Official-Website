/* Animated page background for the public auth pages.
   Reuses the Home background set: one of these SVGs is picked at random on each
   load, exactly like the Home hero, and injected inline so its internal CSS
   animations run. Keep this list in step with HERO_SOURCES in assets/home.js;
   the paths are root-absolute because /login/ and /register/ are not the site root. */
(() => {
  'use strict';

  const BACKGROUND_SOURCES = [
    '/assets/backgrounds/perspective-grid.svg',
    '/assets/backgrounds/contour-field.svg',
    '/assets/backgrounds/facade-lines.svg',
    '/assets/backgrounds/isometric-frame.svg',
    '/assets/backgrounds/vertical-city.svg',
    '/assets/backgrounds/wave-mesh.svg'
  ];

  const host = document.querySelector('[data-auth-background]');
  if (!host || typeof fetch !== 'function') return;

  const source = BACKGROUND_SOURCES[Math.floor(Math.random() * BACKGROUND_SOURCES.length)];

  const inject = markup => {
    if (typeof markup !== 'string' || !markup.trim()) return;
    let svg = null;
    try {
      const parsed = new DOMParser().parseFromString(markup.trim(), 'image/svg+xml');
      const root = parsed && parsed.documentElement;
      if (root && root.tagName && root.tagName.toLowerCase() === 'svg') svg = root;
    } catch {
      svg = null;
    }
    if (!svg) {
      const template = document.createElement('template');
      template.innerHTML = markup.trim();
      svg = template.content.querySelector('svg');
      if (!svg) return;
    }
    const copy = document.importNode(svg, true);
    copy.querySelectorAll('script').forEach(node => node.remove());
    copy.setAttribute('focusable', 'false');
    copy.setAttribute('aria-hidden', 'true');
    host.replaceChildren(copy);
    host.dataset.background = source;
  };

  fetch(source)
    .then(response => (response && response.ok ? response.text() : Promise.reject(new Error('background unavailable'))))
    .then(inject)
    .catch(() => {
      /* The page keeps its plain dark surface if the background cannot load. */
    });
})();
