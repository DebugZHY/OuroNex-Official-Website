import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useNodesInitialized, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { AlertCircle, ArrowRight, CheckCircle2, Circle, LoaderCircle, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { LINKS, LOOP_ARC, STAGES, STATUS, handlesFor, initialStatuses, positionsFor, resourcesFor as stageResourcesFor, sizeFor } from './model.js';
import { ExpertAvatar } from './expert-avatar.jsx';

const STATUS_ICONS = { idle: Circle, ready: Circle, running: LoaderCircle, done: CheckCircle2, decision: AlertCircle };
/* Bottom band the floating controls occupy; the first fit keeps it clear of the cards. */
const SAFE_BOTTOM = { idle: 92, running: 78, done: 96 };

function statusOf(value) {
  const key = STATUS[value] ? value : 'idle';
  return { key, label: STATUS[key], Icon: STATUS_ICONS[key] || Circle };
}

/* ---------- playback snapshot ---------- */

/* The parent owns playback timing and pushes whole snapshots; this pane only renders them.
   Anything unexpected (a late frame after reset, a status the shell has not seen yet) is
   normalised back to idle so the canvas can never be left in a state it cannot paint. */
function playbackOf(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const status = raw.status === 'running' || raw.status === 'done' || raw.status === 'completed' ? raw.status : 'idle';
  const progress = Number.isFinite(raw.progress) ? Math.min(100, Math.max(0, raw.progress)) : 0;
  const iteration = Number.isFinite(raw.iteration) ? Math.min(2, Math.max(0, Math.round(raw.iteration))) : 0;
  const activeStageId = typeof raw.activeStageId === 'string' && STAGES.some(stage => stage.id === raw.activeStageId)
    ? raw.activeStageId : null;
  const activeEdgeId = typeof raw.activeEdgeId === 'string' && LINKS.some(link => `${link.from}--${link.to}` === raw.activeEdgeId)
    ? raw.activeEdgeId : null;
  return { status: status === 'completed' ? 'done' : status, progress, iteration, activeStageId, activeEdgeId };
}

/* Same validation the public API applies to an explicit status map, so a snapshot can only
   move the six known cards between the five known states. */
function statusesOf(value) {
  const base = initialStatuses(), next = { ...base };
  if (!value || typeof value !== 'object') return next;
  STAGES.forEach(stage => {
    const status = value[stage.id];
    if (typeof status === 'string' && Object.hasOwn(STATUS, status)) next[stage.id] = status;
  });
  return next;
}

const IDLE_PLAYBACK = { status: 'idle', progress: 0, iteration: 0, activeStageId: null, activeEdgeId: null };
const RUNNING_PLAYBACK = { status: 'running', progress: 0, iteration: 0, activeStageId: null, activeEdgeId: null };

/* ---------- stage card ---------- */

const StatusPill = memo(function StatusPill({ status }) {
  const state = statusOf(status);
  return <span className={`we-status we-status--${state.key}`} data-status={state.key}>
    <span className="we-status-dot" aria-hidden="true" />{state.label}
  </span>;
});

/* One row above the status footer: shared expert artwork on the left, every assigned tool
   on the right. Artwork and four-layer motion are owned by the Experts runtime. */
const StageResources = memo(function StageResources({ expert, tools, state }) {
  return <div className="we-stage-tools" data-expert-state={state}>
    {expert && <ExpertAvatar expert={expert} state={state} />}
    <span className="we-stage-apps">
      {tools.map(tool => <img key={tool.key} className="we-stage-app" src={tool.src} alt={tool.name}
        title={tool.name} width={22} height={22} loading="lazy" decoding="async" data-app={tool.slug} />)}
    </span>
  </div>;
});

const StageNode = memo(function StageNode({ id, data, selected }) {
  const state = statusOf(data.status);
  const StatusIcon = state.Icon;
  const isStart = id === STAGES[0].id;
  /* The amber start treatment marks the invitation to begin; it must never sit on top of a
     running or finished card, so it only applies while the card is still untouched. */
  const startHeld = isStart && state.key === 'idle';
  const running = state.key === 'running';
  const complete = state.key === 'done';
  /* Only a running or a completed stage makes its portrait fully opaque and animated. */
  const portraitState = running ? 'running' : complete ? 'done' : 'idle';
  return <article
    className={`we-stage we-stage--${state.key}${selected ? ' is-selected' : ''}${startHeld ? ' is-start' : ''}`}
    data-stage-id={id}
    data-stage-node={selected ? 'selected' : 'idle'}
    data-stage-state={state.key}
    data-stage-active={data.active ? 'true' : undefined}
    title={`${data.title} · ${data.phase} · ${state.label}`}
    aria-label={`${data.title}. ${data.phase}. ${state.label}.${data.active ? ' Currently running.' : ''}`}
    style={{ '--we-order': STAGES.findIndex(stage => stage.id === id) }}
    tabIndex={0}
    role="button"
    aria-pressed={selected}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onPick(id); } }}>
    {['Left', 'Right', 'Top', 'Bottom'].map(side => <span key={side}>
      <Handle id={`t-${side.toLowerCase()}`} type="target" position={Position[side]} isConnectable={false} />
      <Handle id={`s-${side.toLowerCase()}`} type="source" position={Position[side]} isConnectable={false} />
    </span>)}
    <div className="we-stage-top">
      <span className="we-stage-ord">{data.ordinal}</span>
      <span className="we-stage-phase">{data.phase}</span>
      <span className="we-stage-status-icon" aria-hidden="true">
        {running ? <span className="we-stage-spinner"><StatusIcon size={14} /></span> : <StatusIcon size={14} />}
      </span>
    </div>
    <h3>{data.title}</h3>
    <StageResources expert={data.expert} tools={data.tools} state={portraitState} />
    <div className="we-stage-foot">
      <span className="we-stage-status">
        {complete ? <CheckCircle2 size={11} aria-hidden="true" /> : running ? <span className="we-stage-spinner"><StatusIcon size={11} /></span> : <StatusIcon size={11} />}
        {state.label}
      </span>
      {data.deps > 0 && !running && !complete && <span className="we-stage-deps"><span aria-hidden="true">·</span>{data.deps} {data.deps === 1 ? 'dependency' : 'dependencies'}</span>}
    </div>
  </article>;
});
const nodeTypes = { stage: StageNode };

