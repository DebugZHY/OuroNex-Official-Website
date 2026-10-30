/* ==========================================================================
   OuroNex Home interactions
   One-section navigation for main#main.home-scroll, randomized animated hero
   artwork and the native download dialog. Pure helpers are exported for the
   throwaway Node harness; DOM wiring only runs in a browser.
   ========================================================================== */

(function (global, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.OuroHome = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.init, { once: true });
    else api.init();
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
  var GRID_SOURCE = 'business-grid';
  var WHEEL_THRESHOLD = 40;
  var GESTURE_IDLE = 180;
  var SMOOTH_LOCK = 720;
  var INSTANT_LOCK = 130;

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

  function selectHeroSource(random, allowGrid) {
    var pool = allowGrid ? HERO_SOURCES.concat([GRID_SOURCE]) : HERO_SOURCES.slice();
    var value = typeof random === 'number' && Number.isFinite(random) ? random : 0;
    var index = Math.floor(value * pool.length);
    index = Math.max(0, Math.min(pool.length - 1, index));
    return pool[index];
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

  function decodeHash(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function motionFieldAvailable(doc, view) {
    if (typeof view.OuroMotion !== 'undefined') return false;
    var scripts = doc.getElementsByTagName('script');
    for (var index = 0; index < scripts.length; index += 1) {
      var src = scripts[index].getAttribute('src') || '';
      if (/(?:^|\/)motion\.js(?:[?#]|$)/.test(src)) return true;
    }
    return false;
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
    var heroHost = doc.querySelector('.hero-media');

    var sections = Array.prototype.slice.call(home.children).filter(function (element) {
      return element.nodeType === 1 && element.hasAttribute('data-home-section');
    });
    if (!sections.length) {
      sections = Array.prototype.slice.call(home.querySelectorAll('[data-home-section]'));
    }

    var reduced = view.matchMedia
      ? view.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: function () {}, removeEventListener: function () {} };

    var raf = view.requestAnimationFrame
      ? view.requestAnimationFrame.bind(view)
      : function (callback) { return view.setTimeout(callback, 16); };
    var caf = view.cancelAnimationFrame
      ? view.cancelAnimationFrame.bind(view)
      : function (handle) { view.clearTimeout(handle); };

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

    var navLinks = Array.prototype.slice.call(doc.querySelectorAll('.nav-primary a[href]')).filter(function (link) {
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
      if (header) header.classList.toggle('is-scrolled', active > 0);
      navLinks.forEach(function (link) {
        if (section && section.id && sectionIdFromLink(link) === section.id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      home.dataset.activeSection = section && section.id ? section.id : '';
    }

    var animating = false;
    var pendingIndex = null;
    var animationTimer = 0;
    var lastWheelAt = 0;
    var accumulated = 0;
    var navigatedThisGesture = false;

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

    function ignored(target) {
      if (shouldIgnoreWheel(target, home)) return true;
      return !!doc.querySelector('dialog[open]');
    }

    function navigateSection(index, options) {
      var target = clampIndex(index, sections.length);
      if (target === currentIndex() && !(options && options.force)) return false;
      return navigate(target, options);
    }

    home.addEventListener('wheel', function (event) {
      if (sections.length < 2) return;
      if (event.ctrlKey) return;
      if (ignored(event.target)) return;

      var deltaX = Number(event.deltaX) || 0;
      var deltaY = Number(event.deltaY) || 0;
      if (!deltaX && !deltaY) return;

      var now = view.performance && typeof view.performance.now === 'function' ? view.performance.now() : Date.now();
      if (now - lastWheelAt > GESTURE_IDLE) {
        navigatedThisGesture = false;
        accumulated = 0;
      }
      lastWheelAt = now;
      event.preventDefault();

      if (Math.abs(deltaX) > Math.abs(deltaY)) return;
      if (animating || navigatedThisGesture) {
        navigatedThisGesture = true;
        return;
      }

      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (home.clientHeight || 1) : 1;
      accumulated += deltaY * unit;
      if (Math.abs(accumulated) < WHEEL_THRESHOLD) return;

      var direction = accumulated > 0 ? 1 : -1;
      accumulated = 0;
      navigatedThisGesture = true;
      navigateSection(currentIndex() + direction);
    }, { passive: false });

    doc.addEventListener('keydown', function (event) {
      if (sections.length < 2) return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      var key = event.key;
      if (key !== 'PageDown' && key !== 'PageUp' && key !== 'Home' && key !== 'End') return;
      if (ignored(event.target)) return;

      event.preventDefault();
      if (event.repeat) return;
      if (animating) {
        navigatedThisGesture = true;
        return;
      }

      var index = currentIndex();
      var target = key === 'PageDown' ? index + 1
        : key === 'PageUp' ? index - 1
          : key === 'Home' ? 0
            : sections.length - 1;
      navigateSection(target);
    });

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

    /* ---- Randomized animated hero ---------------------------------- */

    function loadHero() {
      if (!heroHost || heroHost.dataset.heroReady === '1') return;
      if (heroHost.dataset.background || heroHost.querySelector('svg, .motion-field')) {
        heroHost.dataset.heroReady = '1';
        return;
      }
      heroHost.dataset.heroReady = '1';

      var allowGrid = motionFieldAvailable(doc, view);
      var source = selectHeroSource(Math.random(), allowGrid);

      if (source === GRID_SOURCE) {
        heroHost.dataset.motionField = 'grid';
        heroHost.dataset.background = GRID_SOURCE;
        return;
      }

      heroHost.removeAttribute('data-motion-field');
      if (typeof view.fetch !== 'function') return;

      view.fetch(source).then(function (response) {
        if (!response || !response.ok) throw new Error('Background request failed');
        return response.text();
      }).then(function (markup) {
        var svg = parseSvg(markup, doc);
        if (!svg) return;
        svg.classList.add('hero-vector');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('aria-hidden', 'true');
        var scripts = svg.querySelectorAll('script');
        for (var index = scripts.length - 1; index >= 0; index -= 1) {
          if (scripts[index].parentNode) scripts[index].parentNode.removeChild(scripts[index]);
        }
        heroHost.dataset.background = source;
        heroHost.replaceChildren(svg);
      }).catch(function () {
        /* A missing background must never affect the page. */
      });
    }

    /* ---- Native download dialog ------------------------------------ */

    function initDownloadDialog() {
      var dialog = doc.querySelector('dialog#download-dialog');
      if (!dialog) return;

      var fallbackOpen = false;

      function openDialog() {
        if (dialog.open) return;
        if (typeof dialog.showModal === 'function') {
          try {
            dialog.showModal();
            return;
          } catch (error) {
            /* Fall through to the attribute fallback. */
          }
        }
        fallbackOpen = true;
        dialog.setAttribute('open', '');
      }

      function closeDialog() {
        if (!dialog.open) return;
        fallbackOpen = false;
        if (typeof dialog.close === 'function') {
          try {
            dialog.close();
            return;
          } catch (error) {
            /* Fall through to the attribute fallback. */
          }
        }
        dialog.removeAttribute('open');
      }

      doc.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('[data-download]')) {
          event.preventDefault();
          openDialog();
          return;
        }
        if (target.closest('[data-dialog-close]')) {
          event.preventDefault();
          closeDialog();
        }
      });

      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeDialog();
      });

      dialog.addEventListener('cancel', function () {
        fallbackOpen = false;
      });

      doc.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !fallbackOpen || !dialog.open) return;
        event.preventDefault();
        closeDialog();
      });
    }

    measure();
    updateActive();
    loadHero();
    initDownloadDialog();

    raf(function () {
      measure();
      updateActive();
      if (view.location.hash) scrollToHash('auto');
    });
  }

  return Object.freeze({
    HERO_SOURCES: HERO_SOURCES,
    GRID_SOURCE: GRID_SOURCE,
    clampIndex: clampIndex,
    selectHeroSource: selectHeroSource,
    sectionIndexFor: sectionIndexFor,
    shouldIgnoreWheel: shouldIgnoreWheel,
    init: init
  });
});