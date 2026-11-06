/* ==========================================================================
   OuroNex Home interactions
   Native free scrolling for main#main.home-scroll, one randomized animated
   background per section behind a shared background layer, smooth anchor
   scrolling, viewport-driven content motion, and the native "Available soon" /
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
    '.download-actions > .button',
    '.download-actions > .button-outline',
    '.download-actions > .release-note',
    '.plan-strip > .plan-mini',
    '.delivery > h2',
    '.delivery-grid > article',
    '.process > h2',
    '.process-list > article',
    '.about-intro > h2',
    '.home-footer > .footer-brand-block',
    '.home-footer > .footer-copyright',
    '.home-footer > .footer-content'
  ].join(', ');
  var MOTION_ENTER_STEP = 70;
  var MOTION_MAX_DELAY = 420;
  var SMOOTH_LOCK = 720;
  var INSTANT_LOCK = 130;
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

  /* Category keyframes are owned by the stylesheet; this only classifies. The
     order is the priority contract: specific hero and download rules must stay
     ahead of the generic copy rule, and anything unknown falls back to the
     original onx-section rise animation. */
  function motionVariantFor(element) {
    if (!element || typeof element.matches !== 'function') return 'rise';
    if (element.matches('.hero-copy h1')) return 'headline';
    if (element.matches('.hero-copy .hero-actions')) return 'actions';
    if (element.matches('.hero-copy > *')) return 'copy';
    if (element.matches('.hero-demo')) return 'perspective';
    if (element.matches('.feature-tab-list > button')) return 'slide';
    if (element.matches('.feature-panel')) return 'mask';
    if (element.matches('.download-actions > .button')) return 'pop';
    if (element.matches('.download-actions > .button-outline')) return 'pop';
    if (element.matches('.download-actions > .release-note')) return 'fade';
    if (element.matches('.plan-strip > .plan-mini')) return 'flip';
    if (element.matches('.delivery > h2')) return 'slide';
    if (element.matches('.process > h2')) return 'slide';
    if (element.matches('.delivery-grid > article')) return 'depth';
    if (element.matches('.process-list > article')) return 'drift';
    if (element.matches('.about-intro > h2')) return 'slide';
    if (element.matches('.home-footer > .footer-brand-block')) return 'fade';
    if (element.matches('.home-footer > .footer-copyright')) return 'fade';
    if (element.matches('.home-footer > .footer-content')) return 'drift';
    return 'rise';
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
    if (home) {
      var direct = Array.prototype.slice.call(home.children).filter(function (element) {
        return element.nodeType === 1 && element.hasAttribute('data-home-section');
      });
      if (direct.length) return direct;
    }
    return Array.prototype.slice.call(doc.querySelectorAll('[data-home-section]'));
  }

  function sectionBackgroundHost(section) {
    if (!section || !section.children) return null;
    var fallback = null;
    for (var index = 0; index < section.children.length; index += 1) {
      var child = section.children[index];
      if (!child || child.nodeType !== 1) continue;
      if (child.hasAttribute('data-section-background')) return child;
      if (!fallback && child.classList && child.classList.contains('hero-media')) fallback = child;
    }
    return fallback;
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

  /* Content enters in reading order and exits after leaving the scroll viewport.
     Separate thresholds and short state dwell prevent animation-driven observer
     feedback from restarting transitions. Items are observed individually so the
     tall About section and footer animate when they come into view. */
  function initSectionMotion(doc, view) {
    if (!doc || !view) return;
    var home = doc.querySelector('main#main.home-scroll');
    var body = doc.body;
    if (!home || !body || typeof view.IntersectionObserver !== 'function') return;

    var items = Array.prototype.slice.call(doc.querySelectorAll(MOTION_ITEM_SELECTOR));
    if (!items.length) return;

    var motionMedia = typeof view.matchMedia === 'function'
      ? view.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: function () {}, addListener: function () {} };

    var groups = [];
    var groupItems = [];
    function motionGroupFor(item) {
      if (typeof item.closest !== 'function') return item.parentElement;
      return item.closest('.home-footer') || item.closest('.home-section') || item.parentElement;
    }

    items.forEach(function (item) {
      item.setAttribute('data-motion-item', '');
      /* Classified in the same pass, so hidden tab panels are covered too. */
      item.setAttribute('data-motion-variant', motionVariantFor(item));
      var group = motionGroupFor(item);
      var groupIndex = groups.indexOf(group);
      if (groupIndex < 0) {
        groups.push(group);
        groupItems.push([]);
        groupIndex = groups.length - 1;
      }
      groupItems[groupIndex].push(item);
    });

    groups.forEach(function (group, groupIndex) {
      var visibleIndex = 0;
      groupItems[groupIndex].forEach(function (item) {
        var hidden = typeof item.closest === 'function' && item.closest('[hidden]');
        var delay = hidden ? 0 : motionDelayFor(visibleIndex, MOTION_ENTER_STEP, MOTION_MAX_DELAY);
        if (!hidden) visibleIndex += 1;
        item.style.setProperty('--motion-delay', delay + 'ms');
      });
    });

    var observer = null;
    var latestEntries = new WeakMap();
    var stateLocks = new WeakMap();
    var stateTimers = new WeakMap();

    function motionNow() {
      return view.performance && typeof view.performance.now === 'function'
        ? view.performance.now()
        : Date.now();
    }

    function setMotionState(target, state) {
      if (target.getAttribute('data-motion-state') === state) return;
      target.setAttribute('data-motion-state', state);
      stateLocks.set(target, motionNow() + (state === 'in' ? 1000 : 600));
    }

    function updateMotionEntry(entry) {
      if (!entry) return;
      var target = entry.target;
      latestEntries.set(target, entry);
      var previous = target.getAttribute('data-motion-state');
      var remaining = (stateLocks.get(target) || 0) - motionNow();
      if (previous && remaining > 0) {
        if (!stateTimers.get(target)) {
          stateTimers.set(target, view.setTimeout(function () {
            stateTimers.delete(target);
            if (body.getAttribute('data-section-motion') === 'on') {
              updateMotionEntry(latestEntries.get(target));
            }
          }, remaining));
        }
        return;
      }
      if (stateTimers.get(target)) {
        view.clearTimeout(stateTimers.get(target));
        stateTimers.delete(target);
      }
      if (!entry.isIntersecting) {
        setMotionState(target, 'out');
        return;
      }
      if (previous === 'in') {
        if (entry.intersectionRatio <= 0.02) setMotionState(target, 'out');
        return;
      }
      if (entry.intersectionRatio >= 0.08) setMotionState(target, 'in');
    }

    function resetMotionTracking() {
      items.forEach(function (item) {
        if (stateTimers.get(item)) view.clearTimeout(stateTimers.get(item));
      });
      latestEntries = new WeakMap();
      stateLocks = new WeakMap();
      stateTimers = new WeakMap();
    }

    function disconnectObserver() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
    }

    function observeItems() {
      if (observer) observer.disconnect();
      observer = new view.IntersectionObserver(function (entries) {
        entries.forEach(updateMotionEntry);
      }, {
        root: home,
        rootMargin: '0px 0px 32px 0px',
        threshold: [0, 0.02, 0.08, 0.24, 0.5, 0.8]
      });
      items.forEach(function (item) { observer.observe(item); });
    }

    function enableMotion() {
      resetMotionTracking();
      body.setAttribute('data-section-motion', 'on');
      items.forEach(function (item) { item.removeAttribute('data-motion-state'); });
      observeItems();
    }

    function disableMotion() {
      disconnectObserver();
      resetMotionTracking();
      body.setAttribute('data-section-motion', 'reduced');
    }

    function syncMotionPreference() {
      if (motionMedia.matches) disableMotion();
      else enableMotion();
    }

    if (motionMedia.matches) disableMotion();
    else enableMotion();

    if (typeof motionMedia.addEventListener === 'function') {
      motionMedia.addEventListener('change', syncMotionPreference);
    } else if (typeof motionMedia.addListener === 'function') {
      motionMedia.addListener(syncMotionPreference);
    }
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
      var homeRect = home.getBoundingClientRect();
      var rect = section.getBoundingClientRect();
      return home.scrollTop + rect.top - (homeRect.top + (home.clientTop || 0));
    }

    var tops = [];

    function measure() {
      tops = sections.map(sectionTop);
    }

    function currentIndex() {
      return sectionIndexFor(home.scrollTop, tops);
    }

    function updateActive(index) {
      if (!sections.length) return;
      var active = typeof index === 'number' ? clampIndex(index, sections.length) : currentIndex();
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

    var animating = false;
    var pendingIndex = null;
    var animationTimer = 0;

    function finishAnimation() {
      if (animationTimer) {
        view.clearTimeout(animationTimer);
        animationTimer = 0;
      }
      if (!animating && pendingIndex === null) return;
      animating = false;
      pendingIndex = null;
      updateActive();
    }

    function navigate(index, options) {
      var settings = options || {};
      if (!sections.length) return false;
      var target = clampIndex(index, sections.length);
      if (!settings.force && target === currentIndex()) return false;
      var behavior = settings.behavior || (reduced.matches ? 'auto' : 'smooth');
      var top = sectionTop(sections[target]);

      pendingIndex = target;
      animating = true;
      updateActive(target);
      if (animationTimer) view.clearTimeout(animationTimer);
      animationTimer = view.setTimeout(finishAnimation, behavior === 'auto' ? INSTANT_LOCK : SMOOTH_LOCK);

      if (typeof home.scrollTo === 'function') {
        try {
          home.scrollTo({ top: top, behavior: behavior });
        } catch (error) {
          home.scrollTop = top;
        }
      } else {
        home.scrollTop = top;
      }
      return true;
    }

    var scrollFrame = 0;
    function onScroll() {
      if (scrollFrame) return;
      scrollFrame = raf(function () {
        scrollFrame = 0;
        if (animating && pendingIndex !== null) updateActive(pendingIndex);
        else updateActive();
      });
    }

    home.addEventListener('scroll', onScroll, { passive: true });

    if ('onscrollend' in home) {
      home.addEventListener('scrollend', finishAnimation);
    }

    navLinks.forEach(function (link) {
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
      measure();
      updateActive(animating && pendingIndex !== null ? pendingIndex : undefined);
    }

    view.addEventListener('resize', refresh, { passive: true });
    view.addEventListener('pageshow', function () {
      refresh();
      if (view.location.hash) scrollToHash('auto');
    });

    if (typeof view.ResizeObserver === 'function') {
      var observer = new view.ResizeObserver(refresh);
      observer.observe(home);
      sections.forEach(function (section) { observer.observe(section); });
    }

    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
      doc.fonts.ready.then(refresh).catch(function () {});
    }

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

    measure();
    updateActive();
    initSectionBackgrounds(doc, view);
    initSectionMotion(doc, view);
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