import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, BackgroundVariant, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useReactFlow } from '@xyflow/react';
import { CheckCircle2, Circle, LoaderCircle, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { APPS, EXPERTS, SERVICES, SERVICE_BY_ID, STATUS, dependenciesFor, fixedStatuses, handlesFor } from './data.js';
import { layoutFor } from './layout.js';
import { layoutBounds, roundedPath } from './geometry.js';

const STATUS_ICONS = { start: Circle, running: LoaderCircle, done: CheckCircle2 };

function statusOf(value) {
  const key = STATUS[value] ? value : 'done';
  return { key, label: STATUS[key].label, Icon: STATUS_ICONS[key] || Circle };
}

function AppIcon({ slug, name, size = 20 }) {
  return <img className="apf-app-icon" src={`flow-assets/apps/${slug}.svg`} alt="" title={name} width={size} height={size} loading="lazy" />;
}

function AppChips({ apps, detailed = false }) {
  return <span className={`apf-apps${detailed ? ' apf-apps--detail' : ''}`}>
    {apps.map(key => {
      const app = APPS[key];
      if (!app) return null;
      return <span className="apf-app" key={key} title={app.name} role="img" aria-label={app.name}>
        <AppIcon slug={app.slug} name={app.name} />
      </span>;
    })}
  </span>;
}

function ExpertPortrait({ expertId }) {
  const expert = EXPERTS[expertId];
  if (!expert) return null;
  return <span className="apf-expert" data-expert={expertId} data-portrait="image" role="img" aria-label={expert.name} title={expert.name}>
    <img className="apf-expert__image" src={expert.portrait} alt="" width="32" height="32" />
  </span>;
}

const StageNode = memo(function StageNode({ data, selected }) {
  const state = statusOf(data.status);
  const StatusIcon = state.Icon;
  return <article
    className={`apf-node apf-node--${state.key}${data.kind === 'review' ? ' apf-node--review' : ''}${selected ? ' is-selected' : ''}`}
    data-stage-node={selected ? 'selected' : 'idle'}
    data-stage-state={state.key}
    data-review={data.kind === 'review' ? 'true' : undefined}
    title={`${data.title} · ${data.phase} · ${state.label}`}
    aria-label={`${data.title}. ${data.phase}. ${state.label}.`}
    tabIndex={0}
    role="button"
    aria-pressed={selected}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onSelect?.(data.id); } }}>
    {['Left', 'Right', 'Top', 'Bottom'].map(side => <span key={side}>
      <Handle id={`t-${side.toLowerCase()}`} type="target" position={Position[side]} isConnectable={false} />
      <Handle id={`s-${side.toLowerCase()}`} type="source" position={Position[side]} isConnectable={false} />
    </span>)}
    <div className="apf-node__top">
      <span className="apf-node__ord">{data.ordinal}</span>
      <span className="apf-node__phase">{data.phase}</span>
      <span className="apf-node__status-icon" aria-hidden="true"><StatusIcon size={13} /></span>
    </div>
    <h3>{data.title}</h3>
    <div className="apf-node__tools"><ExpertPortrait expertId={data.expert} /><AppChips apps={data.apps} /></div>
    <div className="apf-node__foot">
      <span className="apf-node__status"><StatusIcon size={10} />{state.label}</span>
      {data.deps ? <span className="apf-node__deps"><span aria-hidden="true">·</span>{`${data.deps} ${data.deps === 1 ? 'dependency' : 'dependencies'}`}</span> : null}
    </div>
  </article>;
});
const nodeTypes = { stage: StageNode };

const ServiceEdge = memo(function ServiceEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, style, markerEnd, data }) {
  const route = data?.route;
  const path = route?.via?.length
    ? roundedPath([{ x: sourceX, y: sourceY }, ...route.via, { x: targetX, y: targetY }])
    : getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12, offset: 18 })[0];
  return <>
    <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={12} />
    {route?.label ? <text className="apf-edge-label" x={route.label.x} y={route.label.y} textAnchor="middle" dominantBaseline="central">{route.label.text}</text> : null}
  </>;
});
const edgeTypes = { service: ServiceEdge };

