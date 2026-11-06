import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { Check, Maximize2, Waypoints, X, ZoomIn, ZoomOut } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { DEMO_PROJECT, LINKS, STAGES, STATUS, handlesFor, initialStatuses, positionsFor, sizeFor } from './model.js';

function StatusPill({ status }) {
  const key = STATUS[status] ? status : 'idle';
  return <span className={`we-status we-status--${key}`} data-status={key}>
    <span className="we-status-dot" aria-hidden="true" />{STATUS[key]}
  </span>;
}

const StageNode = memo(function StageNode({ id, data, selected }) {
  return <article className={`we-stage${selected ? ' is-selected' : ''}`} data-stage-id={id}
    style={{ '--we-order': STAGES.findIndex(stage => stage.id === id) }}
    tabIndex={0} role="button" aria-label={data.title} aria-pressed={selected}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onPick(id); } }}>
    {['Left', 'Right', 'Top', 'Bottom'].map(side => <span key={side}>
      <Handle id={`t-${side.toLowerCase()}`} type="target" position={Position[side]} isConnectable={false} />
      <Handle id={`s-${side.toLowerCase()}`} type="source" position={Position[side]} isConnectable={false} />
    </span>)}
    <div className="we-stage-top">
      <span className="we-stage-ord">{id.slice(0, 2)}</span>
      <span className="we-stage-id">{id.slice(3)}</span>
      {data.app && <span className="we-app">{data.app}</span>}
    </div>
    <h3>{data.title}</h3>
    <p title={data.objective}>{data.objective}</p>
    <div className="we-stage-foot">
      <StatusPill status={data.status} />
      <span className="we-deps">{data.deps ? `${data.deps} ${data.deps === 1 ? 'dependency' : 'dependencies'}` : 'Start here'}</span>
    </div>
  </article>;
});
const nodeTypes = { stage: StageNode };

function edgesFor(nodes, statuses, columns) {
  return LINKS.map(([source, target]) => {
    const from = nodes.find(node => node.id === source);
    const to = nodes.find(node => node.id === target);
    if (!from || !to) return null;
    const [sourceHandle, targetHandle] = columns > 1 && source === '07-tender' && target === '09-handover'
      ? ['s-bottom', 't-bottom'] : handlesFor(from.position, to.position);
    const color = statuses[source] === 'done' ? '#6bc8b0' : statuses[source] === 'ready' ? '#70cdeb' : '#59738e';
    return { id: `${source}--${target}`, source, target, sourceHandle, targetHandle,
      type: 'smoothstep', pathOptions: { borderRadius: 16, offset: 24 },
      style: { stroke: color, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 } };
  }).filter(Boolean);
}