/* ---------- edges ---------- */

/* Every edge keeps its geometry. Only the single active edge is promoted to a wider lit path
   plus a scrolling dash overlay; everything else stays exactly as it was. */
function edgesFor(activeEdgeId, links) {
  return links.map((link) => {
    const { from: source, to: target, kind } = link;
    const nodes = positionsFor();
    const from = nodes[STAGES.findIndex(stage => stage.id === source)];
    const to = nodes[STAGES.findIndex(stage => stage.id === target)];
    if (!from || !to) return null;
    const loop = kind === 'loop';
    const id = `${source}--${target}`;
    const active = id === activeEdgeId;
    const tone = loop ? '#f3bd72' : '#8fc0ff';
    /* A finished hop keeps the green tone but never overrides the active highlight. */
    const complete = !active && Boolean(link.complete);
    const [sourceHandle, targetHandle] = loop ? ['s-left', 't-left'] : handlesFor(from, to);
    const color = active ? tone : loop ? '#f3bd72' : complete ? '#6ee0aa' : 'rgba(157,191,239,.48)';
    const edge = {
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      className: active ? 'we-edge is-active' : complete ? 'we-edge is-complete' : 'we-edge',
      data: { active, kind },
      pathOptions: { borderRadius: loop ? 20 : 16, offset: loop ? LOOP_ARC : 26 },
      style: active
        ? { stroke: color, strokeWidth: 2, strokeDasharray: '6 10', opacity: 1 }
        : { stroke: color, strokeWidth: 1.5, strokeDasharray: loop ? '5 4' : complete ? undefined : '4 5' },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: active ? 14 : 12, height: active ? 14 : 12 },
    };
    if (loop) {
      edge.label = 'iteration';
      edge.labelStyle = { fill: active ? '#ffe0ae' : '#f3bd72', fontSize: 10, fontFamily: 'ui-monospace, monospace' };
      edge.labelBgStyle = { fill: '#0b1622', fillOpacity: .92, stroke: active ? '#c79a4a' : '#86642a', strokeWidth: 1 };
      edge.labelBgPadding = [5, 2];
      edge.labelBgBorderRadius = 5;
    }
    if (active) {
      edge.ariaLabel = `${loop ? 'Feedback iteration' : 'Workflow'} connection in progress`;
      edge.animated = false;
    }
    return edge;
  }).filter(Boolean);
}

