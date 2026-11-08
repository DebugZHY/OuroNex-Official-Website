import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSodaViewer } from './soda-renderer.js';
import { getSectionGlyphSvg, getSectionTypeLabel } from './section-glyphs.js';
import './soda-viewer.css';

/* Resolve icons beside the published viewer script. */
const ICON_BASE = new URL('soda-icons/', document.currentScript?.src || document.baseURI);
const sodaIcon = (file) => new URL(file, ICON_BASE).href;

function MaterialIcon() {
  return <span class="soda-material-icon" aria-hidden="true">S</span>;
}

/* Section rows show the section designation only: drop the leading grade and
 * the copied-section suffix while keeping the source spelling of the profile. */
function sectionLabel(name) {
  return String(name ?? '')
    .replace(/^(?:Q\d{3}|S\d{3}|C\d{2})\s*/i, '')
    .replace(/(?:\+?_copy|\+)+$/i, '')
    .trim();
}

function ModelExplorer({ materials, sections, counts, selection, ready, open, onToggle, onSelect }) {
  const treeId = useId();
  const [expanded, setExpanded] = useState({ material: true, section: false });
  const [focused, setFocused] = useState('material');
  const materialRows = useMemo(() => [...materials].sort((a, b) => a.id - b.id), [materials]);
  const sectionRows = useMemo(() => sections.filter((section) => section.memberCount > 0).map((section) => ({
    ...section,
    label: sectionLabel(section.name),
    glyph: getSectionGlyphSvg(section.sectionType, true),
    typeLabel: getSectionTypeLabel(section.sectionType),
  })), [sections]);
  const roots = [
    { id: 'material', label: 'Material', count: materialRows.length, children: materialRows },
    { id: 'section', label: 'Section', count: sectionRows.length, children: sectionRows },
    { id: 'node', label: 'Node', count: counts.nodeCount ?? 0 },
    { id: 'element', label: 'Element', count: counts.memberCount ?? 0 },
    { id: 'area', label: 'Area' },
  ];
  const visibleKeys = roots.flatMap((root) => [root.id, ...(expanded[root.id]
    ? (root.children || []).map((entry) => `${root.id}:${entry.id}`) : [])]);
  const focusKey = visibleKeys.includes(focused) ? focused : 'material';
  const trackFocus = (key) => (event) => {
    if (event.target === event.currentTarget) setFocused(key);
  };
  const activate = (event, action) => {
    if (event.target.closest('[role="treeitem"]') !== event.currentTarget) return;
    event.currentTarget.focus({ preventScroll: true });
    action?.();
  };
  const focusItem = (item) => {
    item?.focus({ preventScroll: true });
    item?.firstElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const navigateTree = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = event.target.closest('[role="treeitem"]');
    if (!item) return;
    const items = Array.from(event.currentTarget.querySelectorAll('[role="treeitem"]'));
    const index = items.indexOf(item);
    const isOpen = item.getAttribute('aria-expanded');
    switch (event.key) {
      case 'ArrowDown': focusItem(items[Math.min(index + 1, items.length - 1)]); break;
      case 'ArrowUp': focusItem(items[Math.max(index - 1, 0)]); break;
      case 'Home': focusItem(items[0]); break;
      case 'End': focusItem(items[items.length - 1]); break;
      case 'ArrowRight':
        if (isOpen === 'false') item.click();
        else if (isOpen === 'true') focusItem(item.querySelector('[role="treeitem"]'));
        break;
      case 'ArrowLeft':
        if (isOpen === 'true') item.click();
        else focusItem(item.parentElement.closest('[role="treeitem"]'));
        break;
      case 'Enter':
      case ' ': item.click(); break;
      default: return;
    }
    event.preventDefault();
  };

  return (
    <aside class="soda-explorer" aria-label="Model Explorer">
      <button type="button" class="soda-explorer-toggle" aria-expanded={open} aria-controls={treeId}
        aria-label={`${open ? 'Collapse' : 'Expand'} Model Explorer`}
        title={`${open ? 'Collapse' : 'Expand'} Model Explorer`} onClick={onToggle}>
        <span class="soda-caret" aria-hidden="true" data-open={open ? 'true' : 'false'} />
        <span class="soda-explorer-title">Model Explorer</span>
      </button>
      <ul id={treeId} class="soda-tree" role="tree" aria-label="Model Explorer" hidden={!open}
        aria-busy={!ready} onKeyDown={navigateTree}>
        {roots.map((root) => {
          const expandable = Boolean(root.children);
          const label = `${root.label}${root.count === undefined ? '' : ` (${ready ? root.count : '—'})`}`;
          return (
            <li key={root.id} class="soda-tree-item soda-tree-root" role="treeitem" aria-label={label}
              data-soda-root={root.id} aria-expanded={expandable ? expanded[root.id] : undefined}
              tabIndex={focusKey === root.id ? 0 : -1} onFocus={trackFocus(root.id)}
              onClick={(event) => activate(event, expandable
                ? () => setExpanded((current) => ({ ...current, [root.id]: !current[root.id] })) : undefined)}>
              <div class="soda-tree-row soda-tree-root-row">
                <span class={expandable ? 'soda-caret' : 'soda-caret-space'} aria-hidden="true"
                  data-open={expanded[root.id] ? 'true' : 'false'} />
                <span>{label}</span>
              </div>
              {expandable && expanded[root.id] && (
                <ul role="group" class="soda-tree-group">
                  {root.children.map((entry) => {
                    const key = `${root.id}:${entry.id}`;
                    const selected = selection?.kind === root.id && selection.id === entry.id;
                    const description = `${entry.label ?? entry.name}${entry.typeLabel ? ` · ${entry.typeLabel}` : ''} · ${entry.memberCount} elements`;
                    return (
                      <li key={entry.id} class="soda-tree-item soda-tree-leaf" role="treeitem"
                        data-soda-kind={root.id} data-soda-id={entry.id}
                        data-section-type={root.id === 'section' ? entry.sectionType : undefined}
                        aria-label={description} aria-selected={selected} title={description}
                        tabIndex={focusKey === key ? 0 : -1} onFocus={trackFocus(key)}
                        onClick={(event) => activate(event, () => onSelect(root.id, entry.id))}>
                        <div class="soda-tree-row soda-tree-leaf-row">
                          {root.id === 'section'
                            ? <span class="soda-section-glyph" style={{ color: entry.color }} aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: entry.glyph }} />
                            : <MaterialIcon />}
                          <span class="soda-tree-name">{entry.label ?? entry.name}</span>
                          <span class="soda-member-count" aria-hidden="true">{entry.memberCount}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

const INTERACTION_MODES = [
  { id: 'pan', icon: 'pan.png', label: 'Pan mode' },
  { id: 'rotate', icon: 'rotate.png', label: 'Rotate mode' },
];

function ViewButtons({ onProjection, onZoomIn, onZoomOut, onFit, disabled, ortho, mode, onMode }) {
  return (
    <div class="soda-buttons" role="group" aria-label="Camera and interaction controls" tabIndex={0}>
      <div class="soda-switcher" role="group" aria-label="Camera projection">
        <button type="button" class="soda-btn" aria-label="Perspective view" title="Perspective view" aria-pressed={!ortho}
          data-soda-action="perspective" disabled={disabled} onClick={() => onProjection(false)}>
          <img src={sodaIcon("perspective_view.png")} alt="" draggable={false} />
        </button>
        <button type="button" class="soda-btn" aria-label="Isometric view" title="Isometric view" aria-pressed={ortho}
          data-soda-action="isometric" disabled={disabled} onClick={() => onProjection(true)}>
          <img src={sodaIcon("isometric_view.png")} alt="" draggable={false} />
        </button>
      </div>
      <div class="soda-switcher" role="group" aria-label="Interaction mode">
        {INTERACTION_MODES.map((entry) => (
          <button key={entry.id} type="button" class="soda-btn" aria-label={entry.label}
            title={entry.label} aria-pressed={mode === entry.id} data-soda-mode={entry.id}
            disabled={disabled} onClick={() => onMode(entry.id)}>
            <img src={sodaIcon(entry.icon)} alt="" draggable={false} />
          </button>
        ))}
      </div>
      <button type="button" class="soda-btn" aria-label="Zoom in" title="Zoom In" data-soda-action="zoom-in" disabled={disabled} onClick={onZoomIn}>
        <img src={sodaIcon("zoom_in.png")} alt="" draggable={false} />
      </button>
      <button type="button" class="soda-btn" aria-label="Zoom out" title="Zoom Out" data-soda-action="zoom-out" disabled={disabled} onClick={onZoomOut}>
        <img src={sodaIcon("zoom_out.png")} alt="" draggable={false} />
      </button>
      <button type="button" class="soda-btn" aria-label="Fit to screen" title="Fit to Screen" data-soda-action="fit" disabled={disabled} onClick={onFit}>
        <img src={sodaIcon("fit_to_screen.png")} alt="" draggable={false} />
      </button>
    </div>
  );
}

/* Corner axis gizmo. `basis` maps a model axis into view space (the camera's
 * inverse orientation composed with the source Z-up transform), so the triad
 * shows the model's own X/Y/Z rather than the orbit quaternion. */
function AxisGizmo({ basis }) {
  const axes = useMemo(() => {
    const [x, y, z, w] = basis;
    /* Rotate a unit axis by the quaternion (x,y,z,w). */
    const rotate = (vx, vy, vz) => {
      const tx = 2 * (y * vz - z * vy);
      const ty = 2 * (z * vx - x * vz);
      const tz = 2 * (x * vy - y * vx);
      return [
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
      ];
    };
    return [
      { id: 'x', vector: rotate(1, 0, 0), fill: '#ff6666', label: 'X' },
      { id: 'y', vector: rotate(0, 1, 0), fill: '#00cc00', label: 'Y' },
      { id: 'z', vector: rotate(0, 0, 1), fill: '#6666ff', label: 'Z' },
    ].flatMap((axis) => [1, -1].map((sign) => {
      const [ax, ay, az] = axis.vector.map((value) => value * sign);
      const length = sign > 0 ? 29.53125 : 25.3125;
      const depth = az;
      const fill = depth < 0 ? `#${axis.fill.slice(1).match(/../g).map((hex) => {
        const value = parseInt(hex, 16) / 255;
        const linear = (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * .75;
        return Math.round((linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055) * 255).toString(16).padStart(2, '0');
      }).join('')}` : axis.fill;
      return { ...axis, id: `${axis.id}${sign}`, sign, fill, x: 56.25 + ax * length, y: 56.25 - ay * length, depth };
    })).sort((a, b) => a.depth - b.depth);
  }, [basis]);

  return (
    <svg class="soda-gizmo" viewBox="0 0 112.5 112.5" width="112.5" height="112.5" role="img" aria-label="Model orientation axes">
      {axes.map((axis) => (
        <g key={axis.id}>
          <line x1="56.25" y1="56.25" x2={axis.x} y2={axis.y} stroke={axis.fill}
            strokeWidth={axis.sign > 0 ? 3 : 1.5} strokeDasharray={axis.sign < 0 ? '1.125 1.40625' : undefined} />
          <circle cx={axis.x} cy={axis.y} r={axis.sign > 0 ? 7.3125 : 3.375} fill={axis.fill} />
          {axis.sign > 0 && <text x={axis.x} y={axis.y + 3.5} textAnchor="middle" fontSize="10.5"
            fontFamily="Arial, sans-serif" fontWeight="bold" fill="#ffffff">{axis.label}</text>}
        </g>
      ))}
    </svg>
  );
}

function initialViewerState() {
  return {
    materials: [], sections: [], counts: {}, selection: null, displayName: '', sourceFile: '',
    quaternion: [0, 0, 0, 1], axisBasis: [0, 0, 0, 1], ortho: true, mode: 'rotate',
  };
}

/* Keep catalog references stable while camera-only snapshots arrive. */
function mergeViewerState(current, snapshot) {
  const next = {
    materials: snapshot.materials ?? current.materials,
    sections: snapshot.sections ?? current.sections,
    counts: snapshot.counts ?? current.counts,
    selection: 'selection' in snapshot ? snapshot.selection : current.selection,
    displayName: snapshot.displayName ?? current.displayName,
    sourceFile: snapshot.sourceFile ?? current.sourceFile,
    quaternion: snapshot.quaternion ?? current.quaternion,
    axisBasis: snapshot.axisBasis ?? current.axisBasis,
    ortho: snapshot.projection ? snapshot.projection !== 'perspective' : current.ortho,
    mode: snapshot.interactionMode ?? current.mode,
  };
  for (const key of ['materials', 'sections']) {
    if (next[key].length === current[key].length && next[key].every((entry, index) =>
      ['id', 'name', 'color', 'memberCount', 'sectionType'].every((field) => entry[field] === current[key][index][field]))) {
      next[key] = current[key];
    }
  }
  if (Object.keys(next.counts).length === Object.keys(current.counts).length
    && Object.keys(next.counts).every((key) => next.counts[key] === current.counts[key])) next.counts = current.counts;
  for (const key of ['quaternion', 'axisBasis']) {
    if (next[key].every((value, index) => Math.abs(value - current[key][index]) < 1e-6)) next[key] = current[key];
  }
  if (next.selection && current.selection
    && ['kind', 'id', 'memberCount'].every((key) => next.selection[key] === current.selection[key])) {
    next.selection = current.selection;
  }
  return Object.keys(next).every((key) => next[key] === current[key]) ? current : next;
}

function SodaView({ modelUrl, metadataUrl, compressedModelUrl, bridge }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const explorerChoice = useRef(null);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(initialViewerState);
  const [explorerOpen, setExplorerOpen] = useState(true);
  /* Default to a rail in compact embeds; a manual choice survives resizes. */
  useEffect(() => {
    const viewport = canvasRef.current?.closest('.soda-view');
    const syncDefault = () => {
      const width = viewport?.clientWidth || 0;
      if (width && explorerChoice.current === null) setExplorerOpen(width > 620);
    };
    syncDefault();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(syncDefault);
      if (viewport) observer.observe(viewport);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', syncDefault);
    return () => window.removeEventListener('resize', syncDefault);
  }, []);
  /* Only camera changes enter the undo/redo history. */
  const [, setHistory] = useState({ stack: [], index: -1 });

  const snapshotView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return null;
    const view = viewer.getState();
    return { quaternion: view.quaternion, target: view.target, zoom: view.zoom, projection: view.projection, frustum: view.frustum };
  }, []);

  const recordView = useCallback(() => {
    const shot = snapshotView();
    if (!shot) return;
    setHistory((current) => {
      const base = current.index < 0 ? [] : current.stack.slice(0, current.index + 1);
      const last = base[base.length - 1];
      const same = last
        && last.zoom === shot.zoom
        && last.projection === shot.projection
        && last.frustum === shot.frustum
        && last.quaternion.every((value, index) => Math.abs(value - shot.quaternion[index]) < 1e-6)
        && last.target.every((value, index) => Math.abs(value - shot.target[index]) < 1e-6);
      if (same) return current;
      const stack = [...base, shot].slice(-40);
      return { stack, index: stack.length - 1 };
    });
  }, [snapshotView]);

  const applyHistory = useCallback((direction) => {
    setHistory((current) => {
      const index = current.index + direction;
      if (index < 0 || index >= current.stack.length) return current;
      const shot = current.stack[index];
      const viewer = viewerRef.current;
      if (viewer) {
        viewer.restoreView(shot);
      }
      return { ...current, index };
    });
  }, []);

  useEffect(() => {
    let active = true;
    let initialViewRecorded = false;
    setHistory({ stack: [], index: -1 });
    setState(initialViewerState());
    const receiveState = (snapshot) => {
      if (!active) return;
      setStatus(snapshot.status);
      setMessage(snapshot.error || '');
      setState((current) => mergeViewerState(current, snapshot));
      if (snapshot.status === 'ready' && !initialViewRecorded && viewerRef.current) {
        initialViewRecorded = true;
        recordView();
      }
    };
    const viewer = createSodaViewer(canvasRef.current, {
      modelUrl, metadataUrl, compressedModelUrl, onState: receiveState,
    });
    viewerRef.current = viewer;
    bridge.current = viewer;

    /* Selection, catalog and camera UI all consume renderer snapshots. */
    let wheelTimer = 0;
    const unsubscribe = viewer.subscribe(receiveState);
    receiveState(viewer.getState());
    const canvas = canvasRef.current;
    const scheduleRecord = () => {
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(recordView, 180);
    };
    canvas?.addEventListener('pointerup', scheduleRecord);
    canvas?.addEventListener('pointercancel', scheduleRecord);
    canvas?.addEventListener('wheel', scheduleRecord, { passive: true });

    viewer.ready.then(
      () => { if (active) bridge.resolve?.(viewer); },
      (error) => { if (active) bridge.reject?.(error); },
    );
    return () => {
      active = false;
      clearTimeout(wheelTimer);
      unsubscribe?.();
      canvas?.removeEventListener('pointerup', scheduleRecord);
      canvas?.removeEventListener('pointercancel', scheduleRecord);
      canvas?.removeEventListener('wheel', scheduleRecord);
      viewer.destroy();
      if (bridge.current === viewer) bridge.current = null;
      viewerRef.current = null;
    };
  }, [attempt, bridge, modelUrl, metadataUrl, compressedModelUrl, recordView]);

  const retry = useCallback(() => {
    setStatus('loading');
    setMessage('');
    setAttempt((value) => value + 1);
  }, []);

  const selectLeaf = useCallback((kind, id) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const snapshot = viewer.getState();
    if (snapshot.status !== 'ready') return;
    if (snapshot.selection?.kind === kind && snapshot.selection.id === id) viewer.clearSelection();
    else if (kind === 'material') viewer.selectMaterial(id);
    else if (kind === 'section') viewer.selectSection(id);
  }, []);

  const withViewer = useCallback((action) => () => {
    const viewer = viewerRef.current;
    if (viewer) action(viewer);
  }, []);

  return (
    <div class="soda-view" data-soda-view="true" data-soda-status={status}
      data-explorer={explorerOpen ? 'open' : 'closed'} onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          event.preventDefault();
          applyHistory(key === 'y' || event.shiftKey ? 1 : -1);
        }
      }}>
      <div class="soda-toolbar" role="toolbar" aria-label="View controls" aria-orientation="horizontal">
        <ViewButtons
          disabled={status !== 'ready'}
          ortho={state.ortho}
          mode={state.mode}
          onMode={(mode) => viewerRef.current?.setInteractionMode(mode)}
          onProjection={(nextOrtho) => {
            viewerRef.current?.setProjection(nextOrtho ? 'orthographic' : 'perspective');
            recordView();
          }}
          onZoomIn={withViewer((viewer) => { viewer.zoomBy(1.25); recordView(); })}
          onZoomOut={withViewer((viewer) => { viewer.zoomBy(0.8); recordView(); })}
          onFit={withViewer((viewer) => { viewer.fit(); recordView(); })}
        />
        <span class="soda-file" title={state.displayName || 'Frame-model-v2.dat'}>
          {state.displayName || 'Frame-model-v2.dat'}
        </span>
      </div>
      <div class="soda-stage">
        <ModelExplorer materials={state.materials} sections={state.sections} counts={state.counts}
          selection={state.selection} ready={status === 'ready'} open={explorerOpen}
          onToggle={() => setExplorerOpen((current) => {
            explorerChoice.current = !current;
            return !current;
          })} onSelect={selectLeaf} />
        <div class="soda-scene">
          <canvas class="soda-canvas" ref={canvasRef}
            aria-label="SODA model view. Use the toolbar to select a drag mode, scroll to zoom."
            tabIndex={0} />
          <AxisGizmo basis={state.axisBasis} />
          {status === 'loading' && <div class="soda-status" role="status">Loading model…</div>}
          {status === 'error' && (
            <div class="soda-status soda-status--error" role="alert">
              <span>Unable to load the 3D model.</span>
              {message ? <small>{message}</small> : null}
              <button type="button" class="soda-retry" onClick={retry}>Retry</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const instances = new WeakMap();

/* Each host owns one renderer; public controls forward to that instance. */
export function mount(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host || !host.nodeType) throw new Error('A SODA view host is required.');
  if (instances.has(host)) return instances.get(host);

  const bridge = { current: null, resolve: null, reject: null, destroyed: false };
  const ready = new Promise((resolve, reject) => {
    bridge.resolve = resolve;
    bridge.reject = reject;
  });
  ready.catch(() => {});

  const root = createRoot(host);
  const api = {
    ready,
    getState() {
      if (bridge.current) return bridge.current.getState();
      return { status: bridge.destroyed ? 'destroyed' : 'loading' };
    },
    get quaternion() { return bridge.current?.quaternion ?? null; },
    get target() { return bridge.current?.target ?? null; },
    get zoom() { return bridge.current?.zoom ?? null; },
    get frames() { return bridge.current?.frames ?? 0; },
    get counts() { return bridge.current?.counts ?? { nodeCount: 0, memberCount: 0, sectionCount: 0, triangleCount: 0 }; },
    get materials() { return bridge.current?.getState().materials ?? []; },
    get sections() { return bridge.current?.getState().sections ?? []; },
    get selection() { return bridge.current?.getState().selection ?? null; },
    selectMaterial(id) { return bridge.current?.selectMaterial(id); },
    selectSection(id) { return bridge.current?.selectSection(id); },
    clearSelection() { return bridge.current?.clearSelection(); },
    get projection() { return bridge.current?.projection ?? 'orthographic'; },
    get interactionMode() { return bridge.current?.interactionMode ?? 'rotate'; },
    setInteractionMode(mode) { return bridge.current?.setInteractionMode(mode); },
    get axisBasis() { return bridge.current?.axisBasis ?? null; },
    setProjection(type) { return bridge.current?.setProjection(type); },
    get metadata() { return bridge.current?.metadata ?? null; },
    setQuaternion(values) { return bridge.current?.setQuaternion(values); },
    setTarget(values) { return bridge.current?.setTarget(values); },
    setZoom(value) { return bridge.current?.setZoom(value); },
    fit() { return bridge.current?.fit(); },
    resetView() { return bridge.current?.resetView(); },
    onClose(target_onClose) { bridge.onClose = target_onClose; },
    destroy() {
      if (bridge.destroyed) return;
      bridge.destroyed = true;
      bridge.reject?.(new Error('The model view was closed.'));
      root.unmount();
      instances.delete(host);
    },
  };
  bridge.onClose = options.onClose;
  instances.set(host, api);
  root.render(
    <SodaView bridge={bridge} modelUrl={options.modelUrl} metadataUrl={options.metadataUrl} compressedModelUrl={options.compressedModelUrl} />,
  );
  return api;
}

window.SODAModelView = Object.freeze({ mount });