function Graph({ stages, statuses, selectedId, onSelect, bridge, layoutKey }) {
  const { fitView, zoomIn, zoomOut, getViewport, setViewport, setCenter, getNode } = useReactFlow();
  const frame = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [nodes, setNodes] = useState([]);
  const ready = useNodesInitialized();
  const columns = size.width < 480 ? 1 : 3;
  const compact = size.width < 700;
  const fit = useCallback(() => fitView({ padding: .08, minZoom: .3, maxZoom: 1, duration: 0 }), [fitView]);
  const focus = useCallback(id => {
    const node = getNode(id);
    if (!node) return;
    setCenter(node.position.x + node.measured.width / 2, node.position.y + node.measured.height / 2,
      { zoom: Math.max(.9, getViewport().zoom), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 });
  }, [getNode, getViewport, setCenter]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!size.width) return;
    const positions = positionsFor(size.width), nodeSize = sizeFor(size.width);
    setNodes(stages.map((stage, index) => ({ id: stage.id, type: 'stage', position: positions[index],
      selected: stage.id === selectedId, data: { ...stage, onPick: onSelect }, style: nodeSize })));
  }, [columns, compact, layoutKey, size.width === 0]);

  useEffect(() => {
    setNodes(current => current.map(node => ({ ...node, selected: node.id === selectedId,
      data: { ...stages.find(stage => stage.id === node.id), onPick: onSelect } })));
  }, [stages, selectedId, onSelect]);

  useEffect(() => {
    if (!ready || !size.width || !nodes.length) return;
    let cancelled = false;
    const id = requestAnimationFrame(async () => {
      if (columns === 1) {
        if (selectedId === STAGES[0].id) await setViewport({ x: (size.width - sizeFor(size.width).width) / 2, y: 24, zoom: 1 }, { duration: 0 });
        else focus(selectedId);
      } else await fit();
      if (!cancelled) bridge.current.ready?.();
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [size.width, size.height, columns, compact, ready, fit, focus, layoutKey]);

  useEffect(() => {
    bridge.current.graph = { fit, focus, setViewport: viewport => setViewport(viewport, { duration: 0 }), getViewport, zoomIn, zoomOut };
    return () => { bridge.current.graph = null; };
  }, [bridge, fit, focus, setViewport, getViewport, zoomIn, zoomOut]);

  const edges = useMemo(() => edgesFor(nodes, statuses, columns), [nodes, statuses, columns]);
  return <div className="we-graph" ref={frame} data-graph-columns={columns} data-compact={compact ? '' : undefined}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
      onNodeClick={(_, node) => onSelect(node.id)} onMove={(_, viewport) => setZoom(viewport.zoom)}
      minZoom={.3} maxZoom={1.8} nodesConnectable={false} deleteKeyCode={null}
      zoomOnDoubleClick={false} zoomOnScroll={false} panOnScroll={false} preventScrolling={false}
      proOptions={{ hideAttribution: true }} aria-label="Project workflow">
      <Background color="#456078" gap={24} size={1} />
    </ReactFlow>
    <div className="we-zoom" role="group" aria-label="Canvas zoom">
      <button type="button" onClick={() => zoomOut({ duration: 0 })} aria-label="Zoom out"><ZoomOut size={14} /></button>
      <button type="button" onClick={fit} aria-label="Fit to view" title="Fit to view"><Maximize2 size={13} /><span>{Math.round(zoom * 100)}%</span></button>
      <button type="button" onClick={() => zoomIn({ duration: 0 })} aria-label="Zoom in"><ZoomIn size={14} /></button>
    </div>
  </div>;
}

function Canvas({ host, bridge, options }) {
  const [statuses, setStatuses] = useState(() => ({ ...initialStatuses(), ...options.statuses }));
  const [selectedId, setSelectedId] = useState(options.selectedId || STAGES[0].id);
  const [inspect, setInspect] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const stages = useMemo(() => STAGES.map(stage => ({ ...stage, status: statuses[stage.id] })), [statuses]);
  const selected = stages.find(stage => stage.id === selectedId);
  const pick = useCallback(id => { setSelectedId(id); setInspect(true); }, []);

  useLayoutEffect(() => {
    bridge.current.api = {
      selectStage(id) { pick(id); bridge.current.graph?.focus(id); },
      setStageStatus(id, status) { setStatuses(current => ({ ...current, [id]: status })); },
      reset() { setStatuses(initialStatuses()); setSelectedId(STAGES[0].id); setInspect(false); setLayoutKey(value => value + 1); },
      getState: () => ({ selectedId, statuses }),
    };
    const state = { selectedId, statuses };
    options.onStateChange?.(state);
    host.dispatchEvent(new CustomEvent('sida:flow-change', { bubbles: true, detail: state }));
  }, [bridge, host, selectedId, statuses, options, pick]);

  return <div className="we-flow-pane">
    <header className="we-flow-head">
      <span className="we-flow-symbol"><Waypoints size={18} /></span>
      <span className="we-flow-heading"><b>{DEMO_PROJECT.name}</b><span>{STAGES.length} stages · {LINKS.length} dependencies</span></span>
      <span className="we-flow-ready"><Check size={12} />Prepared</span>
    </header>
    <div className="we-flow-canvas">
      <ReactFlowProvider><Graph stages={stages} statuses={statuses} selectedId={selectedId} onSelect={pick}
        bridge={bridge} layoutKey={layoutKey} /></ReactFlowProvider>
      {inspect && selected && <section className="we-stage-detail" aria-label="Stage details">
        <button type="button" className="we-detail-close" onClick={() => setInspect(false)} aria-label="Close stage details"><X size={14} /></button>
        <span className="we-detail-kicker">{selected.id} · {selected.app || 'Project'}</span>
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

