/* Shared by the Experts page and Flow at runtime. Geometry/colour live only in the
   nine existing flow-assets/experts/*.svg files; this module adds the original gaze layers. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const EXPERT_IDS = new Set(['site-planning', 'compliance', 'analysis', 'sections', 'wind',
  'connections', 'modelling', 'documentation', 'reporting']);
const GAZE_ACCESSORIES = new Set(['compliance', 'modelling', 'reporting']);
const portraits = new Map();
const documents = new WeakMap();

function documentState(doc) {
  if (!documents.has(doc)) documents.set(doc, { instances: new Map(), sequence: 0 });
  return documents.get(doc);
}

function ensureStyles(doc) {
  const shared = documentState(doc);
  if (!shared.styles) {
    shared.styles = new Promise((resolve, reject) => {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./expert-avatars.css', import.meta.url).href;
      link.setAttribute('data-sida-avatar-styles', '');
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => {
        link.remove();
        shared.styles = null;
        reject(new Error('Shared expert motion stylesheet could not be loaded.'));
      }, { once: true });
      doc.head.appendChild(link);
    });
  }
  return shared.styles;
}

function portraitSource(id) {
  if (!EXPERT_IDS.has(id)) throw new Error(`Unknown expert avatar: ${id}`);
  return new URL(`./flow-assets/experts/${id}.svg`, import.meta.url).href;
}

function loadPortrait(id, doc) {
  const source = portraitSource(id);
  if (!portraits.has(source)) {
    const pending = fetch(source).then(response => {
      if (!response.ok) throw new Error(`Expert portrait request failed: ${response.status}`);
      return response.text();
    }).then(markup => {
      const parsed = new doc.defaultView.DOMParser().parseFromString(markup, 'image/svg+xml');
      if (parsed.documentElement.localName !== 'svg' || parsed.querySelector('parsererror')) {
        throw new Error(`Invalid expert portrait: ${id}`);
      }
      return parsed.documentElement;
    }).catch(error => {
      portraits.delete(source);
      throw error;
    });
    portraits.set(source, pending);
  }
  return portraits.get(source);
}

/* Every inline instance owns its IDs, including future gradients, masks and title references.
   Layer classes are intentionally shared, but all their CSS is scoped to data-sida-avatar. */
function namespaceIds(svg, prefix) {
  const elements = [svg, ...svg.querySelectorAll('*')];
  const ids = new Map();
  elements.forEach(element => {
    if (element.hasAttribute('id')) {
      const id = element.getAttribute('id');
      ids.set(id, `${prefix}-${id}`);
      element.setAttribute('id', ids.get(id));
    }
  });
  elements.forEach(element => {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(\s*(['"]?)#([^\s)'"]+)\1\s*\)/g,
        (reference, quote, id) => ids.has(id) ? `url(#${ids.get(id)})` : reference);
      if (attribute.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) {
        value = `#${ids.get(value.slice(1))}`;
      }
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        value = value.split(/\s+/).map(id => ids.get(id) || id).join(' ');
      }
      if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value);
    }
  });
}

function createPortrait(source, id, doc) {
  const svg = doc.importNode(source, true);
  namespaceIds(svg, `sida-avatar-${++documentState(doc).sequence}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const head = svg.querySelector('.bot-float');
  const eyes = svg.querySelector('.bot-eyes');
  if (!head || !eyes) throw new Error(`Expert portrait is missing its motion layers: ${id}`);

  // Headgear follows the head; glasses and facial accessories follow the gaze.
  let turn = head.querySelector('.bot-turn');
  if (!turn) {
    turn = doc.createElementNS(SVG_NS, 'g');
    turn.classList.add('bot-turn');
    while (head.firstChild) turn.appendChild(head.firstChild);
    head.appendChild(turn);
  }
  let face = turn.querySelector('.bot-face');
  if (!face) {
    face = doc.createElementNS(SVG_NS, 'g');
    face.classList.add('bot-face');
    turn.insertBefore(face, eyes);
    face.appendChild(eyes);
    if (GAZE_ACCESSORIES.has(id)) {
      const accessory = turn.querySelector('.bot-accessory');
      if (accessory) face.appendChild(accessory);
    }
  }
  return svg;
}

function watchVisibility(doc, shared) {
  if (shared.onVisibility) return;
  shared.onVisibility = () => shared.instances.forEach(instance => instance.syncPause());
  doc.addEventListener('visibilitychange', shared.onVisibility);
  if (doc.defaultView.IntersectionObserver) {
    shared.observer = new doc.defaultView.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const instance = shared.instances.get(entry.target);
        if (instance) {
          instance.visible = entry.isIntersecting;
          instance.syncPause();
        }
      });
    });
  }
}

/** Mount into an empty span or an existing static-image fallback. No iframe or HTML fetch.
 * `active` is the Experts page default; Flow uses idle/running/done. State updates retain the
 * SVG and its timelines. Local pause, document visibility and ancestor pause are independent. */
export function mountExpertAvatar(host, { id, state = 'active' } = {}) {
  const source = portraitSource(id);
  const doc = host.ownerDocument;
  const shared = documentState(doc);
  shared.instances.get(host)?.destroy();
  host.setAttribute('data-sida-avatar', id);
  host.setAttribute('data-avatar-state', state);
  host.setAttribute('data-avatar-ready', 'loading');
  if (!host.querySelector('img')) {
    const image = doc.createElement('img');
    image.src = source;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    host.replaceChildren(image);
  }

  let disposed = false;
  let localPause = false;
  const instance = {
    visible: true,
    syncPause() {
      host.toggleAttribute('data-avatar-paused', localPause || doc.hidden || !instance.visible);
    },
    setState(next) {
      if (!disposed) host.setAttribute('data-avatar-state', next);
    },
    setPaused(paused) {
      if (!disposed) { localPause = Boolean(paused); instance.syncPause(); }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      shared.observer?.unobserve(host);
      shared.instances.delete(host);
      if (!shared.instances.size) {
        shared.observer?.disconnect();
        shared.observer = null;
        doc.removeEventListener('visibilitychange', shared.onVisibility);
        shared.onVisibility = null;
      }
      host.replaceChildren();
      ['data-sida-avatar', 'data-avatar-paused', 'data-avatar-ready'].forEach(name => host.removeAttribute(name));
    },
  };
  shared.instances.set(host, instance);
  watchVisibility(doc, shared);
  shared.observer?.observe(host);
  instance.syncPause();
  instance.ready = Promise.all([loadPortrait(id, doc), ensureStyles(doc)]).then(([portrait]) => {
    if (disposed) return;
    host.replaceChildren(createPortrait(portrait, id, doc));
    host.setAttribute('data-avatar-ready', 'true');
  }).catch(error => {
    if (!disposed) host.setAttribute('data-avatar-ready', 'error');
    throw error;
  });
  return instance;
}