/* An edge is complete when both of its ends are done; those edges turn green. */
function edgeFlags(statuses) {
  return LINKS.map(link => ({ ...link, complete: statuses[link.from] === 'done' && statuses[link.to] === 'done' }));
}

/* ---------- overlays ---------- */

/* Compact running indicator: a state mark and one line. No smoothed progress bar. */
function RunIndicator({ playback }) {
  const stage = playback.activeStageId ? STAGES.find(item => item.id === playback.activeStageId) : null;
  const label = stage ? `${stage.ordinal} · ${stage.title}` : 'Starting the workflow';
  return <div className="we-run" data-status="running" role="status" aria-live="polite"
    aria-label={`Running. ${label}.`}>
    <span className="we-run-mark" aria-hidden="true"><LoaderCircle size={13} /></span>
    <span className="we-run-title">{label}</span>
  </div>;
}

/* Completed: the exact result line, the deliverable name and the existing callback. */
function DoneBar({ onOpenDeliverables }) {
  return <div className="we-done-bar" data-status="done" role="status" aria-live="polite">
    <span className="we-done-mark" aria-hidden="true"><CheckCircle2 size={14} /></span>
    <span className="we-done-copy">
      <b className="we-done-title">Task completed</b>

    </span>
    <button type="button" className="we-check-deliverables" data-check-result="true"
      onClick={() => onOpenDeliverables?.()}>Check Result</button>
  </div>;
}

const EmptyOverlay = memo(function EmptyOverlay({ onStart }) {
  return <button type="button" className="we-accept-start" data-accept-start="true"
      aria-label="Accept and start the workflow" onClick={onStart}>
      <ArrowRight size={15} /><span>Accept and Start</span>
    </button>;
});

/* Reserve both side panels in the initial view while keeping the canvas full width. */
function fullLayoutCanvasWidth(shell) {
  const style = getComputedStyle(shell);
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
    left: style.paddingLeft, right: style.paddingRight, height: '0', overflow: 'hidden',
    display: 'grid', columnGap: style.columnGap,
    gridTemplateColumns: `${style.getPropertyValue('--we-nav-width')} minmax(0, 1fr) ${style.getPropertyValue('--we-bot-width')}`,
  });
  probe.append(document.createElement('div'), document.createElement('div'), document.createElement('div'));
  shell.appendChild(probe);
  const width = probe.children[1].clientWidth;
  probe.remove();
  return width;
}