function edgesFor(service, nodes, statuses, routes) {
  const nodeById = Object.fromEntries(nodes.map(node => [node.id, node]));
  return service.links.map(([source, target, metadata = {}]) => {
    const from = nodeById[source];
    const to = nodeById[target];
    if (!from || !to) return null;
    const route = routes[`${source}->${target}`] || {};
    const [defaultSource, defaultTarget] = handlesFor(from.position, to.position);
    const live = statuses[source] === 'running' || statuses[target] === 'running';
    const color = metadata.feedback ? '#c7a56e' : live ? '#96bdff' : 'rgba(157,191,239,.72)';
    return {
      id: `${service.id}:${source}--${target}`,
      source,
      target,
      sourceHandle: route.sourceHandle || defaultSource,
      targetHandle: route.targetHandle || defaultTarget,
      type: 'service',
      data: { route },
      animated: true,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: '4 5' },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
    };
  }).filter(Boolean);
}

function Graph({ service, statuses, selectedId, onSelect, onResetSelection }) {
  const { setViewport, zoomIn, zoomOut } = useReactFlow();
  const frame = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const layout = useMemo(() => layoutFor(service, size.width), [service, size.width]);
  const nodes = useMemo(() => service.nodes.map(stage => ({
    id: stage.id,
    type: 'stage',
    position: layout.positions[stage.id],
    selected: stage.id === selectedId,
    style: layout.nodeSize,
    data: { ...stage, status: statuses[stage.id], deps: dependenciesFor(service, stage.id), onSelect },
  })), [service, layout, selectedId, statuses, onSelect]);
  const edges = useMemo(() => edgesFor(service, nodes, statuses, layout.routes), [service, nodes, statuses, layout]);
  const fit = useCallback(() => {
    const host = frame.current;
    if (!host || !host.clientWidth || !host.clientHeight) return;
    const bounds = layoutBounds(layoutFor(service, host.clientWidth));
    const availableHeight = host.clientHeight - 52;
    const scale = Math.min(1, (host.clientWidth - 28) / bounds.width, (availableHeight - 28) / bounds.height);
    setViewport({ x: (host.clientWidth - bounds.width * scale) / 2 - bounds.x * scale, y: (availableHeight - bounds.height * scale) / 2 - bounds.y * scale, zoom: scale });
    setZoom(scale);
  }, [setViewport, service]);

  useLayoutEffect(() => {
    let pending;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = frame.current;
      if (width > 0 && height > 0) setSize({ width, height });
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(pending); };
  }, [fit]);

  useEffect(() => {
    if (!ready || !size.width || !nodes.length) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => { if (!cancelled) fit(); });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [ready, size.width, size.height, service.id, fit, nodes.length]);

  return <div className="apf-graph" ref={frame}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={() => setReady(true)} colorMode="dark"
      onNodeClick={(_, node) => onSelect(node.id)} onMove={(_, viewport) => setZoom(viewport.zoom)}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable
      minZoom={.35} maxZoom={1.5} deleteKeyCode={null} zoomOnDoubleClick={false} zoomOnScroll={false} panOnScroll={false} preventScrolling={false}
      proOptions={{ hideAttribution: true }} aria-label={`${service.label} illustrative workflow`}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(146,182,238,.20)" />
    </ReactFlow>
    <div className="apf-zoom" role="group" aria-label="Canvas controls">
      <button type="button" onClick={() => zoomOut({ duration: 160 })} aria-label="Zoom out"><ZoomOut size={14} /></button>
      <button type="button" className="apf-zoom__fit" onClick={fit} aria-label="Fit to view" title="Fit to view"><Maximize2 size={13} /><span>{Math.round(zoom * 100)}%</span></button>
      <button type="button" onClick={() => zoomIn({ duration: 160 })} aria-label="Zoom in"><ZoomIn size={14} /></button>
      <button type="button" onClick={() => { fit(); onResetSelection?.(); }} aria-label="Reset view" title="Reset view"><RotateCcw size={13} /></button>
    </div>
  </div>;
}

