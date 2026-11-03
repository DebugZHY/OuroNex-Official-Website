import { createRoot } from 'react-dom/client';
import { useMemo } from 'react';
import { TagCloud } from 'react-tagcloud';
import ownStyles from './styles.css';

/* ------------------------------------------------------------------------- */
/* Data: building-code and regulation names, exactly as supplied.            */
/* family drives the tint, count drives the size, title carries the document. */
/* ------------------------------------------------------------------------- */

const ROWS = [
  // Hong Kong
  ['hk', 'Concrete COP 2013', 5, 'Code of Practice for Structural Use of Concrete 2013'],
  ['hk', 'Steel COP 2011', 5, 'Code of Practice for the Structural Use of Steel 2011'],
  ['hk', 'Loads COP 2011', 4, 'Code of Practice for Dead and Imposed Loads 2011'],
  ['hk', 'Wind COP 2019', 4, 'Code of Practice for Wind Effects in Hong Kong 2019'],
  ['hk', 'Foundations COP 2017', 4, 'Code of Practice for Foundations 2017'],
  ['hk', 'Fire Safety COP 2011', 3, 'Code of Practice for Fire Safety in Buildings 2011'],
  ['hk', 'Buildings Ordinance Cap. 123', 5, 'Buildings Ordinance, Laws of Hong Kong, Cap. 123'],
  ['hk', 'PNAP APP-37', 3, 'Practice Note for Authorized Persons APP-37'],
  ['hk', 'PNAP APP-29', 2, 'Practice Note for Authorized Persons APP-29'],
  ['hk', 'PNAP APP-15', 2, 'Practice Note for Authorized Persons APP-15'],
  ['hk', 'PNAP APP-2', 2, 'Practice Note for Authorized Persons APP-2'],
  ['hk', 'PNAP APP-111', 2, 'Practice Note for Authorized Persons APP-111'],

  // British / Eurocode
  ['eu', 'BS 8110', 4, 'BS 8110 Structural use of concrete'],
  ['eu', 'BS 5950', 3, 'BS 5950 Structural use of steelwork in building'],
  ['eu', 'BS 6399', 3, 'BS 6399 Loading for buildings'],
  ['eu', 'BS 8004', 3, 'BS 8004 Code of practice for foundations'],
  ['eu', 'BS 8500', 2, 'BS 8500 Concrete, complementary British Standard to BS EN 206'],
  ['eu', 'EN 1992', 4, 'Eurocode 2: Design of concrete structures'],
  ['eu', 'EN 1993', 3, 'Eurocode 3: Design of steel structures'],
  ['eu', 'EN 1991', 3, 'Eurocode 1: Actions on structures'],
  ['eu', 'EN 1997', 3, 'Eurocode 7: Geotechnical design'],
  ['eu', 'EN 1998', 2, 'Eurocode 8: Design of structures for earthquake resistance'],

  // Mainland
  ['cn', 'GB 50010', 3, 'GB 50010 Code for design of concrete structures'],
  ['cn', 'GB 50009', 3, 'GB 50009 Load code for the design of building structures'],
  ['cn', 'GB 50011', 3, 'GB 50011 Code for seismic design of buildings'],
  ['cn', 'GB 50007', 2, 'GB 50007 Code for design of building foundation'],
  ['cn', 'JGJ 3', 2, 'JGJ 3 Technical specification for concrete structures of tall building'],

  // International
  ['intl', 'ACI 318', 3, 'ACI 318 Building Code Requirements for Structural Concrete'],
  ['intl', 'AISC 360', 2, 'AISC 360 Specification for Structural Steel Buildings'],
  ['intl', 'ASCE 7', 3, 'ASCE 7 Minimum Design Loads for Buildings'],
  ['intl', 'IBC', 2, 'International Building Code'],
  ['intl', 'IStructE Manual', 2, 'IStructE Manual for the design of building structures to Eurocodes'],
];

const TAGS = ROWS.map(([family, value, count, title]) => ({
  key: value,
  value,
  count,
  title,
  family,
}));

