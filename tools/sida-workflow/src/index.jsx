import { createRoot } from 'react-dom/client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import xyflowStyles from '@xyflow/react/dist/style.css';
import ownStyles from './styles.css';
import { StageIcon } from './icons.jsx';

/* ------------------------------------------------------------------------- */
/* Graph                                                                      */
/* ------------------------------------------------------------------------- */

const STAGE_LABEL = {
  scheme: 'Scheme',
  analysis: 'Analysis',
  design: 'Design',
  check: 'Check',
  submission: 'Submission',
  delivery: 'Delivery',
};

const NODE_W = 138;
const NODE_H = 56;
const COL_PITCH = 150;
const ROW_PITCH = 84;

// [column, row, id, label, stage, icon]
const NODE_SPEC = [
  // Spine: brief to global analysis.
  [0, 0, 'brief', 'Client Brief', 'scheme', 'document'],
  [0, 1, 'concept', 'Concept Scheme', 'scheme', 'sketch'],
  [0, 2, 'bim', 'BIM Model', 'scheme', 'cube'],
  [0, 3, 'takedown', 'Load Takedown', 'analysis', 'loads'],
  [0, 4, 'analysis', 'Global Analysis', 'analysis', 'wave'],

  // Three parallel work streams, superstructure / lateral / substructure.
  [1, 2, 'beam', 'Beam Design', 'design', 'beam'],
  [1, 3, 'wind', 'Wind Analysis', 'analysis', 'wind'],
  [1, 4, 'foundation', 'Foundation Design', 'design', 'pile'],

  [2, 2, 'column', 'Column Design', 'design', 'column'],
  [2, 3, 'lateral', 'Lateral Design', 'design', 'brace'],
  [2, 4, 'pile', 'Pile Capacity', 'check', 'pilecheck'],

  // Streams merge into detailing, which fans out into the code checks.
  [2, 0, 'detailing', 'Detailing', 'design', 'grid'],

  [3, 0, 'concrete', 'Concrete Check', 'check', 'checkbox'],
  [3, 1, 'steel', 'Steel Check', 'check', 'ibeam'],
  [3, 2, 'fire', 'Fire Check', 'check', 'fire'],
  [3, 3, 'windcheck', 'Wind Check', 'check', 'windcheck'],
  [3, 4, 'compliance', 'Compliance', 'check', 'shield'],
  [3, 5, 'submission', 'BD Submission', 'submission', 'stamp'],
];

// [source, target, onSpine] - the spine edges are the only ones that animate.
const EDGE_SPEC = [
  ['brief', 'concept', true],
  ['concept', 'bim', true],
  ['bim', 'takedown', true],
  ['takedown', 'analysis', true],

  ['analysis', 'beam', false],
  ['analysis', 'wind', false],
  ['analysis', 'foundation', false],
  ['beam', 'column', false],
  ['wind', 'lateral', false],
  ['foundation', 'pile', false],
  ['column', 'detailing', false],
  ['lateral', 'detailing', false],
  ['pile', 'detailing', false],

  ['detailing', 'concrete', false],
  ['detailing', 'steel', false],
  ['detailing', 'fire', false],
  ['detailing', 'windcheck', false],
  ['concrete', 'compliance', false],
  ['steel', 'compliance', false],
  ['fire', 'compliance', false],
  ['windcheck', 'compliance', false],

  ['compliance', 'submission', true],
];

const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 13,
  height: 13,
  color: 'rgba(150, 186, 255, 0.8)',
};

