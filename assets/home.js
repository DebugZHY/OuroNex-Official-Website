/* ==========================================================================
   OuroNex Home interactions
   Native free scrolling for main#main.home-scroll, one randomized animated
   background per section behind a shared background layer, smooth anchor
   scrolling, a reversible five-scene scroll theatre, and the native "Available soon" /
   "Coming soon" alerts. Pure helpers are exported for the throwaway Node
   harness; DOM wiring only runs in a browser.
   ========================================================================== */

(function (global, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.OuroHome = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        api.loadSectionBackgrounds();
        api.init();
      }, { once: true });
    } else {
      api.loadSectionBackgrounds();
      api.init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HERO_SOURCES = Object.freeze([
    'assets/backgrounds/perspective-grid.svg',
    'assets/backgrounds/contour-field.svg',
    'assets/backgrounds/facade-lines.svg',
    'assets/backgrounds/isometric-frame.svg',
    'assets/backgrounds/vertical-city.svg',
    'assets/backgrounds/wave-mesh.svg'
  ]);
  var BACKGROUND_SOURCES = HERO_SOURCES;
  var BACKGROUND_HOST_SELECTOR = '[data-section-background]';
  var BACKGROUND_CONTAINER_CLASS = 'home-backgrounds';
  var BACKGROUND_CONTAINER_SELECTOR = '.home-backgrounds';
  var MOVED_BACKGROUND_HOST_SELECTOR = '[data-section-background][data-background-section]';
  var AVAILABLE_SOON_SELECTOR = '[data-download], [data-available-soon]';
  var COMING_SOON_SELECTOR = '[data-coming-soon]';
  var NAV_LINK_SELECTOR = '.nav-primary a[href], .footer-nav a[href]';
  var MOTION_ITEM_SELECTOR = [
    '.hero-copy > *',
    '.hero-demo',
    '.feature-tab-list > button',
    '.feature-panel',
    '.sida-3d',
    '.download-actions > .button',
    '.download-actions > .button-outline',
    '.download-actions > .release-note',
    '.application-panel__header > h2',
    '.application-panel__header > .plan-description',
    '.plan-mini > .plan-details',
    '.application-workflow-stage',
    '.business-intro > h2',
    '.business-flow',
    '.business-flow > .flow > .flow-stage > .flow-card',
    '.business-flow > .flow > .flow-band',
    '.business-flow > .flow > .flow-final',
    '.about-intro > h2',
    '.about-intro > .about-lede',
    '.about-founder > .about-founder__card',
    '.site-footer .footer-brand',
    '.site-footer .footer-nav',
    '.site-footer .footer-socials',
    '.site-footer .footer-copyright',
    '.site-footer .footer-legal'
  ].join(', ');
  var DEMO_INTERVAL_MS = 10000;
  var DEMO_SLIDE_SELECTOR = '.hero-demo__slide';
  var DEMO_CONTROL_SELECTOR = '.hero-demo__control';

  var booted = false;

  /* ------------------------------------------------------------------ */
  /* Pure helpers                                                        */
  /* ------------------------------------------------------------------ */

  function clampIndex(index, count) {
    var total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (!total) return 0;
    var value = Number.isFinite(index) ? Math.floor(index) : 0;
    return Math.min(total - 1, Math.max(0, value));
  }

  function motionDelayFor(index, step, cap) {
    var position = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    var increment = Number.isFinite(step) ? Math.max(0, step) : 0;
    var ceiling = Number.isFinite(cap) ? Math.max(0, cap) : 0;
    return Math.min(ceiling, position * increment);
  }

  function nextDemoIndex(index, count) {
    var total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (!total) return 0;
    return (clampIndex(index, total) + 1) % total;
  }

  /* One classification for both the exported helper and every runtime target.
     Headings and the feature rail take priority; legacy selectors remain for
     callers outside the current homepage markup. */
  function motionVariantFor(element) {
    if (!element || typeof element.matches !== 'function') return 'rise';
    if (element.matches('h1, h2')) return 'headline';
    if (element.matches('.hero-copy h1')) return 'headline';
    if (element.matches('.hero-copy .hero-actions')) return 'actions';
    if (element.matches('.hero-copy > *')) return 'copy';
    if (element.matches('.hero-demo')) return 'perspective';
    if (element.matches('.feature-tab-list > button')) return 'rail';
    if (element.matches('.feature-panel')) return 'mask';
    if (element.matches('.download-actions > .button')) return 'pop';
    if (element.matches('.download-actions > .button-outline')) return 'pop';
    if (element.matches('.download-actions > .release-note')) return 'fade';
    if (element.matches('.plan-strip > .plan-mini')) return 'fade';
    if (element.matches('.delivery > h2')) return 'slide';
    if (element.matches('.process > h2')) return 'slide';
    if (element.matches('.delivery-grid > article')) return 'depth';
    if (element.matches('.process-list > article')) return 'drift';
    if (element.matches('.about-intro > h2')) return 'slide';
    if (element.matches('.home-footer > .footer-brand-block')) return 'fade';
    if (element.matches('.home-footer > .footer-copyright')) return 'fade';
    if (element.matches('.home-footer > .footer-content')) return 'drift';
    if (element.matches('.application-panel__header > h2, .business-intro > h2')) return 'slide';
    if (element.matches('.plan-description, .about-lede')) return 'copy';
    if (element.matches('.plan-details, .footer-copyright, .footer-brand')) return 'fade';
    if (element.matches('.footer-nav, .footer-socials, .footer-legal')) return 'actions';
    if (element.matches('.application-workflow-stage, .business-flow, .about-founder__card, .sida-3d')) return 'depth';
    if (element.matches('.flow-card, .flow-band, .flow-final')) return 'drift';
    return 'rise';
  }

  /* Stable content coordinates, with a wider retention zone than entry zone.
     Direction describes the phase only; reversing never hides readable content. */
  function motionWindowFor(metrics) {
    var m = metrics || {};
    var height = Math.max(1, Number(m.viewportHeight) || 1);
    var viewportTop = Number(m.viewportTop) || 0;
    var viewportBottom = viewportTop + height;
    var top = Number(m.top) || 0;
    var bottom = Math.max(top, Number(m.bottom) || top);
    var lead = Math.min(160, Math.max(48, height * 0.18));
    var retention = Math.min(360, Math.max(120, height * 0.4));
    var visible = bottom >= viewportTop && top <= viewportBottom;
    var near = bottom >= viewportTop - lead && top <= viewportBottom + lead;
    var retained = bottom >= viewportTop - retention && top <= viewportBottom + retention;
    var state = m.keepVisible || near || (m.previous === 'in' && retained) ? 'in' : 'out';
    var approaching = Number(m.direction) < 0 ? bottom < viewportTop : top > viewportBottom;
    return {
      state: state,
      phase: visible || m.keepVisible ? 'hold' : state === 'in' && approaching ? 'enter' : 'leave'
    };
  }

  function motionLayerFor(item) {
    if (item.matches('.release-note')) return 4;
    if (item.matches('h1, h2, .footer-brand')) return 0;
    if (item.matches('.hero-description, .plan-description, .about-lede, .footer-copyright')) return 1;
    if (item.matches('.hero-actions, .feature-tab-list > button, .download-actions > .button, .download-actions > .button-outline, .footer-nav, .footer-socials, .footer-legal')) return 2;
    return 3;
  }

  /* Computed transform excludes the theatre's independent translate/scale.
     Preserve the 3D mark's original translateY(-50%) in its stable bounds. */
  function transformTranslationY(transform) {
    var match = /^matrix(3d)?\(([^)]+)\)$/.exec(transform || '');
    if (!match) return 0;
    var values = match[2].split(',').map(Number);
    if (values.length !== (match[1] ? 16 : 6) || !values.every(Number.isFinite)) return 0;
    return values[match[1] ? 13 : 5];
  }

  function sceneUnit(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  function sceneEase(value) {
    var t = sceneUnit(value);
    return t * t * (3 - 2 * t);
  }

  /* Distances are CSS pixels. The two stationary hold screens flank the exact
     overflow distance; panning is deliberately linear, one pixel per pixel. */
  function sceneWindowFor(metrics) {
    var m = metrics || {};
    var vh = Number.isFinite(m.viewportHeight) ? Math.max(1, m.viewportHeight) : 1;
    var overflow = Number.isFinite(m.overflow) ? Math.max(0, m.overflow) : 0;
    var start = Number.isFinite(m.start) ? m.start : 0;
    var position = (Number.isFinite(m.scrollTop) ? m.scrollTop : 0) - start;
    var enterSpan = m.first ? 0 : 1.25 * vh;
    var holdSpan = 2 * vh + overflow;
    var exitSpan = m.last ? 0 : vh;
    var duration = enterSpan + holdSpan + exitSpan;
    var phase = position < 0 ? 'before' : position < enterSpan ? 'enter'
      : position < enterSpan + holdSpan || m.last ? 'hold'
        : position < duration ? 'leave' : 'after';
    return {
      phase: phase,
      enter: position < 0 ? 0 : m.first ? 1 : sceneUnit((position / enterSpan - 0.12) / 0.88),
      exit: m.last ? 0 : sceneUnit((position - enterSpan - holdSpan) / exitSpan),
      pan: Math.max(0, Math.min(overflow, position - enterSpan - vh)),
      duration: duration
    };
  }

  /* Each ordered wave finishes within its allotted span, even with many items. */
  function sceneStaggerFor(progress, index, count) {
    var spread = count > 1 ? 0.3 : 0;
    var offset = count > 1 ? clampIndex(index, count) / (count - 1) * spread : 0;
    return sceneEase((progress - offset) / (1 - spread));
  }

  /* An item below the initial viewport waits for the pan to bring it onstage.
     Upper items of long scenes exit while still above the header edge, not long
     after disappearing. The final scene has no exit at all. */
  function sceneItemProgressFor(metrics) {
    var m = metrics || {};
    var windowState = m.window || { enter: 1, exit: 0, pan: 0 };
    var vh = Math.max(1, Number(m.viewportHeight) || 1);
    var overflow = Math.max(0, Number(m.overflow) || 0);
    var top = Number(m.top) || 0;
    var bottom = Math.max(top + 1, Number(m.bottom) || top + 1);
    var enter = sceneStaggerFor(windowState.enter, m.entryIndex || 0, m.entryCount || 1);
    if (top >= vh && overflow > 0) {
      var revealStart = Math.min(overflow, Math.max(0, top - vh));
      var revealEnd = Math.min(overflow, revealStart + Math.min(vh * 0.3, bottom - top));
      enter = revealEnd > revealStart ? sceneEase((windowState.pan - revealStart) / (revealEnd - revealStart))
        : windowState.pan >= revealEnd ? 1 : 0;
    }
    var exit = m.last ? 0 : sceneStaggerFor(windowState.exit, m.exitIndex || 0, m.exitCount || 1);
    if (!m.last && bottom <= overflow + (m.headerHeight || 0)) {
      var leaveEnd = Math.max(1, bottom - (m.headerHeight || 0));
      var leaveStart = Math.max(0, leaveEnd - Math.min(vh * 0.24, bottom - top));
      exit = Math.max(exit, sceneEase((windowState.pan - leaveStart) / (leaveEnd - leaveStart)));
    }
    return { enter: enter, exit: exit };
  }

  /* Half-open track intervals share their boundary; there is never a spacer
     viewport between scenes. The last scene also owns the maximum scroll. */
  function sceneIndexFor(scrollTop, starts) {
    var index = 0;
    for (var i = 1; i < starts.length; i += 1) {
      if (scrollTop < starts[i]) break;
      index = i;
    }
    return index;
  }

  function backgroundPool() {
    return BACKGROUND_SOURCES.slice();
  }

  function selectBackgroundSource(random, allowGrid) {
    var pool = backgroundPool();
    var value = typeof random === 'number' && Number.isFinite(random) ? random : 0;
    var index = Math.floor(value * pool.length);
    index = Math.max(0, Math.min(pool.length - 1, index));
    return pool[index];
  }

  /* Kept for callers that still speak about the single random hero. */
  function selectHeroSource(random, allowGrid) {
    return selectBackgroundSource(random, allowGrid);
  }

  /* Each section draws its own source; unused engines are preferred so two
     sections do not show the identical animation while alternatives remain. */
  function planSectionBackgrounds(random, allowGrid, count) {
    var total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    var base = backgroundPool();
    var remaining = base.slice();
    var plan = [];
    for (var index = 0; index < total; index += 1) {
      if (!remaining.length) remaining = base.slice();
      var value = typeof random === 'function' ? random() : random;
      var pick = Math.floor((Number.isFinite(value) ? value : 0) * remaining.length);
      pick = Math.max(0, Math.min(remaining.length - 1, pick));
      plan.push(remaining[pick]);
      remaining.splice(pick, 1);
    }
    return plan;
  }

  /* Native, never translated: the alert text is intentionally a literal. */
  function showAvailableSoon(view) {
    if (!view || typeof view.alert !== 'function') return false;
    view.alert('Available soon');
    return true;
  }

  function availableSoonTrigger(event) {
    if (!event || !event.target) return null;
    var target = event.target;
    if (typeof target.closest !== 'function') return null;
    return target.closest(AVAILABLE_SOON_SELECTOR) || null;
  }

  /* Shared by every [data-download] and [data-available-soon] control; modified
     clicks on a real link are left to the browser so navigation is not stolen. */
  function handleAvailableSoon(event, view) {
    var trigger = availableSoonTrigger(event);
    if (!trigger) return false;
    if (trigger.tagName === 'A') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (event.button !== undefined && event.button !== 0) return false;
    }
    if (typeof event.preventDefault === 'function') event.preventDefault();
    showAvailableSoon(view);
    return true;
  }

  /* Social placeholders use the browser's native alert with their own message. */
  function showComingSoon(view) {
    if (!view || typeof view.alert !== 'function') return false;
    view.alert('Coming soon');
    return true;
  }

  function handleComingSoon(event, view) {
    if (!event || !event.target || typeof event.target.closest !== 'function') return false;
    var trigger = event.target.closest(COMING_SOON_SELECTOR);
    if (!trigger) return false;
    if (trigger.tagName === 'A') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (event.button !== undefined && event.button !== 0) return false;
    }
    if (typeof event.preventDefault === 'function') event.preventDefault();
    showComingSoon(view);
    return true;
  }

  function sectionIndexFor(scrollTop, tops) {
    var value = Number(scrollTop) || 0;
    var list = Array.isArray(tops) ? tops : [];
    if (!list.length) return 0;
    var best = 0;
    var bestDistance = Infinity;
    for (var index = 0; index < list.length; index += 1) {
      var distance = Math.abs(value - (Number(list[index]) || 0));
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  function shouldIgnoreWheel(target, home) {
    if (!target || typeof target.closest !== 'function') return false;
    var doc = target.ownerDocument;
    if (doc && doc.querySelector && doc.querySelector('dialog[open]')) return true;
    if (target.closest('dialog[open]')) return true;
    if (target.closest('input, textarea, select, option, table, [contenteditable]:not([contenteditable="false"])')) return true;

    var boundary = home && home.contains && home.contains(target) ? home : null;
    var node = target;
    while (node && node !== boundary) {
      if (node.nodeType === 1) {
        var owner = node.ownerDocument;
        var view = owner && owner.defaultView;
        var style = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(node) : null;
        var overflow = (style && style.overflowX) || (node.style && node.style.overflowX) || '';
        if ((overflow === 'auto' || overflow === 'scroll') &&
            Number(node.scrollWidth) > Number(node.clientWidth) + 1) {
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  /* A section taller than the viewport (About, with three biographies) owns its
     own native scroll range. The predicate reports when the viewport still sits
     inside that range, so callers can leave the gesture to the browser. Pure
     numeric inputs keep the boundary behaviour deterministic for the Node
     harnesses. */
  function shouldUseNativeScroll(metrics) {
    var m = metrics || {};
    var deltaY = Number(m.deltaY) || 0;
    var deltaX = Number(m.deltaX) || 0;
    if (!deltaY) return false;
    if (Math.abs(deltaY) <= Math.abs(deltaX)) return false;

    var viewport = Number(m.viewportHeight) || 0;
    var height = Number(m.sectionHeight) || 0;
    var top = Number(m.sectionTop) || 0;
    var scrollTop = Number(m.scrollTop) || 0;
    var room = height - viewport;
    if (!(room > 1)) return false;

    var bottom = top + room;
    var maxScroll = Number(m.maxScroll);
    if (Number.isFinite(maxScroll) && maxScroll < bottom) bottom = maxScroll;

    if (deltaY > 0) return scrollTop < bottom - 1;
    return scrollTop > top + 1;
  }

  function decodeHash(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function collectSections(doc) {
    var home = doc.querySelector('main#main.home-scroll');
    return Array.prototype.slice.call((home || doc).querySelectorAll('[data-home-section]'));
  }

  function sectionBackgroundHost(section) {
    return section ? section.querySelector(BACKGROUND_HOST_SELECTOR) || section.querySelector('.hero-media') : null;
  }

  /* Pair every section with its background host, including hosts that already
     live in the shared layer after being moved out of their section. */
  function backgroundHostEntries(doc) {
    var moved = Array.prototype.slice.call(doc.querySelectorAll(MOVED_BACKGROUND_HOST_SELECTOR));
    var entries = [];
    collectSections(doc).forEach(function (section) {
      var host = sectionBackgroundHost(section);
      if (!host && section.id) {
        host = moved.filter(function (candidate) {
          return candidate.getAttribute('data-background-section') === section.id;
        })[0] || null;
      }
      if (host) entries.push({ id: section.id || '', host: host });
    });
    return entries;
  }

  /* Create the shared background layer in front of the scroller and move every
     section host into it. Hosts keep their existing attributes and any fetch
     already running against them, because the element itself is moved. */
  function initUnifiedBackgrounds(doc) {
    if (!doc || !doc.body) return null;
    var home = doc.querySelector('main#main.home-scroll');
    if (!home || !home.parentNode || !doc.body.contains(home)) return null;

    var container = doc.querySelector(BACKGROUND_CONTAINER_SELECTOR);
    if (!container) {
      container = doc.createElement('div');
      container.className = BACKGROUND_CONTAINER_CLASS;
      container.setAttribute('aria-hidden', 'true');
    }
    if (container.parentNode !== home.parentNode || container.nextSibling !== home) {
      home.parentNode.insertBefore(container, home);
    }

    var entries = backgroundHostEntries(doc);
    entries.forEach(function (entry) {
      if (entry.id) entry.host.setAttribute('data-background-section', entry.id);
      if (entry.host.parentNode !== container) container.appendChild(entry.host);
    });
    return { container: container, entries: entries };
  }

  function parseSvg(markup, doc) {
    if (typeof markup !== 'string' || !markup.trim()) return null;
    var svg = null;
    var view = doc.defaultView;
    if (view && typeof view.DOMParser === 'function') {
      try {
        var parsed = new view.DOMParser().parseFromString(markup.trim(), 'image/svg+xml');
        var root = parsed && parsed.documentElement;
        if (root && root.tagName && root.tagName.toLowerCase() === 'svg') svg = root;
      } catch (error) {
        svg = null;
      }
    }
    if (!svg) {
      var template = doc.createElement('template');
      template.innerHTML = markup.trim();
      svg = template.content && template.content.querySelector('svg');
    }
    return svg ? doc.importNode(svg, true) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Section backgrounds (existing engines only)                         */
  /* ------------------------------------------------------------------ */

  var backgroundsPrimed = false;

  function injectBackground(host, source, markup, doc) {
    var svg = parseSvg(markup, doc);
    if (!svg) return;
    svg.classList.add('hero-vector');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    var scripts = svg.querySelectorAll('script');
    for (var index = scripts.length - 1; index >= 0; index -= 1) {
      if (scripts[index].parentNode) scripts[index].parentNode.removeChild(scripts[index]);
    }
    host.dataset.background = source;
    host.replaceChildren(svg);
  }

  function applySectionBackground(host, source, doc, view) {
    if (!host || typeof source !== 'string' || !source) return;
    if (host.dataset.backgroundReady === '1') return;
    host.dataset.backgroundReady = '1';

    host.removeAttribute('data-motion-field');
    if (!view || typeof view.fetch !== 'function') return;

    view.fetch(source).then(function (response) {
      if (!response || !response.ok) throw new Error('Background request failed');
      return response.text();
    }).then(function (markup) {
      injectBackground(host, source, markup, doc);
    }).catch(function () {
      /* A missing background must never affect the page. */
    });
  }

  function initSectionBackgrounds(doc, view) {
    if (backgroundsPrimed || !doc) return;
    backgroundsPrimed = true;

    var hosts = backgroundHostEntries(doc).map(function (entry) {
      return entry.host;
    });
    if (!hosts.length) return;

    var plan = planSectionBackgrounds(Math.random, false, hosts.length);
    for (var index = 0; index < hosts.length; index += 1) {
      applySectionBackground(hosts[index], plan[index], doc, view);
    }
  }

  /* Scrolling selects complete part animations; clocks own their playback.
     The displayed stage stays mounted until its current part and exit finish. */
  function initSectionMotion(doc, view, options) {
    if (!doc || !view) return null;
    var home = doc.querySelector('main#main.home-scroll');
    if (!home || !doc.body) return null;
    if (home.__ouroTheatre) return home.__ouroTheatre;
    var sections = collectSections(doc);
    if (!sections.length || !view.OuroSceneClock) return null;
    var settings = options || {};
    var header = doc.querySelector('.site-header');
    var media = view.matchMedia ? view.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var supportsStage = !view.CSS || !view.CSS.supports || view.CSS.supports('position', 'sticky');
    var raf = view.requestAnimationFrame ? view.requestAnimationFrame.bind(view) : function (fn) { return view.setTimeout(fn, 16); };
    var caf = view.cancelAnimationFrame ? view.cancelAnimationFrame.bind(view) : view.clearTimeout.bind(view);
    var now = function () { return view.performance ? view.performance.now() : Date.now(); };
    var scenes = [];
    var enabled = null;
    var vh = 1;
    var headerHeight = 0;
    var frame = 0;
    var dirty = true;
    var ready = false;
    var total = 0;
    var activeIndex = -1;
    var notifiedIndex = -1;
    var bookmark = null;
    var previousScroll = home.scrollTop;
    var direction = 1;
    var initialHash = decodeHash((view.location.hash || '').slice(1));
    var initialIndex = sections.findIndex(function (section) { return section.id === initialHash; });
    var initialScroll = home.scrollTop;
    var scrollRange = doc.createElement('div');
    scrollRange.className = 'home-scene-range';
    scrollRange.setAttribute('aria-hidden', 'true');

    function property(element, name, value) {
      if (element.style.getPropertyValue(name) === value) return;
      if (value === '') element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    }
    function attribute(element, name, value) {
      if (value === null) element.removeAttribute(name);
      else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    function layoutTop(element) {
      var top = 0;
      for (var node = element; node; node = node.offsetParent) {
        top += node.offsetTop || 0;
        if (node.offsetParent) top += node.offsetParent.clientTop || 0;
      }
      return top;
    }
    function instantScroll(top) {
      if (typeof home.scrollTo === 'function') {
        try { home.scrollTo({ top: top, behavior: 'instant' }); return; } catch (error) { /* Older engines. */ }
      }
      home.scrollTop = top;
    }
    function firstEnter(scene) { return scene.first ? 0 : 1.25 * vh; }
    function windowFor(scene, scrollTop) {
      return sceneWindowFor({ scrollTop: scrollTop, start: scene.start, viewportHeight: vh,
        overflow: scene.overflow, first: scene.first, last: scene.last });
    }
    function scrollIndex() {
      return sceneIndexFor(home.scrollTop, scenes.map(function (scene) { return enabled ? scene.start : scene.plainTop; }));
    }
    function currentIndex() {
      return enabled && activeIndex >= 0 ? activeIndex : scrollIndex();
    }
    function readingTop(scene, pan) {
      if (!enabled) return scene.plainTop + Math.min(scene.overflow, Math.max(0, pan || 0));
      if (scene.first && !pan) return scene.start;
      return scene.start + firstEnter(scene) + (pan > 0 ? vh + Math.min(scene.overflow, pan) : vh * 0.5);
    }
    function capture() {
      var scene = scenes[scrollIndex()];
      var position = home.scrollTop - (enabled ? scene.start : scene.plainTop);
      if (!enabled) return { index: scene.index, phase: 'reading', pan: Math.max(0, Math.min(scene.overflow, position)) };
      var state = windowFor(scene, home.scrollTop);
      var hold = position - firstEnter(scene);
      var part = hold < vh ? 'top' : hold <= vh + scene.overflow ? 'pan' : 'bottom';
      return { index: scene.index, phase: state.phase, pan: state.pan, part: part,
        ratio: state.phase === 'enter' ? position / firstEnter(scene) : state.phase === 'leave' ? state.exit
          : part === 'top' ? hold / vh : part === 'bottom' ? (hold - vh - scene.overflow) / vh : 0 };
    }
    function restore(point) {
      var scene = scenes[clampIndex(point.index, scenes.length)];
      if (!enabled) return scene.plainTop + Math.min(scene.overflow, point.pan);
      if (point.phase === 'reading') return readingTop(scene, point.pan);
      if (point.phase === 'enter') return scene.start + firstEnter(scene) * sceneUnit(point.ratio);
      if (point.phase === 'leave' || point.phase === 'after') return scene.start + firstEnter(scene) + 2 * vh + scene.overflow + (scene.last ? 0 : sceneUnit(point.ratio) * vh);
      return scene.start + firstEnter(scene) + (point.part === 'top' ? sceneUnit(point.ratio) * vh
        : point.part === 'bottom' ? vh + scene.overflow + sceneUnit(point.ratio) * vh
          : vh + Math.min(scene.overflow, point.pan));
    }

    sections.forEach(function (section, index) {
      var track = doc.createElement('div');
      var stage = doc.createElement('div');
      track.className = 'home-scene-track';
      stage.className = 'home-scene-stage';
      track.setAttribute('data-scene-id', section.id);
      section.parentNode.insertBefore(track, section);
      track.appendChild(stage);
      stage.appendChild(section);
      var business = section.querySelector('.business-flow');
      var fallback = business && business.querySelector(':scope > .flow');
      var partCount = Math.max(1, Math.min(3, Number(section.getAttribute('data-scene-parts')) || 1));
      var parts = Array.from({ length: partCount }, function (_, partIndex) {
        return { index: partIndex, roots: [], top: 0, bottom: 0, desired: false };
      });
      scenes.push({ section: section, track: track, stage: stage, index: index,
        first: index === 0, last: index === sections.length - 1, start: 0, plainTop: 0, overflow: 0, duration: 0,
        business: business, fallback: fallback, parts: parts, pan: 0, reverseEntry: false,
        clock: view.OuroSceneClock.create({ count: partCount, enterDuration: 920, exitDuration: 760, lead: 60 }),
        records: Array.prototype.slice.call(section.querySelectorAll(MOTION_ITEM_SELECTOR)).map(function (item, order) {
          var partRoot = item.closest('[data-scene-part]');
          var partIndex = Math.max(0, Math.min(partCount - 1,
            (Number(partRoot && partRoot.getAttribute('data-scene-part')) || 1) - 1));
          return { item: item, order: order, layer: motionLayerFor(item),
            variant: motionVariantFor(item), partIndex: partIndex, managed: false };
        })
      });
    });
    home.appendChild(scrollRange);
    doc.body.removeAttribute('data-section-motion');

    function measure() {
      var previousMode = enabled;
      var previousVh = vh;
      var previousTotal = total;
      var oldDurations = scenes.map(function (scene) { return scene.duration; });
      var point = ready ? bookmark : null;
      enabled = supportsStage && !media.matches;
      vh = Math.max(1, home.clientHeight);
      headerHeight = Math.min(vh * 0.4, header ? header.offsetHeight : 0);
      // Mode changes are one bounded write/read transaction. Ordinary scroll
      // frames below never read animated geometry or change layout dimensions.
      attribute(doc.body, 'data-home-theatre', enabled ? 'on' : 'reduced');
      scenes.forEach(function (scene) {
        property(scene.track, '--scene-vh', enabled ? vh + 'px' : '');
        property(scene.track, '--scene-width', enabled ? home.clientWidth + 'px' : '');
        if (!enabled) {
          property(scene.track, 'height', '');
          property(scene.track, 'margin-bottom', '');
          property(scene.section, '--scene-pan-y', '0px');
        }
      });
      var origin = layoutTop(home) + (home.clientTop || 0);
      total = 0;
      scenes.forEach(function (scene) {
        var sectionTop = layoutTop(scene.section);
        var splitBusiness = !!(scene.fallback && scene.fallback.offsetHeight > vh - headerHeight);
        var bottom = scene.section.offsetHeight;
        scene.records.forEach(function (record) {
          var item = record.item;
          record.enabled = item === scene.business ? !splitBusiness
            : scene.fallback && scene.fallback.contains(item) ? splitBusiness : true;
          record.rendered = !item.closest('[hidden]') && !!(item.offsetHeight || item.offsetWidth);
          var localY = record.rendered && view.getComputedStyle
            ? transformTranslationY(view.getComputedStyle(item).transform) : 0;
          record.top = layoutTop(item) - sectionTop + localY;
          record.bottom = record.top + item.offsetHeight;
          if (record.enabled && record.rendered) bottom = Math.max(bottom, record.bottom);
          record.entryIndex = record.exitIndex = 0;
          record.entryCount = record.exitCount = 1;
        });
        scene.height = Math.max(vh, bottom);
        scene.overflow = Math.max(0, scene.height - vh);
        scene.plainTop = sectionTop - origin;
        scene.start = total;
        scene.duration = windowFor(scene, scene.start).duration;
        total += scene.duration;
        scene.parts.forEach(function (part) {
          part.roots = scene.section.getAttribute('data-scene-part') === String(part.index + 1) ? [scene.section]
            : Array.prototype.slice.call(scene.section.querySelectorAll('[data-scene-part="' + (part.index + 1) + '"]'));
          var live = scene.records.filter(function (record) {
            return record.partIndex === part.index && record.enabled && record.rendered;
          });
          part.top = live.length ? Math.min.apply(null, live.map(function (record) { return record.top; })) : 0;
          part.bottom = live.length ? Math.max.apply(null, live.map(function (record) { return record.bottom; })) : 0;
          var entry = live.slice().sort(function (a, b) { return a.layer - b.layer || a.order - b.order; });
          var exit = live.slice().sort(function (a, b) { return b.layer - a.layer || b.order - a.order; });
          entry.forEach(function (record, i) { record.entryIndex = i; record.entryCount = entry.length; });
          exit.forEach(function (record, i) { record.exitIndex = i; record.exitCount = exit.length; });
        });
      });
      var changed = previousMode !== enabled || previousVh !== vh || previousTotal !== total
        || scenes.some(function (scene, i) { return scene.duration !== oldDurations[i]; });
      property(scrollRange, 'height', enabled ? (total + vh) + 'px' : '');
      scenes.forEach(function (scene) {
        scene.records.forEach(function (record) {
          if (record.enabled) {
            attribute(record.item, 'data-motion-item', '');
            attribute(record.item, 'data-motion-variant', record.variant);
            attribute(record.item, 'data-motion-part', String(record.partIndex + 1));
          } else if (record.managed) {
            record.item.removeAttribute('data-motion-item');
            record.item.removeAttribute('data-motion-variant');
            record.item.removeAttribute('data-motion-part');
            record.item.removeAttribute('inert');
            property(record.item, '--scene-enter', '');
            property(record.item, '--scene-exit', '');
          }
          record.item.removeAttribute('data-motion-state');
          record.managed = record.enabled;
        });
      });
      if (ready && changed && point) {
        var maximum = enabled ? total : Math.max(0, scenes.at(-1).plainTop + scenes.at(-1).height - vh);
        instantScroll(Math.max(0, Math.min(maximum, restore(point))));
      } else if (!ready && initialIndex >= 0) {
        instantScroll(readingTop(scenes[initialIndex], 0));
      } else if (!ready && enabled && initialScroll > 0) {
        instantScroll(Math.min(total, initialScroll));
      }
      if (previousMode !== enabled) {
        activeIndex = scrollIndex();
        scenes.forEach(function (scene) {
          var visible = !enabled || (previousMode === false && scene.index === activeIndex);
          scene.clock.settle(scene.parts.map(function () { return visible; }));
        });
      }
      ready = true;
      dirty = false;
      if (changed) notifiedIndex = -1;
    }

    function releaseFocus(scene) {
      var focused = doc.activeElement;
      if (!focused || !scene.stage.contains(focused)) return;
      if (typeof focused.blur === 'function') focused.blur();
      var tabIndex = home.getAttribute('tabindex');
      home.setAttribute('tabindex', '-1');
      home.focus({ preventScroll: true });
      if (tabIndex === null) home.removeAttribute('tabindex');
      else home.setAttribute('tabindex', tabIndex);
    }
    function targetsFor(scene, state) {
      var count = scene.parts.length;
      var position = home.scrollTop - scene.start;
      var enterSpan = firstEnter(scene);
      var exitStart = enterSpan + 2 * vh + scene.overflow;
      var slack = Math.min(24, vh * 0.025);
      if (state.phase !== 'leave') scene.reverseEntry = false;
      return scene.parts.map(function (part, index) {
        var entryAt = scene.first ? index * vh * 0.55 : index * enterSpan / count;
        var exitAt = exitStart + (count - 1 - index) * vh / count;
        var visible = position >= entryAt - (part.desired ? slack : 0);
        if (!scene.last && position >= exitAt + (part.desired ? slack : 0)) visible = false;
        if (scene.reverseEntry && state.phase === 'leave') {
          visible = state.duration - position >= (count - 1 - index) * vh / count;
        }
        part.desired = visible;
        return visible;
      });
    }
    function allHidden(snapshot) {
      return !snapshot.running && snapshot.parts.every(function (part) { return part.phase === 'hidden'; });
    }
    function paint() {
      var scrollTop = enabled ? Math.max(0, Math.min(total, home.scrollTop)) : home.scrollTop;
      var time = now();
      var requestedIndex = scrollIndex();
      if (Math.abs(home.scrollTop - previousScroll) > 1) direction = home.scrollTop > previousScroll ? 1 : -1;
      previousScroll = home.scrollTop;
      var running = false;
      if (!enabled) activeIndex = requestedIndex;
      if (enabled) {
        var displayed = scenes[activeIndex];
        var target = activeIndex === requestedIndex ? targetsFor(displayed, windowFor(displayed, scrollTop)) :
          displayed.parts.map(function (part) { part.desired = false; return false; });
        displayed.clock.setTarget(target);
        var snapshot = displayed.clock.tick(time);
        if (activeIndex !== requestedIndex && allHidden(snapshot)) {
          activeIndex = requestedIndex;
          displayed = scenes[activeIndex];
          displayed.reverseEntry = direction < 0;
          displayed.clock.settle(displayed.parts.map(function () { return false; }));
          displayed.clock.setTarget(targetsFor(displayed, windowFor(displayed, scrollTop)));
          snapshot = displayed.clock.tick(time);
        }
        running = snapshot.running;
      }
      scenes.forEach(function (scene) {
        var active = !enabled || scene.index === activeIndex;
        if (!active && !scene.stage.hasAttribute('inert')) releaseFocus(scene);
        attribute(scene.track, 'data-scene-active', active ? 'true' : 'false');
        attribute(scene.stage, 'inert', active ? null : '');
        attribute(scene.stage, 'aria-hidden', active ? null : 'true');
        var state = windowFor(scene, scrollTop);
        var poses = scene.clock.snapshot();
        var exiting = poses.parts.some(function (part) { return part.phase === 'exiting'; });
        if (active && scene.index === requestedIndex && !exiting) scene.pan = state.pan;
        property(scene.section, '--scene-pan-y', enabled ? -scene.pan + 'px' : '0px');
        var presence = Math.max.apply(null, poses.parts.map(function (part) { return part.enter * (1 - part.exit); }));
        property(scene.section, '--scene-enter', enabled ? String(presence) : '1');
        property(scene.section, '--scene-exit', '0');
        var phase = poses.running && poses.activePart >= 0 ? poses.parts[poses.activePart].phase : state.phase;
        if (phase === 'entering') phase = 'enter';
        if (phase === 'exiting') phase = 'leave';
        attribute(scene.track, 'data-scene-phase', enabled ? phase : 'hold');
        attribute(scene.track, 'data-scene-part-active', String(poses.activePart + 1));
        scene.parts.forEach(function (part, partIndex) {
          var pose = poses.parts[partIndex];
          part.roots.forEach(function (root) {
            attribute(root, 'data-scene-part-state', enabled ? pose.phase : 'visible');
            property(root, '--scene-divider-alpha', enabled ? String(pose.enter * (1 - pose.exit)) : '1');
          });
        });
        scene.records.forEach(function (record) {
          if (!record.managed) return;
          var part = poses.parts[record.partIndex];
          var enter = enabled ? sceneStaggerFor(part.enter, record.entryIndex, record.entryCount) : 1;
          var exit = enabled ? sceneStaggerFor(part.exit, record.exitIndex, record.exitCount) : 0;
          property(record.item, '--scene-enter', String(enter));
          property(record.item, '--scene-exit', String(exit));
          var hidden = enabled && (part.phase === 'hidden' || !record.rendered);
          attribute(record.item, 'inert', hidden ? '' : null);
          attribute(record.item, 'data-motion-state', hidden ? 'hidden' :
            enabled && (part.phase === 'entering' || part.phase === 'exiting') ? 'moving' : 'visible');
        });
      });
      bookmark = capture();
      if (notifiedIndex !== activeIndex) {
        notifiedIndex = activeIndex;
        if (typeof settings.onChange === 'function') settings.onChange(activeIndex);
      }
      attribute(home, 'data-scene-clock-running', enabled && running ? 'true' : 'false');
      if (running) schedule();
    }
    function flush() {
      frame = 0;
      if (doc.hidden) return;
      // CSS can collapse the tracks and emit scroll before the MQL change
      // callback. Reconcile modes before paint/capture can overwrite the last
      // reading bookmark with a scroll position from the other coordinate space.
      if (enabled !== (supportsStage && !media.matches)) dirty = true;
      if (dirty) measure();
      paint();
    }
    function schedule() { if (!frame && !doc.hidden) frame = raf(flush); }
    function refresh() { dirty = true; schedule(); }
    function navigate(index, behavior) {
      if (dirty || enabled !== (supportsStage && !media.matches)) measure();
      var top = readingTop(scenes[clampIndex(index, scenes.length)], 0);
      if (behavior === 'smooth' && enabled && typeof home.scrollTo === 'function') {
        home.scrollTo({ top: top, behavior: 'smooth' });
        schedule();
      } else {
        instantScroll(top);
        paint();
      }
      return true;
    }
    var adapter = {
      enabled: function () { return enabled; },
      sectionTop: function (section) { return readingTop(scenes[sections.indexOf(section)], 0); },
      currentIndex: currentIndex,
      navigate: navigate,
      refresh: refresh,
      getState: function () { return { enabled: enabled, active: sections[currentIndex()].id,
        requested: sections[scrollIndex()].id, direction: direction, scenes: scenes.map(function (scene) {
          return { id: scene.section.id, start: scene.start, duration: scene.duration, overflow: scene.overflow,
            pan: scene.pan, clock: scene.clock.snapshot(), parts: scene.parts.map(function (part) {
              return { top: part.top, bottom: part.bottom, desired: part.desired };
            }) };
        }) }; }
    };
    home.__ouroTheatre = adapter;
    home.addEventListener('scroll', schedule, { passive: true });
    home.addEventListener('focusin', function (event) {
      if (enabled !== (supportsStage && !media.matches)) { refresh(); return; }
      if (!enabled) return;
      var scene = scenes.find(function (entry) { return entry.section.contains(event.target); });
      if (!scene) return;
      if (scene.index !== activeIndex) { releaseFocus(scene); return; }
      var state = windowFor(scene, home.scrollTop);
      var record = scene.records.find(function (entry) { return entry.managed && entry.item.contains(event.target); });
      if (state.phase !== 'hold' || record && (record.bottom - state.pan <= headerHeight || record.top - state.pan >= vh)) {
        var pan = record ? Math.max(0, Math.min(scene.overflow, record.top - headerHeight - 24)) : state.pan;
        instantScroll(readingTop(scene, pan));
      }
      schedule();
    });
    view.addEventListener('resize', refresh, { passive: true });
    view.addEventListener('pageshow', refresh);
    doc.addEventListener('ouronex:languagechange', refresh);
    doc.addEventListener('load', refresh, true);
    doc.addEventListener('visibilitychange', function () {
      var time = now();
      if (doc.hidden) {
        scenes.forEach(function (scene) { scene.clock.pause(time); });
        if (frame) caf(frame);
        frame = 0;
      } else {
        scenes.forEach(function (scene) { scene.clock.resume(time); });
        refresh();
      }
    });
    if (typeof view.ResizeObserver === 'function') {
      var resizeObserver = new view.ResizeObserver(refresh);
      resizeObserver.observe(home);
      if (header) resizeObserver.observe(header);
      // Never observe a track or stage whose dimensions this owner sets.
      scenes.forEach(function (scene) {
        resizeObserver.observe(scene.section);
        scene.records.forEach(function (record) { resizeObserver.observe(record.item); });
      });
    }
    if (typeof view.MutationObserver === 'function') {
      var mutationObserver = new view.MutationObserver(refresh);
      scenes.forEach(function (scene) {
        scene.records.forEach(function (record) {
          if (record.item.matches('.feature-panel')) mutationObserver.observe(record.item, { attributes: true, attributeFilter: ['hidden'] });
        });
        if (scene.business) mutationObserver.observe(scene.business, { attributes: true, attributeFilter: ['data-flow-live'] });
      });
      mutationObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang', 'data-flow'] });
    }
    if (doc.fonts) {
      if (doc.fonts.ready && typeof doc.fonts.ready.then === 'function') doc.fonts.ready.then(refresh).catch(function () {});
      if (doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', refresh);
    }
    if (media.addEventListener) media.addEventListener('change', refresh);
    else if (media.addListener) media.addListener(refresh);
    measure();
    paint();
    return adapter;
  }

  function loadSectionBackgrounds() {
    if (typeof document === 'undefined') return;
    initSectionBackgrounds(document, document.defaultView || window);
  }

  function initHeroDemo(doc, view) {
    if (!doc || !view) return null;
    var root = doc.querySelector('[data-demo-carousel]');
    if (!root) return null;

    var slides = Array.prototype.slice.call(root.querySelectorAll(DEMO_SLIDE_SELECTOR));
    var controls = Array.prototype.slice.call(root.querySelectorAll(DEMO_CONTROL_SELECTOR));
    if (!slides.length) return null;

    var current = 0;
    for (var index = 0; index < slides.length; index += 1) {
      if (slides[index].classList && slides[index].classList.contains('is-active')) {
        current = index;
        break;
      }
    }

    var toggle = root.querySelector('[data-demo-toggle]');
    var configured = Number(root.getAttribute('data-demo-interval'));
    var interval = Number.isFinite(configured) && configured > 0 ? configured : DEMO_INTERVAL_MS;
    var timer = 0;
    var remaining = interval;
    var startedAt = 0;
    var playing = true;

    function now() {
      return view.Date && view.Date.now ? view.Date.now() : new Date().getTime();
    }

    function stop() {
      if (!timer) return;
      view.clearTimeout(timer);
      timer = 0;
    }

    /* Focus pauses the countdown instead of restarting it: the slice already spent is
       booked so the same slide keeps its remaining time when focus leaves. */
    function pause() {
      if (!timer) return;
      view.clearTimeout(timer);
      timer = 0;
      remaining = Math.max(0, remaining - (now() - startedAt));
    }

    function start() {
      stop();
      if (!playing) return;
      if (doc.hidden === true) return;
      if (!(remaining > 0)) remaining = interval;
      startedAt = now();
      timer = view.setTimeout(function tick() {
        paint(nextDemoIndex(current, slides.length));
        remaining = interval;
        startedAt = now();
        timer = view.setTimeout(tick, interval);
      }, remaining);
    }

    function paint(index) {
      var total = slides.length;
      current = ((Number(index) || 0) % total + total) % total;
      slides.forEach(function (slide, slideIndex) {
        var active = slideIndex === current;
        if (slide.classList) slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      controls.forEach(function (control, controlIndex) {
        var active = controlIndex === current;
        if (control.classList) control.classList.toggle('is-active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      root.setAttribute('data-demo-index', String(current));
    }

    controls.forEach(function (control, controlIndex) {
      control.addEventListener('click', function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        paint(controlIndex);
        remaining = interval;
        start();
      });
    });

    /* The fill is a CSS animation, so lifting the pause attribute resumes it where it
       stopped. A resume therefore restarts both clocks: the bar from zero and the timer
       from a full interval. Trusting the frozen pair instead left a filled bar waiting
       out a fresh countdown before the next slide appeared. */
    function restartFill() {
      var active = root.querySelector('.hero-demo__control.is-active');
      if (!active || !active.classList) return;
      // Both the class and the pressed state arm the fill, so both have to drop before
      // the flush, or the running animation simply resumes instead of starting over.
      active.classList.remove('is-active');
      active.setAttribute('aria-pressed', 'false');
      void active.offsetWidth;
      active.classList.add('is-active');
      active.setAttribute('aria-pressed', 'true');
    }

    /* The play/pause pill owns the countdown; the picture itself stays inert so a click
       on the artwork neither parks the slideshow nor paints a frame around it. */
    function setPlaying(next) {
      playing = !!next;
      root.setAttribute('data-demo-playing', playing ? 'true' : 'false');
      if (toggle) {
        // Both labels live in the markup, translated by the shared dictionary.
        toggle.setAttribute('aria-labelledby', playing ? 'demo-pause-label' : 'demo-play-label');
      }
      if (playing) {
        remaining = interval;
        restartFill();
        start();
      } else {
        pause();
      }
    }

    if (toggle) {
      toggle.addEventListener('click', function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        setPlaying(!playing);
      });
    }

    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden === true) {
        stop();
        return;
      }
      if (!playing) return;
      // The fill kept animating while the tab was hidden, so both clocks start over.
      remaining = interval;
      restartFill();
      start();
    });

    root.setAttribute('data-demo-playing', 'true');
    paint(current);
    start();
    return {
      show: function (index) {
        paint(index);
        remaining = interval;
        start();
      },
      stop: stop,
      start: start,
      pause: pause,
      play: function () { setPlaying(true); },
      playing: function () { return playing; },
      current: function () { return current; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* DOM wiring                                                          */
  /* ------------------------------------------------------------------ */

  function init() {
    if (booted) return;
    if (typeof document === 'undefined') return;

    var doc = document;
    var home = doc.querySelector('main#main.home-scroll');
    if (!home) return;
    booted = true;

    var view = doc.defaultView || window;
    var header = doc.querySelector('.site-header');

    var sections = collectSections(doc);
    var unifiedBackgrounds = initUnifiedBackgrounds(doc);
    var backgroundEntries = unifiedBackgrounds ? unifiedBackgrounds.entries : [];
    var theatre = null;

    var reduced = view.matchMedia
      ? view.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: function () {}, removeEventListener: function () {} };

    var raf = view.requestAnimationFrame
      ? view.requestAnimationFrame.bind(view)
      : function (callback) { return view.setTimeout(callback, 16); };
    var caf = view.cancelAnimationFrame
      ? view.cancelAnimationFrame.bind(view)
      : function (handle) { view.clearTimeout(handle); };

    // Hero headline: a restrained cursor tilt plus a sheen that follows the pointer.
    var heroTitle = doc.getElementById('hero-title');
    var finePointer = view.matchMedia ? view.matchMedia('(hover: hover)') : { matches: false };
    if (heroTitle && finePointer.matches && !reduced.matches) {
      var tiltFrame = 0;
      var tiltState = null;
      var TILT_MAX_DEG = 20;
      var paintTilt = function () {
        tiltFrame = 0;
        if (!tiltState) return;
        heroTitle.style.setProperty('--tilt-y', (tiltState.x * TILT_MAX_DEG).toFixed(2) + 'deg');
        heroTitle.style.setProperty('--tilt-x', (-tiltState.y * TILT_MAX_DEG).toFixed(2) + 'deg');
        heroTitle.style.setProperty('--glare-x', (tiltState.gx * 100).toFixed(1) + '%');
        heroTitle.style.setProperty('--glare-y', (tiltState.gy * 100).toFixed(1) + '%');
        heroTitle.style.setProperty('--glare-a', '0.9');
      };
      var resetTilt = function () {
        if (tiltFrame) { caf(tiltFrame); tiltFrame = 0; }
        tiltState = null;
        heroTitle.style.setProperty('--tilt-x', '0deg');
        heroTitle.style.setProperty('--tilt-y', '0deg');
        heroTitle.style.setProperty('--glare-a', '0');
      };
      heroTitle.addEventListener('pointermove', function (event) {
        var box = heroTitle.getBoundingClientRect();
        if (!box.width || !box.height) return;
        var gx = (event.clientX - box.left) / box.width;
        var gy = (event.clientY - box.top) / box.height;
        tiltState = { x: gx - 0.5, y: gy - 0.5, gx: gx, gy: gy };
        if (!tiltFrame) tiltFrame = raf(paintTilt);
      });
      heroTitle.addEventListener('pointerleave', resetTilt);
      heroTitle.addEventListener('blur', resetTilt);
    }

    function sectionIdFromLink(link) {
      var href = link.getAttribute('href') || '';
      var hashIndex = href.indexOf('#');
      if (hashIndex === -1) return '';
      var before = href.slice(0, hashIndex);
      if (before) {
        try {
          var url = new URL(link.href, view.location.href);
          if (url.origin !== view.location.origin || url.pathname !== view.location.pathname) return '';
        } catch (error) {
          return '';
        }
      }
      return decodeHash(href.slice(hashIndex + 1));
    }

    var navLinks = Array.prototype.slice.call(doc.querySelectorAll(NAV_LINK_SELECTOR)).filter(function (link) {
      var id = sectionIdFromLink(link);
      return !!id && sections.some(function (section) { return section.id === id; });
    });

    function indexOfSection(id) {
      if (!id) return -1;
      for (var index = 0; index < sections.length; index += 1) {
        if (sections[index].id === id) return index;
      }
      return -1;
    }

    function sectionTop(section) {
      if (theatre) return theatre.sectionTop(section);
      var homeRect = home.getBoundingClientRect();
      var rect = section.getBoundingClientRect();
      return home.scrollTop + rect.top - (homeRect.top + (home.clientTop || 0));
    }

    var tops = [];

    function measure() {
      tops = sections.map(sectionTop);
    }

    function currentIndex() {
      return theatre ? theatre.currentIndex() : sectionIndexFor(home.scrollTop, tops);
    }

    function updateActive() {
      if (!sections.length) return;
      var active = currentIndex();
      var section = sections[active];
      var activeId = section && section.id ? section.id : '';
      if (header) header.classList.toggle('is-scrolled', active > 0);
      navLinks.forEach(function (link) {
        if (section && section.id && sectionIdFromLink(link) === section.id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      home.dataset.activeSection = activeId;
      backgroundEntries.forEach(function (entry) {
        if (!entry.host.classList) return;
        entry.host.classList.toggle('is-active', entry.id === activeId);
      });
    }

    function navigate(index, options) {
      var settings = options || {};
      if (!sections.length) return false;
      var target = clampIndex(index, sections.length);
      if (!settings.force && target === currentIndex()) return false;
      var behavior = settings.behavior || (reduced.matches ? 'auto' : 'smooth');
      if (theatre) return theatre.navigate(target, behavior);
      var top = sectionTop(sections[target]);
      if (typeof home.scrollTo === 'function') {
        try { home.scrollTo({ top: top, behavior: behavior }); }
        catch (error) { home.scrollTop = top; }
      } else home.scrollTop = top;
      updateActive();
      return true;
    }

    var sectionLinks = navLinks.concat(Array.prototype.slice.call(doc.querySelectorAll('.brand[href], .hero-actions a[href]')));
    sectionLinks.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (event.defaultPrevented) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        var id = sectionIdFromLink(link);
        var target = indexOfSection(id);
        if (target < 0) return;
        event.preventDefault();
        var nextHash = '#' + encodeURIComponent(id);
        if (view.location.hash !== nextHash) {
          try {
            view.history.pushState(null, '', nextHash);
          } catch (error) {
            /* The scroll still happens if history is unavailable. */
          }
        }
        navigate(target, { force: true });
      });
    });

    function scrollToHash(behavior) {
      var raw = view.location.hash || '';
      if (!raw) {
        if (sections.length) navigate(0, { force: true, behavior: behavior });
        return;
      }
      var target = indexOfSection(decodeHash(raw.slice(1)));
      if (target >= 0) navigate(target, { force: true, behavior: behavior });
    }

    view.addEventListener('hashchange', function () {
      scrollToHash(reduced.matches ? 'auto' : 'smooth');
    });

    function refresh() {
      if (theatre) { theatre.refresh(); return; }
      measure();
      updateActive();
    }

    view.addEventListener('pageshow', function (event) {
      refresh();
      if (!event.persisted && view.location.hash) scrollToHash('auto');
    });

    /* ---- Pointer-tracked CTA light ----------------------------------- */

    function initPointerGlow() {
      var buttons = Array.prototype.slice.call(doc.querySelectorAll('.hero-actions .button, .hero-actions .early-access, .sida-section .download-actions .button'));
      var pending = null;
      var frame = 0;

      function paint() {
        frame = 0;
        if (!pending) return;
        var rect = pending.button.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = Math.max(0, Math.min(100, ((pending.x - rect.left) / rect.width) * 100));
        var y = Math.max(0, Math.min(100, ((pending.y - rect.top) / rect.height) * 100));
        pending.button.style.setProperty('--mx', x.toFixed(2) + '%');
        pending.button.style.setProperty('--my', y.toFixed(2) + '%');
        pending = null;
      }

      buttons.forEach(function (button) {
        button.addEventListener('pointermove', function (event) {
          if (reduced.matches || event.pointerType === 'touch') return;
          pending = { button: button, x: event.clientX, y: event.clientY };
          if (!frame) frame = raf(paint);
        }, { passive: true });
      });
    }

    /* ---- Native availability alerts --------------------------------- */

    function initAvailableSoon() {
      doc.addEventListener('click', function (event) {
        if (!handleAvailableSoon(event, view)) handleComingSoon(event, view);
      });
    }

    theatre = initSectionMotion(doc, view, { onChange: updateActive });
    measure();
    updateActive();
    initSectionBackgrounds(doc, view);
    initHeroDemo(doc, view);
    initPointerGlow();
    initAvailableSoon();

    raf(function () {
      measure();
      updateActive();
      if (view.location.hash) scrollToHash('auto');
    });
  }

  return Object.freeze({
    HERO_SOURCES: HERO_SOURCES,
    BACKGROUND_SOURCES: BACKGROUND_SOURCES,
    BACKGROUND_HOST_SELECTOR: BACKGROUND_HOST_SELECTOR,
    AVAILABLE_SOON_SELECTOR: AVAILABLE_SOON_SELECTOR,
    COMING_SOON_SELECTOR: COMING_SOON_SELECTOR,
    NAV_LINK_SELECTOR: NAV_LINK_SELECTOR,
    MOTION_ITEM_SELECTOR: MOTION_ITEM_SELECTOR,
    clampIndex: clampIndex,
    motionDelayFor: motionDelayFor,
    nextDemoIndex: nextDemoIndex,
    motionVariantFor: motionVariantFor,
    motionWindowFor: motionWindowFor,
    sceneWindowFor: sceneWindowFor,
    sceneItemProgressFor: sceneItemProgressFor,
    sceneIndexFor: sceneIndexFor,
    transformTranslationY: transformTranslationY,
    selectBackgroundSource: selectBackgroundSource,
    selectHeroSource: selectHeroSource,
    planSectionBackgrounds: planSectionBackgrounds,
    showAvailableSoon: showAvailableSoon,
    handleAvailableSoon: handleAvailableSoon,
    showComingSoon: showComingSoon,
    handleComingSoon: handleComingSoon,
    sectionIndexFor: sectionIndexFor,
    shouldIgnoreWheel: shouldIgnoreWheel,
    shouldUseNativeScroll: shouldUseNativeScroll,
    loadSectionBackgrounds: loadSectionBackgrounds,
    initUnifiedBackgrounds: initUnifiedBackgrounds,
    initSectionBackgrounds: initSectionBackgrounds,
    initSectionMotion: initSectionMotion,
    initHeroDemo: initHeroDemo,
    DEMO_INTERVAL_MS: DEMO_INTERVAL_MS,
    init: init
  });
});