const MIN_SIZE = 13;
const MAX_SIZE = 36;
// Phones get a smaller ceiling: one long document name at 36px cannot wrap inside
// a 350px panel, and breaking inside a code name reads as a typo.
const MIN_SIZE_NARROW = 12;
const MAX_SIZE_NARROW = 24;
const NARROW_BREAKPOINT = 760;
const RANDOM_SEED = 7;

/* ------------------------------------------------------------------------- */
/* Renderer: the site palette, one span per document.                         */
/* ------------------------------------------------------------------------- */

function renderTag(tag, size) {
  const strong = tag.count >= 4;
  const className = `sdc-tag sdc-tag--${tag.family}${strong ? ' sdc-tag--strong' : ''}`;
  return (
    <span
      key={tag.key}
      className={className}
      style={{ fontSize: `${size}px` }}
      title={tag.title}
      data-doc={tag.key}
      data-count={tag.count}
    >
      {tag.value}
    </span>
  );
}

function Cloud() {
  const tags = useMemo(() => TAGS, []);
  const narrow = typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT;
  return (
    <div className="sdc-root">
      <TagCloud
        tags={tags}
        minSize={narrow ? MIN_SIZE_NARROW : MIN_SIZE}
        maxSize={narrow ? MAX_SIZE_NARROW : MAX_SIZE}
        shuffle={false}
        randomSeed={RANDOM_SEED}
        disableRandomColor
        className="sdc-cloud"
        renderer={renderTag}
      />
      <small className="sdc-caption">
        Indexed documents — codes, ordinances and practice notes
      </small>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Mount contract                                                             */
/* ------------------------------------------------------------------------- */

const STYLE_ID = 'sida-tagcloud-styles';
const mounted = new WeakSet();

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ownStyles;
  document.head.appendChild(style);
}

function start(element) {
  const root = createRoot(element);
  root.render(<Cloud />);
  return root;
}

function hasHeight(element) {
  return element.clientHeight > 0;
}

/**
 * Renders the cloud into one element.
 * The host sits in a tab panel that is display:none until it is opened, so the
 * render waits for the first frame with a real height; measuring at zero would
 * leave the cloud collapsed.
 */
function mount(container) {
  if (!container || mounted.has(container) || container.dataset.sidaTagcloudMounted === 'true') {
    return null;
  }
  injectStyles();
  mounted.add(container);
  container.dataset.sidaTagcloudMounted = 'true';

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  if (!container.hasAttribute('role')) container.setAttribute('role', 'group');
  if (!container.hasAttribute('aria-label')) {
    container.setAttribute('aria-label', 'Indexed building codes and regulations');
  }

  let root = null;
  const begin = () => {
    if (root) return;
    // Anything the panel rendered as a placeholder is hidden, not removed, so
    // the page markup stays intact.
    Array.from(container.children).forEach((child) => {
      child.setAttribute('aria-hidden', 'true');
      child.dataset.sidaTagcloudPlaceholder = 'true';
      child.style.display = 'none';
    });
    root = start(container);
  };

  if (hasHeight(container)) {
    requestAnimationFrame(begin);
  } else if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!hasHeight(container)) return;
      observer.disconnect();
      requestAnimationFrame(begin);
    });
    observer.observe(container);
  } else {
    // Last resort: poll for a height rather than measuring at zero.
    let tries = 0;
    const poll = () => {
      if (hasHeight(container)) {
        begin();
        return;
      }
      if (tries++ >= 240) return;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  return root;
}

function scan() {
  const targets = document.querySelectorAll('[data-sida-tagcloud]');
  for (let index = 0; index < targets.length; index += 1) mount(targets[index]);
}

function boot() {
  scan();
  if (typeof MutationObserver !== 'function') return;
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    if (!document.querySelector('[data-sida-tagcloud]:not([data-sida-tagcloud-mounted])')) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

window.OuroNexSidaTagCloud = { mount };