function buildGraph(motion) {
  const nodes = NODE_SPEC.map(([col, row, id, label, stage, icon]) => ({
    id,
    type: 'stage',
    position: { x: col * COL_PITCH, y: row * ROW_PITCH },
    data: { label, stage, icon },
    style: { width: NODE_W, height: NODE_H },
    draggable: false,
    selectable: false,
  }));

  const seat = new Map(nodes.map((node) => [node.id, node.position]));
  const edges = EDGE_SPEC.map(([source, target, spine], index) => {
    const from = seat.get(source);
    const to = seat.get(target);
    const vertical = Math.abs(to.x - from.x) < 1;
    const down = to.y >= from.y;
    return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: vertical ? (down ? 's-bottom' : 's-top') : 's-right',
    targetHandle: vertical ? (down ? 't-top' : 't-bottom') : 't-left',
    type: 'smoothstep',
    pathOptions: { borderRadius: 16, offset: 14 },
    animated: Boolean(motion && spine),
    markerEnd: ARROW,
    className: spine ? 'sif-edge sif-edge--spine' : 'sif-edge',
    zIndex: index % 2,
    };
  });

  return { nodes, edges };
}

/* ------------------------------------------------------------------------- */
/* Node                                                                       */
/* ------------------------------------------------------------------------- */

const StageNode = memo(function StageNode({ data }) {
  return (
    <div className={`sif-card sif-card--${data.stage}`}>
      <span className="sif-card__icon">
        <StageIcon name={data.icon} />
      </span>
      <span className="sif-card__text">
        <span className="sif-card__stage">{STAGE_LABEL[data.stage]}</span>
        <span className="sif-card__label">{data.label}</span>
      </span>
      <Handle type="target" position={Position.Left} id="t-left" className="sif-handle" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="t-top" className="sif-handle" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" className="sif-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="s-right" className="sif-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" className="sif-handle" isConnectable={false} />
      <Handle type="source" position={Position.Top} id="s-top" className="sif-handle" isConnectable={false} />
    </div>
  );
});

const nodeTypes = { stage: StageNode };

/* ------------------------------------------------------------------------- */
/* Controls                                                                   */
/* ------------------------------------------------------------------------- */

const LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit to view',
  hint: 'Drag to explore',
};

