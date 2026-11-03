import { createElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';

const FALLBACK = {
  'home.flow-entry-1-kicker': 'No clear picture yet',
  'home.flow-entry-1-title': 'On-site consultation',
  'home.flow-entry-1-copy': 'Inspect your workflow for potential automation.',
  'home.flow-entry-2-kicker': 'Scope already defined',
  'home.flow-entry-2-title': 'Plan Refinement',
  'home.flow-entry-2-copy': 'Align your need with our delivery.',
  'home.flow-entry-3-kicker': 'Want to see it working',
  'home.flow-entry-3-title': 'Pilot first',
  'home.flow-entry-3-copy': 'One real project runs on SIDA, so the result speaks before the invoice.',
  'home.flow-band-title': 'Match to what you need',
  'home.flow-band-note': 'Agreed in one conversation',
  'home.flow-lane-1-kicker': 'Ready to run',
  'home.flow-lane-1-title': 'Use SIDA directly',
  'home.flow-lane-1-copy': 'pay as you go or subscribe.',
  'home.flow-lane-2-kicker': 'Your process, not ours',
  'home.flow-lane-2-title': 'Add custom automation',
  'home.flow-lane-2-copy':
    'We model your workflow as a SIDA flowchart — specialist bots, checkpoints and review gates you approve.',
  'home.flow-lane-3-kicker': 'Nothing off the shelf fits',
  'home.flow-lane-3-title': 'Commission a tool',
  'home.flow-lane-3-copy':
    'A model, solver or software integration built to a fixed scope, delivered inside SIDA.',
  'home.flow-final-title': 'Every path lands on the same platform',
  'home.flow-pill-1': 'SIDA workspace licence',
  'home.flow-pill-2': 'Workflow automation pack',
  'home.flow-pill-3': 'Bespoke tools and integrations',
  'home.flow-pill-4': 'Onboarding and training',
  'home.flow-pill-5': 'Local data, nothing uploaded',
  'home.flow-hint': 'Drag to explore',
  'home.flow-reset': 'Fit to view',
  'home.flow-zoom-in': 'Zoom in',
  'home.flow-zoom-out': 'Zoom out',
};

function currentLanguage() {
  return (window.OuroNexLanguage && window.OuroNexLanguage.current) || 'en';
}

function translator(language) {
  const dictionary = window.OuroNexI18n || {};
  return (key) => {
    const entry = dictionary[key];
    if (!entry) return FALLBACK[key] || key;
    return entry[language] || entry.en || FALLBACK[key] || key;
  };
}

const HANDLES = { horizontal: ['Left', 'Right'], vertical: ['Top', 'Bottom'] };

const FlowCard = memo(function FlowCard({ data }) {
  const [targetSide, sourceSide] = HANDLES[data.axis];
  return (
    createElement(
      'div',
      { className: `bf-card bf-card--${data.tone}` },
      data.index ? createElement('span', { className: 'bf-card__index' }, data.index) : null,
      createElement('span', { className: 'bf-card__kicker' }, data.kicker),
      createElement('h3', { className: 'bf-card__title' }, data.title),
      data.copy ? createElement('p', { className: 'bf-card__copy' }, data.copy) : null,
      data.pills
        ? createElement(
            'ul',
            { className: 'bf-card__pills' },
            data.pills.map((pill) =>
              createElement('li', { key: pill }, createElement('span', null, pill)),
            ),
          )
        : null,
      createElement(Handle, {
        type: 'target',
        position: Position[targetSide],
        className: 'bf-handle',
        isConnectable: false,
      }),
      createElement(Handle, {
        type: 'source',
        position: Position[sourceSide],
        className: 'bf-handle',
        isConnectable: false,
      }),
    )
  );
});

function FlowDot() {
  return createElement('span', { className: 'bf-dot' });
}

const nodeTypes = { card: FlowCard, dot: FlowDot };

function verticalWidth(viewportWidth) {
  return Math.min(520, Math.max(300, Math.round(viewportWidth * 0.62)));
}

function buildGraph(t, axis, viewportWidth = 1000) {
  const horizontal = axis === 'horizontal';

  const entries = [1, 2, 3].map((n) => ({
    id: `entry-${n}`,
    tone: 'entry',
    kicker: t(`home.flow-entry-${n}-kicker`),
    title: t(`home.flow-entry-${n}-title`),
    copy: t(`home.flow-entry-${n}-copy`),
  }));

  const lanes = [1, 2, 3].map((n) => ({
    id: `lane-${n}`,
    tone: 'lane',
    index: `0${n}`,
    kicker: t(`home.flow-lane-${n}-kicker`),
    title: t(`home.flow-lane-${n}-title`),
    copy: t(`home.flow-lane-${n}-copy`),
  }));

  const decision = {
    id: 'decision',
    tone: 'gate',
    kicker: 'Match',
    title: t('home.flow-band-title'),
    copy: t('home.flow-band-note'),
  };

  const delivery = {
    id: 'delivery',
    tone: 'delivery',
    kicker: 'Delivered',
    title: t('home.flow-final-title'),
    pills: [1, 2, 3, 4, 5].map((n) => t(`home.flow-pill-${n}`)),
  };

  const sizes = horizontal
    ? HORIZONTAL_SIZE
    : Object.fromEntries(
        Object.entries(VERTICAL_SIZE).map(([tone, [width, height]]) => [
          tone,
          [verticalWidth(viewportWidth), height],
        ]),
      );
  const positions = horizontal ? horizontalLayout() : verticalLayout();
  const nodes = [...entries, decision, ...lanes, delivery].map((node) => ({
    id: node.id,
    type: 'card',
    position: positions[node.id],
    data: { ...node, axis },
    style: { width: sizes[node.tone][0], height: sizes[node.tone][1] },
    draggable: true,
    selectable: false,
  }));

  if (horizontal) {
    // Junction dots mark the fan-in points so three lines meet at one mark.
    nodes.push({
      id: 'junction-1',
      type: 'dot',
      position: { x: positions.decision.x - 3, y: positions.decision.y + sizes.gate[1] / 2 - 3 },
      data: { axis },
      draggable: false,
      selectable: false,
    });
    nodes.push({
      id: 'junction-2',
      type: 'dot',
      position: { x: positions.delivery.x - 3, y: positions.delivery.y + sizes.delivery[1] / 2 - 3 },
      data: { axis },
      draggable: false,
      selectable: false,
    });
  }

  const link = (id, source, target) => ({
    id,
    source,
    target,
    type: 'default',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgba(150,186,255,.85)' },
  });

  const edges = [
    link('e-1', 'entry-1', 'decision'),
    link('e-2', 'entry-2', 'decision'),
    link('e-3', 'entry-3', 'decision'),
    link('l-1', 'decision', 'lane-1'),
    link('l-2', 'decision', 'lane-2'),
    link('l-3', 'decision', 'lane-3'),
    link('d-1', 'lane-1', 'delivery'),
    link('d-2', 'lane-2', 'delivery'),
    link('d-3', 'lane-3', 'delivery'),
  ];

  return { nodes, edges };
}

const HORIZONTAL_SIZE = {
  entry: [228, 126],
  gate: [240, 126],
  lane: [274, 150],
  delivery: [290, 214],
};

const VERTICAL_SIZE = {
  entry: [300, 52],
  gate: [300, 64],
  lane: [300, 56],
  delivery: [300, 178],
};

function horizontalLayout() {
  const [entryW, entryH] = HORIZONTAL_SIZE.entry;
  const [gateW, gateH] = HORIZONTAL_SIZE.gate;
  const [laneW, laneH] = HORIZONTAL_SIZE.lane;
  const [delW, delH] = HORIZONTAL_SIZE.delivery;

  const entryTop = 0;
  const entryStep = 156; // 126 tall + 30 gutter
  const laneTop = 0;
  const laneStep = 170; // 150 tall + 20 gutter

  const entryColumn = entryTop + entryStep * 2 + entryH;
  const laneColumn = laneTop + laneStep * 2 + laneH;
  // Both stacks have different card heights; offset the right one so the
  // middle card of each stack shares the same centre line as the gate.
  const laneOffset = Math.round((entryColumn - laneColumn) / 2);

  const gateX = entryW + 78;
  const laneX = gateX + gateW + 78;
  const deliveryX = laneX + laneW + 62;

  return {
    'entry-1': { x: 0, y: entryTop },
    'entry-2': { x: 0, y: entryTop + entryStep },
    'entry-3': { x: 0, y: entryTop + entryStep * 2 },
    decision: { x: gateX, y: Math.round((entryColumn - gateH) / 2) },
    'lane-1': { x: laneX, y: laneTop + laneOffset },
    'lane-2': { x: laneX, y: laneTop + laneStep + laneOffset },
    'lane-3': { x: laneX, y: laneTop + laneStep * 2 + laneOffset },
    delivery: { x: deliveryX, y: laneOffset + Math.round((laneColumn - delH) / 2) },
  };
}

function verticalLayout() {
  const gap = 16;
  const out = {};
  let y = 0;
  const push = (id, tone, extra = gap) => {
    out[id] = { x: 0, y };
    y += VERTICAL_SIZE[tone][1] + extra;
  };
  push('entry-1', 'entry');
  push('entry-2', 'entry');
  push('entry-3', 'entry', gap + 8);
  push('decision', 'gate', gap + 8);
  push('lane-1', 'lane', gap - 2);
  push('lane-2', 'lane', gap - 2);
  push('lane-3', 'lane', gap + 8);
  push('delivery', 'delivery', 0);
  return out;
}

function Controls({ label }) {
  const flow = useReactFlow();
  return createElement(
    'div',
    { className: 'bf-controls' },
    createElement(
      'button',
      { type: 'button', 'aria-label': label.zoomOut, onClick: () => flow.zoomOut({ duration: 260 }) },
      createElement('span', { 'aria-hidden': 'true' }, '−'),
    ),
    createElement(
      'button',
      { type: 'button', 'aria-label': label.reset, onClick: () => flow.fitView({ padding: 0.12, duration: 320 }) },
      createElement('span', { 'aria-hidden': 'true', className: 'bf-controls__fit' }),
    ),
    createElement(
      'button',
      { type: 'button', 'aria-label': label.zoomIn, onClick: () => flow.zoomIn({ duration: 260 }) },
      createElement('span', { 'aria-hidden': 'true' }, '+'),
    ),
  );
}

function Canvas() {
  const [language, setLanguage] = useState(currentLanguage);
  const [axis, setAxis] = useState(() => (window.innerWidth >= 1100 ? 'horizontal' : 'vertical'));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const litRef = useRef({ id: null, root: null });

  useEffect(() => {
    const onLanguage = (event) => setLanguage(event.detail.language);
    const onResize = () => {
      setAxis(window.innerWidth >= 1100 ? 'horizontal' : 'vertical');
      setViewportWidth(window.innerWidth);
    };
    document.addEventListener('ouronex:languagechange', onLanguage);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('ouronex:languagechange', onLanguage);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const t = useMemo(() => translator(language), [language]);
  const graph = useMemo(() => buildGraph(t, axis, viewportWidth), [t, axis, viewportWidth]);

  const nodes = useMemo(() => graph.nodes, [graph.nodes]);
  const edges = useMemo(() => graph.edges, [graph.edges]);

  const clearLit = () => {
    const state = litRef.current;
    if (!state.root) return;
    state.root.querySelectorAll('.is-lit').forEach((element) => element.classList.remove('is-lit'));
    state.id = null;
  };

  // The trace is painted by touching class names on the DOM that is already
  // there. Routing it through component state re-rendered the canvas on every
  // pointer move, and a re-render repaints the panel, which left the diagram
  // blank for a frame — the flash that showed up while the pointer swept.
  const onPointerMove = (event) => {
    const root = event.currentTarget;
    const hint = root.querySelector('.bf-hint');
    if (hint && !hint.classList.contains('is-hidden')) hint.classList.add('is-hidden');

    const node = event.target.closest ? event.target.closest('.react-flow__node') : null;
    if (!node) return;
    const id = node.getAttribute('data-id');
    if (!id || id.indexOf('junction') === 0) return;
    if (id === litRef.current.id) return;

    clearLit();
    node.classList.add('is-lit');
    graph.edges.forEach((edge) => {
      if (edge.source !== id && edge.target !== id) return;
      const element = root.querySelector(`.react-flow__edge[data-id="${edge.id}"]`);
      if (element) element.classList.add('is-lit');
    });
    litRef.current = { id, root };
  };

  const onPointerLeave = () => clearLit();

  return createElement(
    ReactFlow,
    {
      nodes,
      edges,
      nodeTypes,
      fitView: true,
      fitViewOptions: { padding: 0.09, duration: 0 },
      minZoom: 0.5,
      maxZoom: 1.6,
      colorMode: 'dark',
      nodesConnectable: false,
      elementsSelectable: false,
      zoomOnScroll: false,
      zoomOnDoubleClick: false,
      zoomOnPinch: true,
      panOnScroll: false,
      preventScrolling: false,
      nodesDraggable: false,
      onPointerMove,
      onPointerLeave,
      proOptions: { hideAttribution: true },
    },
    createElement(Controls, {
      label: { zoomIn: t('home.flow-zoom-in'), zoomOut: t('home.flow-zoom-out'), reset: t('home.flow-reset') },
    }),
    createElement(
      'div',
      { className: 'bf-hint' },
      createElement('span', { className: 'bf-hint__dot', 'aria-hidden': 'true' }),
      createElement('span', null, t('home.flow-hint')),
    ),
  );
}

function mount(container) {
  const root = createRoot(container);
  root.render(
    createElement(ReactFlowProvider, null, createElement(Canvas, null)),
  );
  return root;
}

function boot() {
  const container = document.querySelector('[data-flow-canvas]');
  if (!container) return;
  const root = container.closest('[data-flow-root]') || container;
  const wide = () => window.matchMedia('(min-width: 761px)').matches;

  const start = () => {
    if (container.dataset.flowMounted === 'true' || !wide()) return;
    container.dataset.flowMounted = 'true';
    container.dataset.axis = window.innerWidth >= 1100 ? 'horizontal' : 'vertical';
    window.addEventListener('resize', () => {
      container.dataset.axis = window.innerWidth >= 1100 ? 'horizontal' : 'vertical';
    });

    // React Flow measures its container on mount, so the canvas has to be laid out
    // first; the static stack stays visible until the frame after that.
    root.dataset.flowLive = 'true';
    requestAnimationFrame(() => {
      try {
        mount(container);
        document.documentElement.setAttribute('data-flow', 'live');
      } catch (error) {
        delete root.dataset.flowLive;
        document.documentElement.removeAttribute('data-flow');
        container.dataset.flowMounted = 'false';
        if (window.console) console.error('[business-flow]', error);
      }
    });
  };

  // The canvas is a 320 kB bundle: only pay for it when the section is near.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      { rootMargin: '60% 0px' },
    );
    // The canvas itself is display:none until it mounts, so watch the visible shell.
    observer.observe(root);
  } else {
    start();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.OuroNexBusinessFlow = { mount };