function Graph({ stages, selectedId, onSelect, bridge, layoutKey, playback, onOpenDeliverables }) {
  const { zoomIn, zoomOut, getViewport, setViewport, getNodes } = useReactFlow();
  const { zoom } = useViewport();
  const domNode = useStore(selector => selector.domNode);
  const frame = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [nodes, setNodes] = useState([]);
  const ready = useNodesInitialized();
  const resolved = playback || IDLE_PLAYBACK;
  const safeBottom = SAFE_BOTTOM[resolved.status] || SAFE_BOTTOM.idle;
  const running = resolved.status === 'running';
  const done = resolved.status === 'done';
  const activeEdgeId = running ? resolved.activeEdgeId : null;

  /* The one fit, used once on readiness and by the explicit fit/reset controls. It reads the
     container only to choose a camera, never to move a card. */
  const fit = useCallback((initial = false) => {
    if (!size.width || !size.height) return;
    const points = positionsFor(), nodeSize = sizeFor();
    const left = Math.min(...points.map(p => p.x)) - LOOP_ARC - 32;
    const right = Math.max(...points.map(p => p.x)) + nodeSize.width;
    const top = Math.min(...points.map(p => p.y));
    const bottom = Math.max(...points.map(p => p.y)) + nodeSize.height;
    const pad = 14;
    const shell = frame.current?.closest('.we-shell');
    const mobile = shell?.clientWidth <= 720;
    const width = initial === true && shell && !mobile ? Math.min(size.width, fullLayoutCanvasWidth(shell)) : size.width;
    const boxWidth = Math.max(80, width - pad * 2);
    const boxHeight = Math.max(80, size.height - pad * 2 - safeBottom);
    const nextZoom = mobile ? 1 : Math.max(.3, Math.min(1, boxWidth / (right - left), boxHeight / (bottom - top)));
    setViewport({
      x: mobile ? pad - left : (width - (right - left) * nextZoom) / 2 - left * nextZoom,
      y: mobile ? pad - top : pad + Math.max(0, (boxHeight - (bottom - top) * nextZoom) / 2) - top * nextZoom,
      zoom: nextZoom,
    }, { duration: 0 });
  }, [size.width, size.height, safeBottom, setViewport]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  /* Nodes are built once from the fixed grid. Resizing the container no longer rebuilds them,
     so the reader's viewport survives every resize. */
  useEffect(() => {
    const positions = positionsFor();
    setNodes(STAGES.map((stage, index) => ({ id: stage.id, type: 'stage', position: positions[index],
      selected: stage.id === selectedId, data: { ...stage, ...stageResourcesFor(stage.id), onPick: onSelect },
      style: sizeFor() })));
  }, [layoutKey]);

  useEffect(() => {
    setNodes(current => current.map(node => ({ ...node, selected: node.id === selectedId,
      data: { ...stages.find(stage => stage.id === node.id), ...stageResourcesFor(node.id), onPick: onSelect } })));
  }, [stages, selectedId, onSelect]);

  /* The camera is placed exactly once, when the graph is first ready. `fitted` is a plain ref so
     that neither a resize, a Supervisor expansion, a playback frame nor a stage change can ever
     re-run the fit or throw away the reader's viewport. Only an explicit fit/reset re-fits. */
  const fitted = useRef(-1);
  useEffect(() => {
    if (!ready || !nodes.length || !size.width || !size.height) return;
    if (fitted.current === layoutKey) return;
    const id = requestAnimationFrame(() => {
      fit(true); fitted.current = layoutKey; bridge.current.ready?.();
    });
    return () => cancelAnimationFrame(id);
  }, [layoutKey, ready, nodes.length, size.width, size.height, fit, bridge]);

  useEffect(() => {
    bridge.current.graph = {
      fit: () => fit(),
      setViewport: viewport => setViewport(viewport, { duration: 0 }),
      getViewport, getNodes, zoomIn, zoomOut,
    };
    return () => { bridge.current.graph = null; };
  }, [bridge, fit, setViewport, getViewport, getNodes, zoomIn, zoomOut]);

  /* The edges follow the stage states, so a finished hop turns green without moving anything. */
  const edgeStatuses = useMemo(() => Object.fromEntries(stages.map(stage => [stage.id, stage.status])), [stages]);
  const links = useMemo(() => edgeFlags(edgeStatuses), [edgeStatuses]);
  const edges = useMemo(() => edgesFor(activeEdgeId, links), [activeEdgeId, links]);

  return <div className="we-graph" ref={frame} style={{ '--we-safe-bottom': `${safeBottom}px` }}>
    <div className="we-canvas-viewport">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
        onNodeClick={(_, node) => onSelect(node.id)}
        minZoom={.3} maxZoom={1.8} nodesConnectable={false} deleteKeyCode={null}
        zoomOnDoubleClick={false} zoomOnScroll={false} panOnScroll={false} preventScrolling={false}
        edgesFocusable={false} proOptions={{ hideAttribution: true }} aria-label="Project workflow">
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(146,182,238,.20)" />
      </ReactFlow>
    </div>
    {running && <RunIndicator playback={resolved} />}
    {done && <DoneBar deliverable={resolved.deliverable} onOpenDeliverables={onOpenDeliverables} />}
    <div className="we-zoom" data-slot={running ? 'above-progress' : done ? 'above-deliverables' : 'bottom'} role="group" aria-label="Canvas zoom">
      <button type="button" onClick={() => zoomOut({ duration: 0 })} aria-label="Zoom out"><ZoomOut size={14} /></button>
      <button type="button" onClick={() => fit()} aria-label="Fit to view" title="Fit to view"><Maximize2 size={13} /><span>{Math.round(zoom * 100)}%</span></button>
      <button type="button" onClick={() => zoomIn({ duration: 0 })} aria-label="Zoom in"><ZoomIn size={14} /></button>
    </div>
  </div>;
}

function Canvas({ host, bridge, options }) {
  const [statuses, setStatuses] = useState(() => ({ ...initialStatuses(), ...options.statuses }));
  const [playback, setPlaybackState] = useState(() => ({ ...IDLE_PLAYBACK, statuses: statusesOf(options.statuses) }));
  const [selectedId, setSelectedId] = useState(options.selectedId || null);
  const [inspect, setInspect] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  /* Accept fires once per initiation: the flag survives double clicks and is only lifted by a
     playback reset or by the parent sending the snapshot back to idle. */
  const started = useRef(false);
  const stages = useMemo(() => STAGES.map(stage => ({
    ...stage,
    status: statuses[stage.id],
    active: playback.status === 'running' && playback.activeStageId === stage.id,
  })), [statuses, playback.status, playback.activeStageId]);
  const selected = stages.find(stage => stage.id === selectedId);
  /* Picking a card still opens its details; playback changes never call this. */
  const pick = useCallback(id => { setSelectedId(id); setInspect(true); }, []);

  const applySnapshots = useCallback((raw, { fromApi = false } = {}) => {
    const next = playbackOf(raw);
    if (next.status === 'idle') started.current = false;
    /* A reset frame from the parent (or an explicit idle snapshot) restores the initial graph. */
    if (fromApi && next.status === 'idle') {
      setStatuses(initialStatuses());
      setSelectedId(options.selectedId || null);
      setInspect(false);
      setLayoutKey(value => value + 1);
      setPlaybackState({ ...IDLE_PLAYBACK });
      return;
    }
    /* Any non-idle frame means the run is under way; keep Accept hidden even if the parent
       stopped sending running frames before the local optimistic lift was replaced. */
    if (next.status !== 'idle') started.current = true;
    const rawStatuses = raw && typeof raw === 'object' ? raw.statuses : undefined;
    if (rawStatuses && typeof rawStatuses === 'object') setStatuses(current => {
      const updated = statusesOf(rawStatuses);
      return STAGES.every(stage => current[stage.id] === updated[stage.id]) ? current : updated;
    });
    const deliverable = typeof raw?.deliverable === 'string' ? raw.deliverable : undefined;
    const nextFrame = deliverable ? { ...next, deliverable } : next;
    setPlaybackState(current => Object.keys(nextFrame).every(key => current[key] === nextFrame[key]) ? current : nextFrame);
  }, [options.selectedId]);

  useLayoutEffect(() => {
    bridge.current.api = {
      /* Selecting a stage opens its details only. There is deliberately no auto-pan: the graph
         must never move because a stage changed. */
      selectStage(id) { pick(id); },
      setStageStatus(id, status) { setStatuses(current => ({ ...current, [id]: status })); },
      setPlayback(snapshot) { applySnapshots(snapshot, { fromApi: true }); },
      reset() {
        started.current = false;
        setStatuses(initialStatuses());
        setSelectedId(options.selectedId || null);
        setInspect(false);
        setPlaybackState({ ...IDLE_PLAYBACK });
        setLayoutKey(value => value + 1);
      },
      getState: () => {
        const viewport = bridge.current.graph?.getViewport();
        return {
          selectedId, statuses,
          nodes: (bridge.current.graph?.getNodes() || []).map(node => ({
            id: node.id, position: { ...node.position }, size: { width: node.width, height: node.height },
          })),
          columns: 2,
          viewport: viewport || null,
          playback: { ...playback, statuses: { ...statuses } },
        };
      },
    };
    const state = { selectedId, statuses, playback: { ...playback, statuses: { ...statuses } } };
    options.onStateChange?.(state);
    host.dispatchEvent(new CustomEvent('sida:flow-change', { bubbles: true, detail: state }));
  }, [bridge, host, selectedId, statuses, playback, options, pick, applySnapshots]);

  const acceptStart = useCallback(() => {
    if (started.current || playback.status !== 'idle') return;
    started.current = true;
    /* Optimistic local lift so the button disappears at once; the parent then owns the truth. */
    setPlaybackState({ ...RUNNING_PLAYBACK });
    if (options.onAcceptStart?.() === false) {
      started.current = false; setPlaybackState({ ...IDLE_PLAYBACK }); return;
    }
    host.dispatchEvent(new CustomEvent('sida:accept-start', { bubbles: true }));
  }, [host, options, playback.status]);

  const idle = playback.status === 'idle';
  return <div className="we-flow-pane" data-playback={playback.status}>
    <div className="we-flow-canvas">
      <ReactFlowProvider><Graph stages={stages} selectedId={selectedId} onSelect={pick}
        bridge={bridge} layoutKey={layoutKey} playback={playback} onOpenDeliverables={options.onOpenDeliverables} />
        {idle && <EmptyOverlay onStart={acceptStart} />}
      </ReactFlowProvider>
      {inspect && selected && <section className="we-stage-detail" aria-label="Stage details">
        <button type="button" className="we-detail-close" onClick={() => setInspect(false)} aria-label="Close stage details"><X size={14} /></button>
        <span className="we-detail-kicker">{selected.ordinal} · {selected.app || 'Project'}</span>
        <h3>{selected.title}</h3><p>{selected.objective}</p>
        <div className="we-detail-files">{selected.files.map(file => <span key={file}>{file}</span>)}</div>
        <StatusPill status={selected.status} />
      </section>}
    </div>
  </div>;
}

const mounted = new WeakMap();
export function mount(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('A flow host is required.');
  if (mounted.has(host)) return mounted.get(host);
  host.classList.add('sida-demo-embed');
  const root = createRoot(host), bridge = { current: {} };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const assertStage = id => { if (!STAGES.some(stage => stage.id === id)) throw new Error(`Unknown stage: ${id}`); };
  const api = {
    ready,
    selectStage(id) { assertStage(id); bridge.current.api.selectStage(id); },
    setStageStatus(id, status) { assertStage(id); if (!Object.hasOwn(STATUS, status)) throw new Error(`Unknown status: ${status}`); bridge.current.api.setStageStatus(id, status); },
    /* Snapshots are validated with the same rules as the single-stage setter: the parent may
       only push known states, and an unknown one is rejected before the canvas sees it. */
    setPlayback(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') throw new Error('Playback needs a snapshot object.');
      const { status, progress, iteration, activeStageId, activeEdgeId, statuses, deliverable } = snapshot;
      if (status !== 'idle' && status !== 'running' && status !== 'done') throw new Error(`Unknown playback status: ${status}`);
      if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('Playback progress needs a number between 0 and 100.');
      if (![0, 1, 2].includes(iteration)) throw new Error(`Unknown playback iteration: ${iteration}`);
      if (activeStageId !== null && activeStageId !== undefined) assertStage(activeStageId);
      if (activeEdgeId !== null && activeEdgeId !== undefined
        && !LINKS.some(link => `${link.from}--${link.to}` === activeEdgeId)) throw new Error(`Unknown edge: ${activeEdgeId}`);
      if (statuses !== undefined && statuses !== null) {
        if (typeof statuses !== 'object') throw new Error('Playback statuses need an object of stage states.');
        Object.entries(statuses).forEach(([id, value]) => {
          assertStage(id);
          if (!Object.hasOwn(STATUS, value)) throw new Error(`Unknown status: ${value}`);
        });
      }
      bridge.current.api.setPlayback({ status, progress, iteration, activeStageId: activeStageId ?? null,
        activeEdgeId: activeEdgeId ?? null, statuses: statuses ? { ...statuses } : undefined,
        deliverable: typeof deliverable === 'string' ? deliverable : undefined });
    },
    setViewport(viewport) {
      if (!Number.isFinite(viewport?.x) || !Number.isFinite(viewport?.y) || !Number.isFinite(viewport?.zoom) || viewport.zoom < .3 || viewport.zoom > 1.8) throw new Error('Viewport needs finite x/y and zoom between 0.3 and 1.8.');
      bridge.current.graph?.setViewport(viewport);
    },
    fit() { return bridge.current.graph?.fit(); },
    getState() { return { ...bridge.current.api.getState(), viewport: bridge.current.graph?.getViewport() }; },
    reset() { bridge.current.api.reset(); },
    destroy() { root.unmount(); mounted.delete(host); host.classList.remove('sida-demo-embed'); },
  };
  bridge.current.ready = () => {
    if (!resolveReady) return;
    resolveReady(api); resolveReady = null;
    host.dispatchEvent(new CustomEvent('sida:flow-ready', { bubbles: true }));
  };
  mounted.set(host, api);
  root.render(<Canvas host={host} bridge={bridge} options={options} />);
  return api;
}
window.SIDAFlow = Object.freeze({ mount });