function Controls() {
  const flow = useReactFlow();
  return (
    <div className="sif-controls">
      <button type="button" aria-label={LABELS.zoomOut} onClick={() => flow.zoomOut({ duration: 240 })}>
        <span aria-hidden="true">−</span>
      </button>
      <button type="button" aria-label={LABELS.fit} onClick={() => flow.fitView({ padding: 0.04, duration: 320 })}>
        <span aria-hidden="true" className="sif-controls__fit" />
      </button>
      <button type="button" aria-label={LABELS.zoomIn} onClick={() => flow.zoomIn({ duration: 240 })}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Canvas                                                                     */
/* ------------------------------------------------------------------------- */

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Canvas() {
  const flow = useReactFlow();
  const wrap = useRef(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [placed, setPlaced] = useState(false);

  const graph = useMemo(() => buildGraph(!reduced), [reduced]);

  // React Flow measures the wrapper itself, so the opening viewport is set once
  // the panel has a box. The tab body is display:none until it is opened, which
  // is why this watches for the first real box instead of running on mount.
  useEffect(() => {
    if (placed) return undefined;
    const element = wrap.current;
    if (!element) return undefined;
    const fit = () => {
      if (!element.clientHeight || !element.clientWidth) return false;
      flow.fitView({ padding: 0.06, duration: 0 });
      setPlaced(true);
      return true;
    };
    if (fit()) return undefined;
    const observer = new ResizeObserver(() => {
      if (fit()) observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [flow, placed]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', onChange);
      else if (media.removeListener) media.removeListener(onChange);
    };
  }, []);

  // Hover trace: the stylesheet does the work, the handler only moves classes so
  // pointer moves never re-render the canvas.
  const lit = useRef({ id: null, root: null });

  const clearLit = () => {
    const state = lit.current;
    if (!state.root) return;
    state.root.querySelectorAll('.is-lit').forEach((element) => element.classList.remove('is-lit'));
    state.id = null;
  };

  const onPointerMove = (event) => {
    const root = event.currentTarget;
    const node = event.target.closest ? event.target.closest('.react-flow__node') : null;
    if (!node) return;
    const id = node.getAttribute('data-id');
    if (!id || id === lit.current.id) return;
    clearLit();
    node.classList.add('is-lit');
    graph.edges.forEach((edge) => {
      if (edge.source !== id && edge.target !== id) return;
      const element = root.querySelector(`.react-flow__edge[data-id="${edge.id}"]`);
      if (element) element.classList.add('is-lit');
    });
    lit.current = { id, root };
  };

  return (
    <div className="sif-canvas" ref={wrap}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView={false}
        minZoom={0.2}
        maxZoom={1.6}
        colorMode="dark"
        nodesConnectable={false}
        elementsSelectable={false}
        nodesDraggable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        zoomOnPinch
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onPointerMove={onPointerMove}
        onPointerLeave={clearLit}
        style={{ width: '100%', height: '100%' }}
      >
        <Controls />
        <div className="sif-hint">
          <span className="sif-hint__dot" aria-hidden="true" />
          <span>{LABELS.hint}</span>
        </div>
      </ReactFlow>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Mount contract                                                             */
/* ------------------------------------------------------------------------- */

const STYLE_ID = 'sida-flow-styles';
const mounted = new WeakSet();

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${xyflowStyles}\n${ownStyles}`;
  document.head.appendChild(style);
}

function start(element) {
  const root = createRoot(element);
  root.render(
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>,
  );
  return root;
}

// The panel may hand over either the whole section or a pre-made canvas box.
function canvasFor(container) {
  return container.querySelector('[data-sida-flow-canvas]') || container;
}

function hasBox(element) {
  return element.clientWidth > 0 && element.clientHeight > 0;
}

/**
 * Renders the workflow into one element.
 * The element must be position:relative and carry a height (React Flow measures
 * it); a visible-but-unsized element falls back to a 520px floor so the panel
 * still renders instead of staying blank.
 */
function mount(container) {
  if (!container || mounted.has(container) || container.dataset.sidaFlowMounted === 'true') {
    return null;
  }
  injectStyles();
  mounted.add(container);
  container.dataset.sidaFlowMounted = 'true';

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  if (!container.hasAttribute('role')) container.setAttribute('role', 'group');
  if (!container.hasAttribute('aria-label')) {
    container.setAttribute('aria-label', 'SIDA complex structural workflow');
  }

  let root = null;
  const begin = () => {
    if (root) return;
    const canvas = canvasFor(container);
    if (!container.clientHeight && container.clientWidth) {
      container.dataset.sidaFlowSized = 'fallback';
      container.style.minHeight = '520px';
    }
    if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';
    // A canvas element the page created but did not size would collapse to 0px.
    if (!canvas.clientHeight && container.clientHeight) {
      canvas.dataset.sidaFlowSized = 'fallback';
      canvas.style.height = `${container.clientHeight}px`;
    }
    // Anything the panel rendered as a placeholder ("Loading project workflow…")
    // is hidden rather than removed, so the page markup stays intact.
    Array.from(canvas.children).forEach((child) => {
      child.setAttribute('aria-hidden', 'true');
      child.dataset.sidaFlowPlaceholder = 'true';
      child.style.display = 'none';
    });
    root = start(canvas);
  };

  if (hasBox(container)) {
    requestAnimationFrame(begin);
  } else if (typeof ResizeObserver === 'function') {
    // A tab panel that is display:none at load has no box yet; mount on the first
    // frame it has one, so React Flow measures the real size.
    const observer = new ResizeObserver(() => {
      if (!hasBox(container)) return;
      observer.disconnect();
      requestAnimationFrame(begin);
    });
    observer.observe(container);
    requestAnimationFrame(() => {
      if (!hasBox(container)) return;
      observer.disconnect();
      begin();
    });
  } else {
    requestAnimationFrame(begin);
  }

  return root;
}

function scan() {
  const targets = document.querySelectorAll('[data-sida-flow]');
  for (let index = 0; index < targets.length; index += 1) mount(targets[index]);
}

function boot() {
  scan();
  // The panel may arrive after this script (tabs, lazy markup), so keep watching
  // for an unmounted target instead of assuming load order.
  if (typeof MutationObserver !== 'function') return;
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    if (!document.querySelector('[data-sida-flow]:not([data-sida-flow-mounted])')) return;
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

window.OuroNexSidaFlow = { mount };
