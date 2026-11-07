import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, FolderPlus, Waypoints } from 'lucide-react';
import { WorkspaceShell } from './shell.jsx';
import { WelcomeHome } from './welcome.jsx';
import { DEMO_PROJECT, STAGES, TASKS, initialStatuses } from './model.js';
import { prepareFlow } from './flow-loader.js';
import { createPlayback, idlePlayback } from './playback.js';
import { prepareModelView, deliverableUrls } from './soda-loader.js';
import './shell.css';
import './project.css';

const PANEL_BREAKPOINT = 1040;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function FlowView({ onReady, onChange, onError, onAcceptStart, onReplay, onOpenDeliverables }) {
  const host = useRef(null);
  useEffect(() => {
    let disposed = false, api;
    prepareFlow().then(module => {
      if (disposed) return;
      api = module.mount(host.current, { onStateChange: onChange, onAcceptStart, onReplay, onOpenDeliverables });
      return api.ready;
    }).then(() => { if (!disposed && api) onReady(api); }).catch(error => { if (!disposed) onError(error); });
    return () => { disposed = true; api?.destroy(); };
  }, [onReady, onChange, onError, onAcceptStart, onReplay, onOpenDeliverables]);
  return <div className="we-flow-mount" ref={host} />;
}

function DeliverableView({ onClose, onReady, onStatus }) {
  const host = useRef(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false, api;
    setError(''); onStatus('loading');
    prepareModelView().then(module => {
      if (disposed) return;
      api = module.mount(host.current, { ...deliverableUrls, onClose });
      onReady(api);
      return api.ready;
    }).then(() => { if (!disposed && api) onStatus('ready'); }).catch(() => {
      if (disposed) return;
      api?.destroy(); onReady(null); onStatus('error');
      setError('The model could not be opened. Please try again.');
    });
    return () => { disposed = true; api?.destroy(); onReady(null); };
  }, [onClose, onReady, onStatus, attempt]);
  return <div className="we-deliverable-view">
    <div className="we-soda-mount" ref={host} />
    {error && <div className="we-deliverable-fallback" role="alert"><p>{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      <button type="button" onClick={onClose}>Back to workflow</button></div>}
  </div>;
}

