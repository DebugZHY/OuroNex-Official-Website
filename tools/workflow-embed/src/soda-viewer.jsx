import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSodaViewer } from './soda-renderer.js';
import { getSectionGlyphSvg, getSectionTypeLabel } from './section-glyphs.js';
import './soda-viewer.css';

/* Icons come from the bundled SODA source, copied next to the published viewer
 * asset. Resolving against the entry script keeps the paths valid wherever the
 * embed is deployed; the map is built once per module. */
const ICON_BASE = new URL('soda-icons/', document.currentScript?.src || document.baseURI);
const sodaIcon = (file) => new URL(file, ICON_BASE).href;

/* The original SODA glyph vocabulary uses the stored section type. Usage
 * chooses solid/outline; section colour only tints that real geometry icon. */
function SectionList({ sections, sectionCount, open, onToggle }) {
  const listId = useId();
  const rows = useMemo(() => sections.map((section) => ({
    ...section,
    glyph: getSectionGlyphSvg(section.sectionType, section.memberCount > 0),
    typeLabel: getSectionTypeLabel(section.sectionType),
  })), [sections]);
  if (!rows.length) return null;
  return (
    <div class="soda-sections" data-soda-sections={rows.length} data-open={open ? 'true' : 'false'}>
      <button type="button" class="soda-sections-head" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        <span class="soda-caret" aria-hidden="true" data-open={open ? 'true' : 'false'} />
        <span>Section List</span>
        <span class="soda-sections-count">{sectionCount || rows.length}</span>
      </button>
      {open && (
        <ul id={listId} class="soda-section-list" aria-label="Sections and element counts" tabIndex={0}>
          {rows.map((section) => (
            <li key={section.id} data-section-id={section.id} data-section-type={section.sectionType}
              data-used={section.memberCount > 0 ? 'true' : 'false'}
              title={`${section.name} · ${section.typeLabel} · ${section.memberCount} elements`}>
              <span class="soda-section-glyph" style={{ color: section.color }} aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: section.glyph }} />
              <span class="soda-section-name">{section.name}</span>
              <span class="soda-section-count" aria-label={`${section.memberCount} elements`}>{section.memberCount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Button group mirrors SODA's own right column minus Views and Light Source:
 * projection switcher, perspective, isometric, undo, redo, zoom, fit. */
/* Interaction modes from the source (Init.js:531-535): Select, Pan, Rotate.
 * Each is a real left-drag behaviour, not a state-only toggle. */
const INTERACTION_MODES = [
  { id: 'select', icon: 'cursor_hollow.png', label: 'Select mode' },
  { id: 'pan', icon: 'pan.png', label: 'Pan mode' },
  { id: 'rotate', icon: 'rotate.png', label: 'Rotate mode' },
];

function RightButtons({ onProjection, onUndo, onRedo, canUndo, canRedo, onZoomIn, onZoomOut, onFit,
  ortho, mode, onMode }) {
  return (
    <div class="soda-buttons" role="toolbar" aria-label="View controls" aria-orientation="vertical">
      <div class="soda-switcher" role="group" aria-label="Camera projection">
        <button type="button" class="soda-btn" aria-label="Perspective view" aria-pressed={!ortho}
          data-soda-action="perspective" onClick={() => onProjection(false)}>
          <img src={sodaIcon("perspective_view.png")} alt="" draggable={false} />
        </button>
        <span class="soda-switcher-pill" aria-hidden="true">
          <span class="soda-switcher-dot" data-ortho={ortho ? 'true' : 'false'} />
        </span>
        <button type="button" class="soda-btn" aria-label="Isometric view" aria-pressed={ortho}
          data-soda-action="isometric" onClick={() => onProjection(true)}>
          <img src={sodaIcon("isometric_view.png")} alt="" draggable={false} />
        </button>
      </div>
      <button type="button" class="soda-btn" aria-label="Undo view change" title="Undo (Ctrl/Cmd+Z)"
        data-soda-action="undo" disabled={!canUndo} onClick={onUndo}>
        <img src={sodaIcon("undo.svg")} alt="" draggable={false} />
      </button>
      <button type="button" class="soda-btn" aria-label="Redo view change" title="Redo (Ctrl/Cmd+Y)"
        data-soda-action="redo" disabled={!canRedo} onClick={onRedo}>
        <img src={sodaIcon("redo.svg")} alt="" draggable={false} />
      </button>
      <div class="soda-switcher soda-switcher--modes" role="group" aria-label="Interaction mode">
        {INTERACTION_MODES.map((entry) => (
          <button key={entry.id} type="button" class="soda-btn" aria-label={entry.label}
            title={entry.label} aria-pressed={mode === entry.id} data-soda-mode={entry.id}
            onClick={() => onMode(entry.id)}>
            <img src={sodaIcon(entry.icon)} alt="" draggable={false} />
          </button>
        ))}
        <span class="soda-switcher-pill soda-switcher-pill--modes" aria-hidden="true">
          <span class="soda-switcher-dot soda-switcher-dot--modes"
            data-index={Math.max(0, INTERACTION_MODES.findIndex((entry) => entry.id === mode))} />
        </span>
      </div>
      <button type="button" class="soda-btn" aria-label="Zoom in" title="Zoom In" data-soda-action="zoom-in" onClick={onZoomIn}>
        <img src={sodaIcon("zoom_in.png")} alt="" draggable={false} />
      </button>
      <button type="button" class="soda-btn" aria-label="Zoom out" title="Zoom Out" data-soda-action="zoom-out" onClick={onZoomOut}>
        <img src={sodaIcon("zoom_out.png")} alt="" draggable={false} />
      </button>
      <button type="button" class="soda-btn" aria-label="Fit to screen" title="Fit to Screen" data-soda-action="fit" onClick={onFit}>
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

function SodaView({ modelUrl, metadataUrl, compressedModelUrl, bridge }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    sections: [], counts: {}, displayName: '', sourceFile: '',
    quaternion: [0, 0, 0, 1], axisBasis: [0, 0, 0, 1], ortho: true, mode: 'rotate',
  });
  const [sectionsOpen, setSectionsOpen] = useState(false);
  /* Defaults follow this embedded viewport, not the browser window. Crossing
   * into phone width collapses the list; explicit toggles survive other resizes. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = canvas?.closest('.soda-view');
    let previousCompact;
    const syncDefault = () => {
      const width = viewport?.clientWidth || 0;
      if (!width) return;
      const compact = width < 620;
      if (compact !== previousCompact) {
        previousCompact = compact;
        setSectionsOpen(!compact);
      }
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
  /* Every view change that the user can see is recorded, so Undo / Redo walk
   * real states instead of re-running a hard-coded action. */
  const [history, setHistory] = useState({ stack: [], index: -1 });

  /* Section colours are rendered inside inline styles; the CSP-friendly
   * version uses the metadata hex directly. */
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
    const viewer = createSodaViewer(canvasRef.current, {
      modelUrl,
      metadataUrl,
      compressedModelUrl,
      onState(next) {
        if (!active) return;
        setStatus(next.status);
        setMessage(next.error || '');
        if (next.status === 'ready') {
          setState((current) => ({
            ...current,
            sections: next.sections,
            counts: next.counts,
            displayName: next.displayName,
            sourceFile: next.sourceFile,
            quaternion: next.quaternion,
            axisBasis: next.axisBasis,
            ortho: next.projection !== 'perspective',
          }));
          if (!initialViewRecorded) {
            initialViewRecorded = true;
            recordView();
          }
        }
      },
    });
    viewerRef.current = viewer;
    bridge.current = viewer;

    /* The renderer notifies on each committed frame, so the gizmo follows the
     * camera without a polling loop of our own. */
    let wheelTimer = 0;
    const unsubscribe = viewer.subscribe?.((snapshot) => {
      if (!active) return;
      setState((current) => {
        const same = current.quaternion.every((value, index) => Math.abs(value - snapshot.quaternion[index]) < 1e-6)
          && current.axisBasis.every((value, index) => Math.abs(value - snapshot.axisBasis[index]) < 1e-6)
          && current.ortho === (snapshot.projection !== 'perspective');
        if (same) return current;
        return { ...current, quaternion: snapshot.quaternion, axisBasis: snapshot.axisBasis, ortho: snapshot.projection !== 'perspective' };
      });
    });
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

  const withViewer = useCallback((action) => () => {
    const viewer = viewerRef.current;
    if (viewer) action(viewer);
  }, []);

  return (
    <div class="soda-view" data-soda-view="true" data-soda-status={status} data-sections={sectionsOpen ? 'open' : 'closed'} onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        applyHistory(key === 'y' || event.shiftKey ? 1 : -1);
      }
    }}>
      <div class="soda-stage">
        <div class="soda-scene">
        <canvas class="soda-canvas" ref={canvasRef}
          aria-label="SODA model view. Drag to orbit, shift-drag to pan, scroll to zoom."
          tabIndex={0} />
        </div>

        <div class="soda-brand" role="img" aria-label="SODA">SODA</div>

        <div class="soda-left">
          <SectionList sections={state.sections} sectionCount={state.counts.sectionCount || 0}
            open={sectionsOpen} onToggle={() => setSectionsOpen((value) => !value)} />
        </div>

        <div class="soda-controls">
        <RightButtons
          ortho={state.ortho}
          mode={state.mode}
          onMode={(mode) => {
            /* The mode changes the real left-drag gesture in the renderer. */
            viewerRef.current?.setInteractionMode(mode);
            setState((current) => ({ ...current, mode }));
          }}
          onProjection={(nextOrtho) => {
            /* Swap the actual camera (orthographic <-> perspective) and refit;
             * the source does the same through setCameraState(cameraType). */
            const viewer = viewerRef.current;
            const applied = viewer?.setProjection(nextOrtho ? 'orthographic' : 'perspective');
            setState((current) => ({
              ...current,
              ortho: applied ? applied !== 'perspective' : nextOrtho,
            }));
            recordView();
          }}
          canUndo={history.index > 0}
          canRedo={history.index < history.stack.length - 1}
          onUndo={() => applyHistory(-1)}
          onRedo={() => applyHistory(1)}
          onZoomIn={withViewer((viewer) => { viewer.zoomBy(1.25); recordView(); })}
          onZoomOut={withViewer((viewer) => { viewer.zoomBy(0.8); recordView(); })}
          onFit={withViewer((viewer) => { viewer.fit(); recordView(); })}
        />
        </div>

        <AxisGizmo basis={state.axisBasis} />

        <div class="soda-statusbar" role="group" aria-label="Model information">
          <dl class="soda-counts">
            <div><dt>Nodes</dt><dd>{status === 'ready' ? state.counts.nodeCount ?? 0 : '—'}</dd></div>
            <div><dt>Elements</dt><dd>{status === 'ready' ? state.counts.memberCount ?? 0 : '—'}</dd></div>
          </dl>
          <span class="soda-file" title={state.displayName || 'Frame-model-v2.dat'}>
            {state.displayName || 'Frame-model-v2.dat'}
          </span>
        </div>

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
  );
}

const instances = new WeakMap();

/* mount(host, { modelUrl, metadataUrl, onClose }) -> { ready, getState, destroy }.
 * Metadata and the GLB are fetched once per mount; the public API proxies the
 * renderer so tests can read quaternion, target, zoom, frame and counts. */
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
    get sections() { return bridge.current?.sections ?? []; },
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