function NodeDetail({ service, stage, onClose }) {
  if (!stage) return null;
  const state = statusOf(stage.status);
  const StateIcon = state.Icon;
  return <aside className="apf-detail" aria-label="Selected task details">
    <button type="button" className="apf-detail__close" onClick={onClose} aria-label="Close task details"><X size={14} /></button>
    <p className="apf-detail__kicker">{stage.ordinal} · {stage.phase}{stage.kind === 'review' ? ' · human review gate' : ''}</p>
    <h2>{stage.title}</h2>
    <p className="apf-detail__summary">{stage.summary}</p>
    {stage.output ? <p className="apf-detail__output"><strong>Output</strong> {stage.output}</p> : null}
    <div className="apf-detail__tools"><ExpertPortrait expertId={stage.expert} /><AppChips apps={stage.apps} detailed /></div>
    <p className="apf-detail__expert-name">{EXPERTS[stage.expert]?.name}</p>
    <p className="apf-detail__status"><span className={`apf-status apf-status--${state.key}`}><StateIcon size={11} />{state.label}</span><span className="apf-detail__service">{service.label}</span></p>
  </aside>;
}

function ServiceTabs({ activeId, onChange }) {
  const refs = useRef([]);
  function onKeyDown(event, index) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + SERVICES.length) % SERVICES.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % SERVICES.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = SERVICES.length - 1;
    onChange(SERVICES[next].id);
    refs.current[next]?.focus();
  }
  return <div className="apf-tabs" role="tablist" aria-label="Engineering services">
    {SERVICES.map((service, index) => <button key={service.id} ref={node => { refs.current[index] = node; }} type="button" role="tab"
      id={`apf-tab-${service.id}`} aria-selected={service.id === activeId} aria-controls="apf-panel" tabIndex={service.id === activeId ? 0 : -1}
      onClick={() => onChange(service.id)} onKeyDown={event => onKeyDown(event, index)}>{service.label}</button>)}
  </div>;
}

function App() {
  const [activeId, setActiveId] = useState(SERVICES[0].id);
  const [selectedByService, setSelectedByService] = useState({});
  const service = SERVICE_BY_ID[activeId];
  const statuses = useMemo(() => fixedStatuses(service), [service]);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hostPaused, setHostPaused] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    let inView = true;
    const update = () => setVisible(!document.hidden && inView);
    document.addEventListener('visibilitychange', update);
    let observer;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); }, { threshold: .05 });
      if (root.current) observer.observe(root.current);
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    media.addEventListener('change', motion);
    let hostDocument;
    const hostMotion = () => setHostPaused(hostDocument.documentElement.dataset.motionState === 'reduced');
    try {
      hostDocument = window.parent.document;
      hostDocument.addEventListener('ouronex:motion-state', hostMotion);
      hostMotion();
    } catch (_) { hostDocument = null; }
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      media.removeEventListener('change', motion);
      hostDocument?.removeEventListener('ouronex:motion-state', hostMotion);
      observer?.disconnect();
    };
  }, []);

  const selected = service.nodes.find(stage => stage.id === selectedByService[activeId]) || null;

  function selectStage(id) {
    setSelectedByService(current => ({ ...current, [activeId]: id }));
  }

  return <div className="apf-shell" ref={root} data-motion-paused={!visible || reduced || hostPaused ? 'true' : 'false'}>
    <header className="apf-head">
      <ServiceTabs activeId={activeId} onChange={setActiveId} />
    </header>
    <main className="apf-canvas" id="apf-panel" role="tabpanel" aria-labelledby={`apf-tab-${activeId}`}>
      <ReactFlowProvider key={service.id}>
        <Graph service={service} statuses={statuses} selectedId={selected?.id || null} onSelect={selectStage}
          onResetSelection={() => setSelectedByService(current => ({ ...current, [activeId]: null }))} />
      </ReactFlowProvider>
      {selected ? <NodeDetail service={service} stage={{ ...selected, status: statuses[selected.id] }} onClose={() => setSelectedByService(current => ({ ...current, [activeId]: null }))} /> : null}
    </main>
  </div>;
}

createRoot(document.getElementById('application-flow-root')).render(<App />);
