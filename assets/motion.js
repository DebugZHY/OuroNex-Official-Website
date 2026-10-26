(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const subscribers = new Set();
  const animations = new Set();
  const fields = [];
  const pointers = [];
  const scrollItems = [];
  let paused = false, raf = 0, lastTime = 0, layoutDirty = true, scrollDirty = true;
  const enabled = () => !paused && !reduced.matches;

  // Scroll-out exit animations: elements reverse their entrance when they leave the viewport, and data-scroll-scene assemblies disassemble, so scrolling back replays the entrance. window.OuroMotionExitStrategy can force "elements" (element entrances only); window.OuroMotionExitDebug (default false) enables console logging.
  let exitStrategy = window.OuroMotionExitStrategy === 'elements' ? 'elements' : 'scenes';
  if (typeof window.OuroMotionExitDebug === 'undefined') window.OuroMotionExitDebug = false;
  const exitDebug = () => window.OuroMotionExitDebug === true;
  const elementLabel = element => element.id ? `#${element.id}`
    : `${element.tagName.toLowerCase()}${(element.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 1).map(name => `.${name}`).join('')}`;
  try {
    Object.defineProperty(window, 'OuroMotionExitStrategy', {
      configurable: true,
      get: () => exitStrategy,
      set: value => {
        const next = value === 'scenes' ? 'scenes' : 'elements';
        if (next === exitStrategy) return;
        exitStrategy = next;
        applyExitStrategy();
        if (exitDebug()) console.info('[OuroMotion] exit strategy:', exitStrategy);
      }
    });
  } catch {
    window.OuroMotionExitStrategy = exitStrategy;
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'motion-toggle';
  toggle.setAttribute('data-motion-toggle', '');
  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'motion-toggle-icon';
  toggleIcon.setAttribute('aria-hidden', 'true');
  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'motion-toggle-label';
  toggle.append(toggleIcon, toggleLabel);
  (document.querySelector('.nav-shell') || document.body).append(toggle);

  function request() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
  }
  window.OuroMotion = Object.freeze({
    get enabled() { return enabled(); },
    request,
    subscribe(callback) { subscribers.add(callback); request(); return () => subscribers.delete(callback); }
  });

  // Word wrappers retain the existing text nodes' reading order and whitespace.
  document.querySelectorAll('[data-motion-text]').forEach(heading => {
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let index = 0;
    nodes.forEach(node => {
      if (!node.textContent.trim()) return;
      const fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { fragment.append(document.createTextNode(part)); return; }
        const word = document.createElement('span');
        const inner = document.createElement('span');
        word.className = 'motion-word';
        inner.className = 'motion-word-inner';
        inner.textContent = part;
        inner.style.setProperty('--word-delay', `${Math.min(index++ * 48, 336)}ms`);
        word.append(inner); fragment.append(word);
      });
      node.replaceWith(fragment);
    });
  });
  document.querySelectorAll('[data-stagger]').forEach(group => {
    [...group.children].forEach((child, index) => {
      if (child.matches('[data-motion]') && !child.hasAttribute('data-motion-delay')) {
        child.style.setProperty('--motion-delay', `${Math.min(index * 75, 300)}ms`);
      }
    });
  });
  document.querySelectorAll('[data-motion-delay]').forEach(element => {
    element.style.setProperty('--motion-delay', `${clamp(Number(element.dataset.motionDelay) || 0, 0, 300)}ms`);
  });

  const reveals = [...document.querySelectorAll('[data-motion], [data-motion-text], [data-reveal]')].filter(element => {
    element.classList.remove('reveal-pending');
    return !element.querySelector('[data-motion], [data-motion-text]');
  });
  // Exit-capable state machine: out -> entering -> in -> exiting -> out. Entrance and exit reuse the
  // existing motion-pending / motion-line-pending transitions; no new keyframes are authored.
  const exitStates = new Map();
  const holdTime = element => {
    const style = getComputedStyle(element);
    const seconds = (parseFloat(style.transitionDuration) || 0) + (parseFloat(style.transitionDelay) || 0);
    return clamp(element.hasAttribute('data-motion-text') ? Math.max(seconds * 1000, 1330) : seconds * 1000, 0, 2000);
  };
  function reveal(element) {
    const state = exitStates.get(element);
    if (state) { clearTimeout(state.timer); state.value = 'in'; }
    element.classList.remove('motion-pending', 'reveal-pending', 'motion-line-pending');
    element.classList.add('is-motion-in', 'is-revealed');
  }
  function enterElement(element) {
    const state = exitStates.get(element);
    if (!state || state.value === 'in' || state.value === 'entering') return;
    clearTimeout(state.timer);
    element.classList.remove('motion-pending', 'reveal-pending', 'motion-line-pending');
    element.classList.add('is-motion-in', 'is-revealed');
    state.value = 'entering';
    state.timer = setTimeout(() => { if (state.value === 'entering') state.value = 'in'; }, holdTime(element));
  }
  function exitElement(element) {
    const state = exitStates.get(element);
    if (!state || state.value === 'out' || state.value === 'exiting') return;
    clearTimeout(state.timer);
    element.classList.remove('is-motion-in', 'is-revealed');
    element.classList.add(element.hasAttribute('data-motion-line') ? 'motion-line-pending' : 'motion-pending');
    state.value = 'exiting';
    if (exitDebug()) console.info('[OuroMotion] exit:', elementLabel(element));
    state.timer = setTimeout(() => { if (state.value === 'exiting') state.value = 'out'; }, holdTime(element));
  }
  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    if (!enabled()) return;
    entries.forEach(entry => {
      if (entry.isIntersecting) enterElement(entry.target);
      else exitElement(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -28px 0px' }) : null;
  function observeReveals() {
    if (!revealObserver) return;
    [...reveals, ...document.querySelectorAll('[data-motion-line]')].forEach(element => {
      let state = exitStates.get(element);
      if (!state) { state = { value: 'out', timer: 0, observed: false }; exitStates.set(element, state); }
      if (state.observed) return;
      state.observed = true;
      if (enabled() && !element.classList.contains('is-revealed')) {
        if (element.hasAttribute('data-motion-line')) { element.setAttribute('pathLength', '1'); element.classList.add('motion-line-pending'); }
        else element.classList.add('motion-pending');
      }
      revealObserver.observe(element);
    });
  }
  observeReveals();
  document.addEventListener('focusin', event => {
    let element = event.target;
    while (element && element !== root) { reveal(element); element = element.parentElement; }
  });
  const revealHash = () => {
    if (!location.hash) return;
    let target;
    try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
    if (!target) return;
    reveal(target);
    target.querySelectorAll('.motion-pending, .reveal-pending').forEach(reveal);
    let parent = target.parentElement;
    while (parent) { reveal(parent); parent = parent.parentElement; }
  };
  window.addEventListener('hashchange', revealHash);

  // Geometry is refreshed after layout changes, never once per moving particle.
  document.querySelectorAll('[data-scroll-scene], [data-motion-track], [data-parallax]').forEach(element => {
    scrollItems.push({ element, top: 0, height: 1, value: null, out: false,
      kind: element.hasAttribute('data-scroll-scene') ? 'scene' : element.hasAttribute('data-motion-track') ? 'track' : 'parallax',
      travel: clamp(Number(element.dataset.parallax) || 0, -50, 50),
      steps: [...element.querySelectorAll('[data-motion-step]')], active: -1 });
  });
  function measure() {
    const y = window.scrollY;
    scrollItems.forEach(item => {
      const rect = item.element.getBoundingClientRect();
      item.top = rect.top + y; item.height = rect.height || 1;
    });
    fields.forEach(field => {
      const rect = field.host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.min(1200, Math.round(rect.height)));
      const dpr = Math.min(devicePixelRatio || 1, innerWidth < 761 ? 1.25 : 1.5);
      if (width !== field.width || height !== field.height || dpr !== field.dpr) {
        field.width = width; field.height = height; field.dpr = dpr;
        field.canvas.width = Math.round(width * dpr); field.canvas.height = Math.round(height * dpr);
        field.needsDraw = true;
      }
      const canvasRect = field.canvas.getBoundingClientRect();
      field.visible = canvasRect.bottom > 0 && canvasRect.top < innerHeight;
    });
    layoutDirty = false;
  }
  function updateScroll(amount) {
    const y = window.scrollY, vh = innerHeight;
    let unsettled = false;
    scrollItems.forEach(item => {
      if (item.kind === 'scene' && exitStrategy === 'scenes' && item.out) return;
      const top = item.top - y;
      const target = item.kind === 'track'
        ? clamp((vh * .82 - top) / (item.height + vh * .18))
        : clamp((vh * .8 - top) / (item.height + vh * .55));
      item.value = item.value === null || !enabled() ? target : lerp(item.value, target, amount);
      if (Math.abs(target - item.value) < .0005) item.value = target;
      else unsettled = true;
      const value = enabled() ? item.value : 1;
      if (item.kind === 'parallax') {
        item.element.style.setProperty('--parallax-y', `${enabled() ? ((value - .5) * item.travel * 2).toFixed(2) : 0}px`);
      } else {
        item.element.style.setProperty(item.kind === 'scene' ? '--scene-progress' : '--track-progress', value.toFixed(4));
        if (item.steps.length) {
          const active = Math.min(item.steps.length - 1, Math.floor(value * item.steps.length));
          if (active !== item.active) {
            item.active = active;
            item.steps.forEach((step, index) => {
              step.classList.toggle('is-step-active', enabled() && index === active);
              step.classList.toggle('is-step-past', enabled() && index < active);
            });
          }
        }
      }
    });
    scrollDirty = unsettled;
    return unsettled;
  }

  // Strategy B only: a data-scroll-scene that leaves the viewport is disassembled by resetting its
  // progress; the scroll path leaves it untouched while out, and re-entry hands control back.
  const sceneObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const item = scrollItems.find(candidate => candidate.element === entry.target);
      if (!item || item.kind !== 'scene') return;
      item.out = !entry.isIntersecting;
      if (!enabled()) return;
      if (item.out) {
        if (exitStrategy === 'scenes') {
          item.value = 0;
          item.element.style.setProperty('--scene-progress', '0.0000');
          if (exitDebug()) console.info('[OuroMotion] exit:', elementLabel(item.element));
        }
      } else {
        scrollDirty = true; request();
      }
    });
  }, { threshold: 0 }) : null;
  scrollItems.forEach(item => { if (item.kind === 'scene') sceneObserver?.observe(item.element); });
  function applyExitStrategy() {
    let dirty = false;
    scrollItems.forEach(item => {
      if (item.kind !== 'scene') return;
      if (exitStrategy === 'scenes') {
        if (item.out) { item.value = 0; item.element.style.setProperty('--scene-progress', '0.0000'); }
      } else if (item.out) { item.out = false; dirty = true; }
    });
    if (dirty) { scrollDirty = true; request(); }
  }

  document.querySelectorAll('[data-motion-card], [data-magnetic]').forEach(element => {
    const card = element.hasAttribute('data-motion-card');
    const item = { element, card, x: 0, y: 0, tx: 0, ty: 0, inside: false, rect: null };
    pointers.push(item);
    if (card) {
      const light = document.createElement('span');
      light.className = 'motion-card-light'; light.setAttribute('aria-hidden', 'true');
      element.prepend(light);
    }
    element.addEventListener('pointerenter', () => {
      if (!fine.matches || !enabled()) return;
      item.rect = element.getBoundingClientRect(); item.inside = true;
      element.classList.add('is-motion-hover'); request();
    }, { passive: true });
    element.addEventListener('pointermove', event => {
      if (!fine.matches || !enabled()) return;
      item.rect ||= element.getBoundingClientRect();
      item.tx = clamp((event.clientX - item.rect.left) / item.rect.width - .5, -.5, .5);
      item.ty = clamp((event.clientY - item.rect.top) / item.rect.height - .5, -.5, .5);
      item.inside = true; request();
    }, { passive: true });
    element.addEventListener('pointerleave', () => {
      item.tx = 0; item.ty = 0; item.inside = false; item.rect = null;
      element.classList.remove('is-motion-hover'); request();
    }, { passive: true });
  });
  function updatePointers(amount) {
    let moving = false;
    pointers.forEach(item => {
      if (!enabled() || !fine.matches) item.tx = item.ty = 0;
      if (Math.abs(item.x - item.tx) + Math.abs(item.y - item.ty) < .001) {
        if (item.x === item.tx && item.y === item.ty) return;
        item.x = item.tx; item.y = item.ty;
      } else { item.x = lerp(item.x, item.tx, amount); item.y = lerp(item.y, item.ty, amount); moving = true; }
      if (item.card) {
        const tilt = item.rect?.height > 440 ? 2.4 : 5;
        item.element.style.setProperty('--card-rx', `${(-item.y * tilt).toFixed(3)}deg`);
        item.element.style.setProperty('--card-ry', `${(item.x * tilt).toFixed(3)}deg`);
        item.element.style.setProperty('--card-x', `${((item.x + .5) * 100).toFixed(1)}%`);
        item.element.style.setProperty('--card-y', `${((item.y + .5) * 100).toFixed(1)}%`);
      } else {
        item.element.style.setProperty('--magnet-x', `${(item.x * 10).toFixed(2)}px`);
        item.element.style.setProperty('--magnet-y', `${(item.y * 10).toFixed(2)}px`);
      }
    });
    return moving;
  }

  const visibility = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const field = fields.find(item => item.canvas === entry.target);
      if (field) { field.visible = entry.isIntersecting; if (field.visible) field.needsDraw = true; }
    });
    request();
  }, { threshold: 0 }) : null;
  document.querySelectorAll('[data-motion-field]').forEach(host => {
    const canvas = document.createElement('canvas');
    canvas.className = 'motion-field'; canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    host.prepend(canvas);
    const field = { host, canvas, ctx, kind: host.dataset.motionField, width: 1, height: 1, dpr: 1, visible: true, phase: 0, lastDraw: 0, needsDraw: true };
    fields.push(field); visibility?.observe(canvas);
  });
  function drawField(field) {
    const { ctx, width: w, height: h, phase: t, dpr } = field;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, w, h * .2);
    gradient.addColorStop(0, 'rgba(118,165,237,.025)');
    gradient.addColorStop(.42, 'rgba(131,175,239,.17)');
    gradient.addColorStop(1, 'rgba(140,183,246,.36)');
    ctx.strokeStyle = gradient; ctx.lineWidth = .8;
    if (field.kind === 'grid') {
      const vx = w * .63 + Math.sin(t * .15) * w * .025, vy = h * .2;
      for (let i = -10; i <= 14; i++) {
        ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(w * .5 + i * w * .095, h * 1.1); ctx.stroke();
      }
      for (let i = 0; i < 19; i++) {
        const depth = ((i / 18 + t * .026) % 1) ** 2;
        const y = vy + depth * h * .86;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(143,191,255,.34)'; ctx.lineWidth = 1.25;
      const scan = vy + ((t * .065) % 1) ** 1.5 * h * .86;
      ctx.beginPath(); ctx.moveTo(w * .22, scan); ctx.lineTo(w, scan); ctx.stroke();
    } else if (field.kind === 'orbit') {
      const cx = w * .76, cy = h * .49;
      const radius = Math.min(w * .38, h * .69, 600);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.32 + Math.sin(t * .12) * .05);
      for (let i = 0; i < 7; i++) {
        const rx = radius * (.38 + i * .115), ry = rx * (.5 + i * .027);
        ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        const a = t * (.105 + i * .007) + i * 1.35;
        ctx.fillStyle = i % 2 ? 'rgba(184,212,255,.72)' : 'rgba(139,186,255,.5)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * rx, Math.sin(a) * ry, i % 2 ? 2 : 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(135,177,241,.09)';
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(angle) * radius * .22, Math.sin(angle) * radius * .14); ctx.lineTo(Math.cos(angle) * radius * 1.12, Math.sin(angle) * radius * .74); ctx.stroke();
      }
      ctx.restore();
    } else {
      const point = (x, row) => h * .56 + (row - 14) * Math.min(15, h / 50)
        + Math.sin(x / w * 5.7 - t * .24 + row * .034) * h * .12
        + Math.cos(x / w * 2.7 + t * .14) * h * .075;
      for (let row = 0; row < 29; row++) {
        ctx.beginPath();
        for (let step = 0; step <= 56; step++) {
          const x = step / 56 * (w + 80) - 40, y = point(x, row);
          if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (row % 6 === 0) {
          const x = ((t * .038 + row * .073) % 1) * w;
          ctx.fillStyle = 'rgba(174,206,255,.56)';
          ctx.beginPath(); ctx.arc(x, point(x, row), 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    field.needsDraw = false;
  }

  function animatePanel(panel) {
    if (!enabled() || panel.hidden || !panel.animate) return;
    const animation = panel.animate([{ opacity: .2, transform: 'translateY(15px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    layoutDirty = true; scrollDirty = true; request();
  }
  const panelObserver = new MutationObserver(entries => entries.forEach(entry => {
    if (!entry.target.hidden) animatePanel(entry.target);
  }));
  document.querySelectorAll('[role="tabpanel"], [data-brief-output]').forEach(panel => panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden'] }));

  function syncState() {
    root.dataset.motionState = reduced.matches ? 'reduced' : paused ? 'paused' : 'running';
    const label = reduced.matches ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion';
    toggleLabel.textContent = label; toggle.setAttribute('aria-label', label);
    toggle.title = reduced.matches ? 'Reduced motion — follows your device setting' : paused ? 'Resume page motion' : 'Pause page motion';
    toggle.setAttribute('aria-pressed', String(!enabled())); toggle.disabled = reduced.matches;
    if (!enabled()) {
      document.querySelectorAll('.motion-pending, .motion-line-pending, .reveal-pending').forEach(reveal);
      animations.forEach(animation => animation.cancel()); animations.clear();
      pointers.forEach(item => { item.tx = item.ty = 0; item.active = false; item.element.classList.remove('is-motion-hover'); });
    } else {
      observeReveals();
    }
    scrollItems.forEach(item => { item.active = -1; });
    scrollDirty = true;
    document.dispatchEvent(new CustomEvent('ouronex:motion-state', { detail: { state: root.dataset.motionState } }));
    request();
  }
  function tick(time) {
    raf = 0;
    if (document.hidden) { lastTime = 0; return; }
    const dt = Math.min(lastTime ? (time - lastTime) / 1000 : 1 / 60, .05);
    lastTime = time;
    if (layoutDirty) measure();
    const amount = 1 - Math.exp(-dt * 13);
    let keepGoing = scrollDirty ? updateScroll(amount) : false;
    keepGoing = updatePointers(amount) || keepGoing;
    fields.forEach(field => {
      if (!field.visible) return;
      if (enabled()) field.phase += dt;
      if (field.needsDraw || (enabled() && time - field.lastDraw >= (innerWidth < 761 ? 42 : 30))) {
        drawField(field); field.lastDraw = time;
      }
      if (enabled()) keepGoing = true;
    });
    subscribers.forEach(callback => { if (callback(time)) keepGoing = true; });
    if (enabled() && keepGoing) request();
    else lastTime = 0;
  }
  toggle.addEventListener('click', () => { if (!reduced.matches) { paused = !paused; syncState(); } });
  reduced.addEventListener('change', syncState);
  fine.addEventListener('change', () => { pointers.forEach(item => { item.tx = item.ty = 0; }); request(); });
  window.addEventListener('scroll', () => { scrollDirty = true; request(); }, { passive: true });
  const resize = () => { layoutDirty = true; scrollDirty = true; request(); };
  window.addEventListener('resize', resize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(document.body);
  document.fonts?.ready.then(resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    else { layoutDirty = true; scrollDirty = true; request(); }
  });
  window.addEventListener('pagehide', () => { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = 0; });
  window.addEventListener('pageshow', resize);
  root.classList.add('motion-ready');
  syncState(); revealHash();
})();
