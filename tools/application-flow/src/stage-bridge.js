/* Same-origin case selection and presentation only. home.js owns all section
 * geometry, reading ranges and entry/exit clocks. No wheel or scroll listener. */
export const CASE_FADE_MS = 500;

export function createStageController(view, services, onState) {
  const count = services.length;
  const layers = new Map(), fitted = new Set(), mounted = new Set([0]);
  const listeners = new Set(), animations = new Map();
  let selected = 0, displayed = null, phase = 'preparing', revision = 0;
  let weights = Array(count).fill(0);
  let pendingFrame = 0, pendingTimer = 0, destroyed = false;
  let localReduced = false, hostReduced = false, suspended = false;
  let source = 'initial', host = null, connected = false;
  const reduced = () => localReduced || hostReduced || suspended;

  function snapshot() {
    return {
      selectedIndex: selected, selectedId: services[selected].id, displayedIndex: displayed,
      phase, revision, duration: CASE_FADE_MS, reduced: reduced(), source,
      mountedIndices: [...mounted], fittedIndices: [...fitted],
      pendingFrame: !!pendingFrame, pendingTimer: !!pendingTimer, animationCount: animations.size,
      layers: [...layers].map(([index, element]) => ({ index, id: services[index].id,
        className: element.className, opacity: Number.parseFloat(view.getComputedStyle(element).opacity) || 0,
        inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') })),
    };
  }
  function publish() { if (!destroyed) onState?.(snapshot()); }
  function markLayers() {
    for (const [index, element] of layers) {
      const active = index === selected;
      element.classList.toggle('is-active', active);
      element.classList.toggle('is-present', weights[index] > 0 || active && fitted.has(index));
      element.classList.toggle('is-preparing', active && phase === 'preparing');
      element.classList.toggle('is-incoming', active && phase === 'fading');
      element.classList.toggle('is-outgoing', !active && phase !== 'idle' && weights[index] > 0);
      element.setAttribute('aria-hidden', active ? 'false' : 'true');
      element.setAttribute('data-case-fitted', fitted.has(index) ? 'true' : 'false');
      if (active && fitted.has(index) && phase !== 'preparing') element.removeAttribute('inert');
      else element.setAttribute('inert', '');
    }
  }
  function cancelPending(freeze) {
    if (pendingFrame) view.cancelAnimationFrame(pendingFrame);
    if (pendingTimer) view.clearTimeout(pendingTimer);
    pendingFrame = pendingTimer = 0;
    if (freeze) for (const [index, element] of layers) {
      const opacity = Number.parseFloat(view.getComputedStyle(element).opacity);
      if (Number.isFinite(opacity)) weights[index] = Math.max(0, Math.min(1, opacity));
    }
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    for (const [index, element] of layers) element.style.opacity = String(weights[index]);
  }
  function finish(token = revision) {
    if (destroyed || token !== revision || !fitted.has(selected) || !layers.has(selected)) return;
    weights = weights.map((_, index) => index === selected ? 1 : 0);
    cancelPending(false);
    displayed = selected;
    phase = 'idle';
    markLayers();
    publish();
  }
  function begin() {
    if (destroyed || pendingFrame || !fitted.has(selected) || !layers.has(selected)) return;
    if (reduced() || displayed === null) { finish(); return; }
    const token = revision;
    pendingFrame = view.requestAnimationFrame(() => {
      pendingFrame = 0;
      if (destroyed || token !== revision) return;
      if (reduced()) { finish(token); return; }
      phase = 'fading';
      markLayers();
      for (const [index, element] of layers) {
        const to = index === selected ? 1 : 0;
        if (weights[index] === to) continue;
        if (typeof element.animate !== 'function') { finish(token); return; }
        const animation = element.animate([{ opacity: weights[index] }, { opacity: to }],
          { duration: CASE_FADE_MS, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
        animations.set(index, animation);
      }
      // One bounded completion, never a polling RAF. Old callbacks also check
      // revision, so rapid changes/reversals cannot hide the latest target.
      pendingTimer = view.setTimeout(() => finish(token), CASE_FADE_MS);
      publish();
    });
  }
  function select(index, options = {}) {
    if (destroyed || !Number.isInteger(index) || index < 0 || index >= count) return false;
    const nextSource = options.source || 'manual';
    const changed = index !== selected;
    if (changed) {
      cancelPending(true);
      revision += 1;
      selected = index;
      mounted.add(index);
      source = nextSource;
      phase = 'preparing';
      markLayers();
      publish();
    }
    // A same-tab manual choice can still claim an unsettled parent scroll.
    if (changed || nextSource !== 'scroll') {
      for (const listener of [...listeners]) listener({ index, source: nextSource, changed });
    }
    if (changed) begin();
    return changed;
  }
  function motionChanged() {
    if (destroyed) return;
    if (reduced()) finish();
    else if (phase === 'preparing') begin();
  }
  const api = {
    version: 1, count, select, currentIndex: () => selected, getState: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setReduced(value) { const next = !!value; if (hostReduced !== next) { hostReduced = next; motionChanged(); } },
  };
  function detachHost() {
    // The parent may have attached after this child first mounted. Discover
    // that owner as well, so pagehide/reload always releases the old API.
    try { (host || view.frameElement?.__ouroApplicationHost)?.disconnect(api); } catch (_) { /* Origin changed during navigation. */ }
    host = null;
  }
  function handshake() {
    if (destroyed) return;
    try {
      const owner = view.frameElement?.__ouroApplicationHost;
      if (owner?.connect(view, api)) host = owner;
    } catch (_) { /* Standalone/cross-origin embeds retain manual navigation. */ }
  }
  function pagehide() {
    suspended = true;
    finish();
    cancelPending(false);
    detachHost();
  }
  function pageshow() { suspended = false; handshake(); motionChanged(); }
  return {
    api,
    connect() {
      if (connected || destroyed) return;
      connected = true;
      view.OuroApplicationStages = api;
      view.addEventListener('pagehide', pagehide);
      view.addEventListener('pageshow', pageshow);
      handshake();
    },
    mount(index, element) {
      if (destroyed) return;
      if (!element) { layers.delete(index); fitted.delete(index); return; }
      if (layers.get(index) === element) return;
      layers.set(index, element);
      element.style.opacity = String(weights[index]);
      markLayers();
      begin();
    },
    fitted(index, value = true) {
      if (destroyed) return;
      if (!value) {
        fitted.delete(index);
        if (index === selected && phase === 'fading') {
          cancelPending(true);
          revision += 1;
          phase = 'preparing';
          publish();
        }
        markLayers();
        return;
      }
      if (fitted.has(index)) return;
      fitted.add(index);
      markLayers();
      if (index === selected && phase === 'preparing') begin();
    },
    setReduced(value) { const next = !!value; if (localReduced !== next) { localReduced = next; motionChanged(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revision += 1;
      cancelPending(false);
      detachHost();
      listeners.clear();
      layers.clear();
      view.removeEventListener('pagehide', pagehide);
      view.removeEventListener('pageshow', pageshow);
      if (view.OuroApplicationStages === api) delete view.OuroApplicationStages;
    },
  };
}
