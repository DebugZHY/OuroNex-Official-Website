import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, FolderPlus, Waypoints } from 'lucide-react';
import { WorkspaceShell } from './shell.jsx';
import { WelcomeHome } from './welcome.jsx';
import { DEMO_PROJECT, STAGES, TASKS, initialStatuses } from './model.js';
import { prepareFlow } from './flow-loader.js';
import './shell.css';
import './project.css';

const PANEL_BREAKPOINT = 1040;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function FlowView({ onReady, onChange, onError }) {
  const host = useRef(null);
  useEffect(() => {
    let disposed = false, api;
    prepareFlow().then(module => {
      if (disposed) return;
      api = module.mount(host.current, { onStateChange: onChange });
      return api.ready;
    }).then(() => { if (!disposed && api) onReady(api); }).catch(error => { if (!disposed) onError(error); });
    return () => { disposed = true; api?.destroy(); };
  }, [onReady, onChange, onError]);
  return <div className="we-flow-mount" ref={host} />;
}

function App({ host, bridge }) {
  const [tab, setTab] = useState('welcome');
  const [project, setProject] = useState(null);
  const [transition, setTransition] = useState('idle');
  const [error, setError] = useState('');
  const [supOpen, setSupOpen] = useState(true);
  const [projectOpen, setProjectOpen] = useState(false);
  const [tasks, setTasks] = useState(() => TASKS.map(task => ({ ...task, done: false })));
  const [flowState, setFlowState] = useState({ selectedId: STAGES[0].id, statuses: initialStatuses() });
  const wide = useRef(null), epoch = useRef(0), operation = useRef(null), flowApi = useRef(null), gate = useRef(null);
  const alive = useRef(true);
  const opening = transition !== 'idle';

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const isWide = Math.round(entry.contentRect.width) > PANEL_BREAKPOINT;
      if (wide.current === isWide) return;
      wide.current = isWide;
      setSupOpen(isWide);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => () => {
    alive.current = false; epoch.current += 1; gate.current?.resolve(null);
  }, []);

  const onFlowReady = useCallback(api => { flowApi.current = api; gate.current?.resolve(api); }, []);
  const onFlowChange = useCallback(state => setFlowState(state), []);
  const onFlowError = useCallback(error => gate.current?.reject(error), []);
  const warmFlow = useCallback(() => { prepareFlow().catch(() => {}); }, []);

  function openProject() {
    if (operation.current) return operation.current;
    if (project) { setTab('flow'); setProjectOpen(false); return Promise.resolve(true); }
    const token = ++epoch.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setError(''); setTransition('opening'); setSupOpen(false); setProjectOpen(false);
    const run = (async () => {
      try {
        await Promise.all([prepareFlow(), pause(reduced ? 0 : 240)]);
        if (!alive.current || token !== epoch.current) return false;
        const ready = new Promise((resolve, reject) => { gate.current = { resolve, reject }; });
        setProject(DEMO_PROJECT); setTab('flow');
        const api = await ready;
        if (!api || !alive.current || token !== epoch.current) return false;
        setTransition('entering');
        await pause(reduced ? 0 : 560);
        if (!alive.current || token !== epoch.current) return false;
        setTransition('idle');
        host.querySelector('.we-tab[data-tab="flow"]')?.focus({ preventScroll: true });
        return true;
      } catch {
        if (alive.current && token === epoch.current) {
          setProject(null); setTab('welcome'); setTransition('idle');
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
    epoch.current += 1; gate.current?.resolve(null); gate.current = null; operation.current = null; flowApi.current = null;
    setProject(null); setTab('welcome'); setTransition('idle'); setError(''); setProjectOpen(false);
    setTasks(TASKS.map(task => ({ ...task, done: false })));
    setFlowState({ selectedId: STAGES[0].id, statuses: initialStatuses() });
    setSupOpen(wide.current === true);
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
      setTab(id) {
        if (id !== 'welcome' && id !== 'flow') throw new Error(`Tab "${id}" is unavailable.`);
        if (id === 'flow' && !project) throw new Error('Open a project before using Flow.');
        if (!opening) setTab(id);
      },
      toggleSupervisor: () => setSupOpen(open => !open),
      selectStage,
      reset,
      getState: () => ({ tab, supervisor: supOpen ? 'open' : 'closed', phase: project ? 'project' : 'welcome',
        transition, project, selectedId: flowState.selectedId, statuses: flowState.statuses,
        tasks: tasks.map(task => ({ ...task })) }),
    };
    bridge.current.ready?.();
    host.dispatchEvent(new CustomEvent('sida:workflow-change', { bubbles: true }));
  });

  return <WorkspaceShell activeTab={tab} onTab={id => { if (!opening) setTab(id); }}
    supOpen={supOpen} onToggleSupervisor={() => { setProjectOpen(false); setSupOpen(open => !open); }}
    project={project} tasks={tasks} selectedId={flowState.selectedId} opening={opening} transition={transition}
    onSelectStage={selectStage} onToggleTask={id => setTasks(current => current.map(task => task.id === id ? { ...task, done: !task.done } : task))}
    projectOpen={projectOpen} onToggleProject={() => { setSupOpen(false); setProjectOpen(open => !open); }}>
    <div className="we-screen we-screen-welcome" hidden={tab !== 'welcome'}>
      <WelcomeHome projects={[DEMO_PROJECT]} onNewProject={openProject} onOpenProject={openProject}
        onPrepareProject={warmFlow} opening={opening} />
    </div>
    {project && <div className="we-screen we-screen-flow" hidden={tab !== 'flow'}>
      <FlowView onReady={onFlowReady} onChange={onFlowChange} onError={onFlowError} />
    </div>}
    {opening && <div className="we-project-transition" data-transition={transition} role="status" aria-live="polite">
      <div className="we-project-portal"><FolderPlus size={32} /></div>
      <b>Opening {DEMO_PROJECT.name}</b><span>Bringing your workspace together</span>
      <div className="we-project-checks"><span><Check size={12} />To-do list</span><span><Waypoints size={12} />Workflow</span><span><Check size={12} />Project files</span></div>
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
    setTab(id) { bridge.current.api.setTab(id); },
    selectStage(id) { bridge.current.api.selectStage(id); },
    toggleSupervisor() { bridge.current.api.toggleSupervisor(); },
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