function App({ host, bridge }) {
  const [tab, setTab] = useState('welcome');
  const [demoStage, setDemoStage] = useState(1);
  const [maxUnlockedStage, setMaxUnlockedStage] = useState(1);
  const [compact, setCompact] = useState(false);
  const [project, setProject] = useState(null);
  const [transition, setTransition] = useState('idle');
  const [error, setError] = useState('');
  const [supOpen, setSupOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [railMode, setRailMode] = useState('project');
  const [playback, setPlayback] = useState(idlePlayback);
  const [resetToken, setResetToken] = useState(0);
  const [projectOpen, setProjectOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStatus, setViewerStatus] = useState('closed');
  const [flowState, setFlowState] = useState({ selectedId: STAGES[0].id, statuses: initialStatuses() });
  const wide = useRef(null), epoch = useRef(0), operation = useRef(null), flowApi = useRef(null), gate = useRef(null);
  const alive = useRef(true);
  const player = useRef(null), startAction = useRef(null), replayAction = useRef(null);
  const viewerApi = useRef(null), openViewerAction = useRef(null), panelBeforeViewer = useRef(null);
  const stageRequest = useRef(0);
  const maxUnlockedStageRef = useRef(1);
  const opening = transition !== 'idle';
  const accepted = playback.status !== 'idle';
  const tasks = TASKS.map(task => ({ ...task, status: playback.status, done: playback.status === 'done' }));

  useEffect(() => {
    player.current = createPlayback(snapshot => {
      if (!alive.current) return;
      setPlayback(snapshot);
      flowApi.current?.setPlayback(snapshot);
    });
    return () => { player.current?.destroy(); player.current = null; };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const isWide = Math.round(entry.contentRect.width) > PANEL_BREAKPOINT;
      setCompact(Math.round(entry.contentRect.width) <= 720);
      if (wide.current === null) setSupOpen(isWide);
      wide.current = isWide;
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => () => {
    alive.current = false; epoch.current += 1; gate.current?.resolve(null);
  }, []);

  const onFlowReady = useCallback(api => {
    flowApi.current = api;
    api.setPlayback(player.current?.getState() || idlePlayback());
    gate.current?.resolve(api);
  }, []);
  const onFlowChange = useCallback(state => setFlowState(state), []);
  const onFlowError = useCallback(error => gate.current?.reject(error), []);
  const onAcceptStart = useCallback(() => startAction.current?.(), []);
  const onReplay = useCallback(() => replayAction.current?.(), []);
  const onOpenDeliverables = useCallback(() => openViewerAction.current?.(), []);
  const onViewerReady = useCallback(api => { viewerApi.current = api; }, []);
  const onViewerStatus = useCallback(status => setViewerStatus(status), []);
  const closeDeliverables = useCallback(() => {
    setViewerOpen(false); setViewerStatus('closed'); setTab('flow'); setDemoStage(2);
    const panels = panelBeforeViewer.current;
    if (panels) { setSupOpen(panels.supervisor); setRailOpen(panels.rail); }
    panelBeforeViewer.current = null;
  }, []);
  const warmFlow = useCallback(() => { prepareFlow().catch(() => {}); }, []);

  function unlockDemoStage(number) {
    if (number <= maxUnlockedStageRef.current) return;
    maxUnlockedStageRef.current = number;
    setMaxUnlockedStage(number);
  }

  function startPlayback() {
    if (operation.current || !flowApi.current || !player.current || player.current.getState().status !== 'idle') return false;
    setTab('flow'); setRailMode('project'); setRailOpen(true); setProjectOpen(false); setSupOpen(true);
    setDemoStage(2);
    return player.current.start();
  }

  function replay() {
    if (!project || opening || player.current?.getState().status !== 'done') return false;
    if (viewerOpen) closeDeliverables();
    player.current.reset(); flowApi.current?.reset();
    setResetToken(value => value + 1);
    return startPlayback();
  }
  startAction.current = startPlayback;
  replayAction.current = replay;

  function openDeliverables() {
    if (operation.current || !flowApi.current || player.current?.getState().status !== 'done') return false;
    if (tab !== 'soda' || !panelBeforeViewer.current) {
      panelBeforeViewer.current = { supervisor: supOpen, rail: railOpen };
    }
    if (!viewerOpen) setViewerStatus('loading');
    unlockDemoStage(3);
    setViewerOpen(true); setDemoStage(3); setTab('soda');
    setSupOpen(false); setRailOpen(false); setProjectOpen(false);
    return true;
  }
  openViewerAction.current = openDeliverables;

  function changeTab(id) {
    if (opening) return;
    if (id === 'soda') { openDeliverables(); return; }
    if (id === 'apps' || id === 'console') return;
    if (tab === 'soda' && panelBeforeViewer.current) {
      setSupOpen(panelBeforeViewer.current.supervisor);
      setRailOpen(panelBeforeViewer.current.rail);
    }
    setTab(id);
  }

  function toggleRail() {
    if (host.getBoundingClientRect().width <= 720) {
      setRailOpen(true); setSupOpen(false); setProjectOpen(open => !open);
    } else { setProjectOpen(false); setRailOpen(open => !open); }
  }

  function newChat() {
    if (opening) return;
    setRailMode('chat'); setRailOpen(true);
    if (host.getBoundingClientRect().width <= 720) { setSupOpen(false); setProjectOpen(true); }
  }

  function openProject({ instant = false } = {}) {
    if (operation.current) return operation.current;
    if (project) { changeTab('flow'); setRailMode('project'); setProjectOpen(false); return Promise.resolve(true); }
    const token = ++epoch.current;
    const reduced = instant || matchMedia('(prefers-reduced-motion: reduce)').matches;
    setError(''); setTransition('opening'); setSupOpen(false); setProjectOpen(false); setRailMode('project');
    const run = (async () => {
      try {
        await Promise.all([prepareFlow(), pause(reduced ? 0 : 240)]);
        if (!alive.current || token !== epoch.current) return false;
        const ready = new Promise((resolve, reject) => { gate.current = { resolve, reject }; });
        setProject(DEMO_PROJECT); setTab('flow'); setDemoStage(2);
        const api = await ready;
        if (!api || !alive.current || token !== epoch.current) return false;
        setTransition('entering');
        await pause(reduced ? 0 : 560);
        if (!alive.current || token !== epoch.current) return false;
        setTransition('idle');
        unlockDemoStage(2);
        host.querySelector('.we-tab[data-tab="flow"]')?.focus({ preventScroll: true });
        return true;
      } catch {
        if (alive.current && token === epoch.current) {
          setProject(null); setTab('welcome'); setDemoStage(1); setTransition('idle');
          setError('This project could not be opened. Please try New Project again.');
        }
        return false;
      } finally {
        if (token === epoch.current) { operation.current = null; gate.current = null; }
      }
    })();
    operation.current = run;
    return run;
  }

  function reset() {
    stageRequest.current += 1;
    player.current?.reset();
    setViewerOpen(false); setViewerStatus('closed'); panelBeforeViewer.current = null;
    epoch.current += 1; gate.current?.resolve(null); gate.current = null; operation.current = null; flowApi.current = null;
    setProject(null); setTab('welcome'); setDemoStage(1); setTransition('idle'); setError(''); setProjectOpen(false);
    setPlayback(idlePlayback()); setResetToken(value => value + 1); setRailMode('project');
    setFlowState({ selectedId: STAGES[0].id, statuses: initialStatuses() });
    setSupOpen(wide.current === true);
    setRailOpen(true);
  }

  async function selectDemoStage(number) {
    if (![1, 2, 3].includes(number)) throw new Error(`Unknown demo stage: ${number}`);
    if (number > maxUnlockedStageRef.current) return false;
    if (number === 1) { reset(); return true; }
    const request = ++stageRequest.current;
    player.current?.reset();
    setViewerOpen(false); setViewerStatus('closed'); panelBeforeViewer.current = null;
    setTab('flow'); setRailMode('project'); setRailOpen(true); setProjectOpen(false);
    setSupOpen(false); setResetToken(value => value + 1); setError('');
    const ready = operation.current ? await operation.current : flowApi.current ? true : await openProject({ instant: true });
    if (!ready || !alive.current || request !== stageRequest.current) return false;
    flowApi.current.reset();
    setDemoStage(number);
    if (number === 3) {
      player.current.finish();
      return openViewerAction.current?.() || false;
    }
    return true;
  }

  function selectStage(id) {
    if (!project || !flowApi.current) throw new Error('Open a project before selecting a stage.');
    if (!STAGES.some(stage => stage.id === id)) throw new Error(`Unknown stage: ${id}`);
    setTab('flow'); setProjectOpen(false);
    flowApi.current?.selectStage(id);
  }

  useLayoutEffect(() => {
    bridge.current.api = {
      openProject,
      selectDemoStage,
      setTab(id) {
        if (!['welcome', 'flow', 'soda'].includes(id)) throw new Error(`Tab "${id}" is unavailable.`);
        if (id === 'flow' && !project) throw new Error('Open a project before using Flow.');
        if (id === 'soda' && playback.status !== 'done') throw new Error('Complete the workflow before checking the result.');
        changeTab(id);
      },
      toggleSupervisor: () => setSupOpen(open => !open),
      toggleRail,
      startPlayback,
      replay,
      openDeliverables,
      closeDeliverables,
      selectStage,
      reset,
      getState: () => ({ tab, demoStage, maxUnlockedStage: maxUnlockedStageRef.current,
        supervisor: supOpen ? 'open' : 'closed', rail: railOpen ? 'open' : 'closed',
        phase: project ? 'project' : 'welcome', accepted, railMode,
        nodes: flowApi.current?.getState().nodes || [], viewport: flowApi.current?.getState().viewport || null,
        deliverable: { open: viewerOpen, status: viewerStatus, view: viewerApi.current?.getState() || null },
        playback: { ...playback, messages: playback.messages.map(message => ({ ...message })) },
        transition, project, selectedId: flowState.selectedId, statuses: flowState.statuses,
        tasks: tasks.map(task => ({ ...task })) }),
    };
    bridge.current.ready?.();
    host.dispatchEvent(new CustomEvent('sida:workflow-change', { bubbles: true }));
  });

  return <WorkspaceShell activeTab={tab} onTab={changeTab} deliverablesReady={playback.status === 'done'}
    demoStage={demoStage} maxUnlockedStage={maxUnlockedStage} onSelectDemoStage={selectDemoStage} sodaOpen={viewerOpen}
    onOpenDeliverables={onOpenDeliverables} sidebarVisible={railOpen && (!compact || projectOpen)}
    supOpen={supOpen} onToggleSupervisor={() => { setProjectOpen(false); setSupOpen(open => !open); }}
    railOpen={railOpen} onToggleRail={toggleRail} railMode={railMode} onRailMode={setRailMode}
    playback={playback} messages={playback.messages} resetToken={resetToken}
    project={project} tasks={tasks} selectedId={flowState.selectedId} opening={opening} transition={transition}
    onSelectStage={selectStage}
    projectOpen={projectOpen} onToggleProject={() => { setSupOpen(false); setProjectOpen(open => !open); }}>
    <div className="we-screen we-screen-welcome" hidden={tab !== 'welcome'}>
      <WelcomeHome projects={[DEMO_PROJECT]} onNewProject={openProject} onOpenProject={openProject}
        onPrepareProject={warmFlow} onNewChat={newChat} opening={opening} highlight={demoStage === 1 && !project && !opening} />
    </div>
    {project && <div className="we-screen we-screen-flow" hidden={tab !== 'flow'}>
      <FlowView onReady={onFlowReady} onChange={onFlowChange} onError={onFlowError} onAcceptStart={onAcceptStart} onReplay={onReplay} onOpenDeliverables={onOpenDeliverables} />
    </div>}
    {viewerOpen && <div className="we-screen we-screen-soda" hidden={tab !== 'soda'}>
      <DeliverableView key={resetToken} onClose={closeDeliverables} onReady={onViewerReady} onStatus={onViewerStatus} />
    </div>}
    {opening && <div className="we-project-transition" data-transition={transition} role="status" aria-live="polite">
      <div className="we-project-portal"><FolderPlus size={32} /></div>
      <b>Opening {DEMO_PROJECT.name}</b><span>Bringing your workspace together</span>
      <div className="we-project-checks"><span><Check size={12} />Task</span><span><Waypoints size={12} />Workflow</span><span><Check size={12} />Project files</span></div>
    </div>}
    {error && <p className="we-demo-error" role="alert">{error}</p>}
  </WorkspaceShell>;
}

const mounted = new WeakMap();
export function mount(target) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('A workspace host is required.');
  if (mounted.has(host)) return mounted.get(host);
  host.classList.add('sida-demo-embed');
  const root = createRoot(host), bridge = { current: {} };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const api = {
    ready,
    openProject() { return bridge.current.api.openProject(); },
    selectDemoStage(number) { return bridge.current.api.selectDemoStage(number); },
    setTab(id) { bridge.current.api.setTab(id); },
    selectStage(id) { bridge.current.api.selectStage(id); },
    toggleSupervisor() { bridge.current.api.toggleSupervisor(); },
    toggleRail() { bridge.current.api.toggleRail(); },
    startPlayback() { return bridge.current.api.startPlayback(); },
    replay() { return bridge.current.api.replay(); },
    openDeliverables() { return bridge.current.api.openDeliverables(); },
    closeDeliverables() { bridge.current.api.closeDeliverables(); },
    getState() { return bridge.current.api.getState(); },
    reset() { bridge.current.api.reset(); },
    destroy() { root.unmount(); mounted.delete(host); host.classList.remove('sida-demo-embed'); },
  };
  bridge.current.ready = () => {
    if (!resolveReady) return;
    resolveReady(api); resolveReady = null;
    host.dispatchEvent(new CustomEvent('sida:workflow-ready', { bubbles: true }));
  };
  mounted.set(host, api);
  root.render(<App host={host} bridge={bridge} />);
  return api;
}
window.SIDAWorkflowDemo = Object.freeze({ mount });
function boot() { document.querySelectorAll('[data-sida-workflow]').forEach(host => mount(host)); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();

