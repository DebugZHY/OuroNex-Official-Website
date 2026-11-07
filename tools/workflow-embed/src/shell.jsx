import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Boxes, Check, ChevronDown, FileText, Folder, FolderTree, House, LayoutDashboard, LayoutGrid, LoaderCircle, MessageSquare, Plus, Waypoints } from 'lucide-react';
import './shell.css';
import { APP_ICONS, appIconPath, STAGES, TASKS } from './model.js';

/* Three parent-controlled stages: Welcome, prepared/running Workflow, and the SODA result.
   The external dots only request a stage; they never advance on a timer. */
const DEMO_STAGES = [
  { n: 1, label: 'Stage 1: Welcome' },
  { n: 2, label: 'Stage 2: Workflow' },
  { n: 3, label: 'Stage 3: SODA result' },
];

const DELIVERABLE_FILE = 'Frame-model-v2.dat';

/* Stage folder -> completion flag published by playback.completedStageIds. The folder id is
   the stage id, so the mapping is explicit here rather than inferred in the view. */
const STAGE_COMPLETION = {
  '01-references': 'references',
  '02-codes': 'codes',
  '03-model': 'model',
  '04-analysis': 'analysis',
  '05-optimise': 'optimise',
  '06-handover': 'output',
};

const ICONS = {
  chat: MessageSquare, folder: FolderTree, project: Boxes, home: House,
  console: LayoutDashboard, flow: Waypoints, apps: LayoutGrid,
  send: ArrowUp, plus: Plus,
};
function Icon({ name, size = 15 }) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" size={size} />;
}

/* Matching panel outlines; the narrow filled side identifies the panel, not its open state. */
function PanelToggleIcon({ side, size = 14 }) {
  const left = side === 'left';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x={left ? 4 : 15} y={4} width={5} height={16} rx={.5}
      fill="currentColor" fillOpacity={.5} stroke="none" />
    <rect x={3} y={3} width={18} height={18} rx={2} />
    <path d={left ? 'M9 3v18' : 'M15 3v18'} />
  </svg>;
}

/* The SODA tab reuses the existing local SODA app icon instead of a generic glyph. */
function SodaIcon({ size = 14 }) {
  return <img className="we-soda-icon" src={appIconPath(APP_ICONS.soda.slug)} alt="" aria-hidden="true"
    width={size} height={size} loading="lazy" decoding="async" data-app="soda" />;
}

const TABS = [
  { id: 'welcome', label: 'Welcome', icon: 'home', enabled: true },
  { id: 'console', label: 'Console', icon: 'console', enabled: false },
  { id: 'flow', label: 'Flow', icon: 'flow', enabled: false },
  { id: 'apps', label: 'Apps', icon: 'apps', enabled: false },
  /* SODA is a separate tab that sits AFTER Apps; `sodaOpen` reveals it. */
  { id: 'soda', label: 'SODA', icon: 'soda', enabled: false, after: 'apps' },
];

/* Playback states the shell knows about; anything else is treated as idle so an
   unexpected value from the parent never leaves the supervisor blank. */
const PLAYBACK_DEFAULTS = { status: 'idle', progress: 0, activeStageId: null, iteration: 0, completedStageIds: [] };
const RUNNING_STATES = new Set(['running', 'paused']);
const COMPLETE_STATES = new Set(['completed', 'done']);

/* Playback progress is a percentage; the visual rail consumes a fraction. */
function fractionOf(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 100));
}

/* The status field is normalised so 'done' (as emitted by playback.js) also reads as complete. */
function playbackOf(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const status = COMPLETE_STATES.has(raw.status) ? 'completed'
    : typeof raw.status === 'string' ? raw.status : PLAYBACK_DEFAULTS.status;
  const progress = fractionOf(raw.progress);
  const iteration = Number.isFinite(raw.iteration) ? Math.max(0, raw.iteration) : 0;
  const completed = Array.isArray(raw.completedStageIds) ? raw.completedStageIds.filter(id => typeof id === 'string') : [];
  return {
    status,
    progress,
    activeStageId: typeof raw.activeStageId === 'string' ? raw.activeStageId : null,
    iteration,
    completedStageIds: completed,
  };
}

function stageOf(id) {
  return id ? STAGES.find(stage => stage.id === id) || null : null;
}

/* One-line description of what the workflow is doing right now, used by the task row. */
function progressLabel(playback, activeStage) {
  if (playback.status === 'completed') return 'Completed';
  if (!RUNNING_STATES.has(playback.status)) return 'Not started';
  if (activeStage) return `Running · ${activeStage.ordinal} ${activeStage.phase}`;
  if (playback.iteration > 1) return `Running · iteration ${playback.iteration}`;
  return 'Running';
}

/* Human-readable tail for the task meta line: iteration and percentage once running. */
function progressMeta(playback) {
  if (playback.status === 'completed') return 'All stages complete';
  if (!RUNNING_STATES.has(playback.status)) return '';
  const parts = [];
  if (playback.iteration > 1) parts.push(`iteration ${playback.iteration}`);
  if (playback.progress > 0) parts.push(`${Math.round(playback.progress * 100)}%`);
  return parts.join(' · ');
}

/* Stage heading shown above supervisor output: "05 · OPTIMISE — Optimise the steel tonnage". */
function headingFor(message) {
  const stage = stageOf(message.stageId);
  if (!stage) return { kicker: '', title: message.title || 'Project Router' };
  return { kicker: `${stage.ordinal} · ${stage.phase}${message.iteration ? ` · Pass ${message.iteration}` : ''}`,
    title: message.title?.replace(/^\d+\s*·\s*/, '') || stage.title };
}

/* Supervisor output arrives as short, already-complete bursts: the bubble pops in and the
   text is rendered whole, so there is no typewriter and no cursor. */
function SupervisorMessage({ message, onOpenDeliverables }) {
  const heading = headingFor(message);
  const attachment = typeof message.attachment === 'string' ? { name: message.attachment } : message.attachment;
  return <li className="we-msg we-msg--stream we-msg--burst" data-message-id={message.id}
    data-complete={message.complete ? 'true' : 'false'} data-iteration={message.iteration || 0}>
    <div className="we-msg-head">
      <span className="we-msg-kicker">{heading.kicker}</span>

      <span className="we-msg-mark" aria-hidden="true"><Check size={12} /></span>
    </div>
    <p className="we-msg-text">{message.text}</p>
    {attachment?.name && <button type="button" className="we-msg-file we-stream-attachment" onClick={() => onOpenDeliverables?.()}
      aria-label={`Open ${attachment.name}`}>
      <FileText size={12} aria-hidden="true" /><span>{attachment.name}</span>
    </button>}
    <span className="we-sr-only">{message.complete ? 'Message complete.' : 'Message still arriving.'}</span>
  </li>;
}

export function WorkspaceShell({
  activeTab = 'welcome', onTab, supOpen = true, onToggleSupervisor, children, deliverablesReady = false,
  railOpen = true, onToggleRail, sidebarVisible,
  project = null, tasks = [], onSelectStage, opening = false, transition = 'idle',
  projectOpen = false, onToggleProject,
  railMode = 'project', onRailMode,
  playback = PLAYBACK_DEFAULTS, messages = [], resetToken = 0,
  /* Three-stage homepage walkthrough. */
  demoStage = 1, maxUnlockedStage = 1, onSelectDemoStage, sodaOpen = false, onOpenDeliverables,
}) {
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState([]);
  /* Follow new output until the reader deliberately scrolls upward. */
  const [pinned, setPinned] = useState(true);
  const tabList = useRef(null);
  const body = useRef(null);
  const lastSent = useRef(0);
  const replay = useRef(resetToken);

  const state = playbackOf(playback);
  const running = RUNNING_STATES.has(state.status);
  const completed = state.status === 'completed';
  const activeStage = stageOf(state.activeStageId);
  const projectId = project?.id || null;

  /* The parent reports actual sidebar visibility, including the mobile drawer. */
  const railVisible = typeof sidebarVisible === 'boolean' ? sidebarVisible : railOpen;
  const unlockedStage = Number.isFinite(Number(maxUnlockedStage))
    ? Math.min(DEMO_STAGES.length, Math.max(1, Math.floor(Number(maxUnlockedStage)))) : 1;
  const availableStages = DEMO_STAGES.slice(0, unlockedStage);
  const stageNumber = Number.isFinite(Number(demoStage))
    ? Math.min(unlockedStage, Math.max(1, Math.round(Number(demoStage)))) : 1;

  function pickDemoStage(n) {
    if (!availableStages.some(stage => stage.n === n)) return;
    onSelectDemoStage?.(n);
  }
  function onStageKeyDown(event) {
    const current = Number(event.target.closest('[data-demo-stage-target]')?.dataset.demoStageTarget) || stageNumber;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(unlockedStage, current + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(1, current - 1);
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = unlockedStage;
    if (next === null) return;
    event.preventDefault();
    if (next === current) return;
    event.currentTarget.querySelector(`[data-demo-stage-target="${next}"]`)?.focus({ preventScroll: true });
    pickDemoStage(next);
  }

  /* The parent owns the sidebar mode; New chat in the sidebar only asks for the
     chat view without leaving the project rail's fold behaviour to local state. */
  function pickRailMode(mode) {
    onRailMode?.(mode);
  }

  /* Keep the selected tab inside the visible strip without scrolling the page. */
  useEffect(() => {
    const list = tabList.current, active = list?.querySelector('[aria-selected="true"]');
    if (!active) return;
    const a = active.getBoundingClientRect(), b = list.getBoundingClientRect();
    if (a.right > b.right) list.scrollLeft += a.right - b.right;
    if (a.left < b.left) list.scrollLeft -= b.left - a.left;
  }, [activeTab, projectId, railVisible, supOpen, state.status, sodaOpen]);

  /* Reset the local conversation, draft and scroll pinning whenever the parent starts a new
     run. There are no folder expansions to reset: project folders are inert. */
  useEffect(() => {
    if (replay.current === resetToken) return;
    replay.current = resetToken;
    setDraft('');
    setSent([]);
    setPinned(true);
    lastSent.current = 0;
    if (body.current) body.current.scrollTop = 0;
  }, [resetToken]);

  /* Follow new output only while the reader is parked near the bottom, so scrolling up
     to read earlier lines is never yanked back by an arriving message. */
  useLayoutEffect(() => {
    const node = body.current;
    if (!node || !pinned) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, sent, pinned, supOpen]);

  function onBodyScroll() {
    const node = body.current;
    if (!node || !node.clientHeight) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setPinned(nearBottom);
  }

  /* Scroll to bottom on demand after the reader has been reading upwards. */
  function followLatest() {
    const node = body.current;
    setPinned(true);
    if (node) node.scrollTop = node.scrollHeight;
  }

  function submit(event) {
    if (event) event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    lastSent.current += 1;
    setSent(list => [...list, { id: `local-${lastSent.current}`, text }]);
    setDraft('');
    setPinned(true);
  }

  const stream = Array.isArray(messages) ? messages.filter(Boolean) : [];
  /* A completed final stage turns the deliverables folder into a finished output with a real
     file the reader can hand to the viewer. */
  const outputDone = completed;

  /* Files start as the project skeleton and stay inert; only stages playback has finished are
     appended, in stage order, so the list grows downwards as the run advances. */
  const completedFolders = STAGES
    .filter(stage => state.completedStageIds.includes(stage.id))
    .map(stage => STAGE_COMPLETION[stage.id]);
  const visibleFiles = project ? ['project information', ...completedFolders] : [];
  const hasOutput = stream.length > 0 || sent.length > 0;
  const tabs = TABS.filter(tab => tab.id !== 'soda' || sodaOpen);

  return (
    <div className="we-demo">
    <div className="we-shell" data-source-revision="three-stage-demo" data-tab={activeTab} data-sup={supOpen ? 'on' : 'off'}
      data-rail={railVisible ? 'on' : 'off'} data-rail-mode={railMode} data-demo-stage={stageNumber}
      data-soda={sodaOpen ? 'open' : 'closed'}
      data-project={project ? 'open' : 'closed'} data-transition={transition} data-project-drawer={projectOpen ? 'open' : 'closed'}
      data-playback={state.status} data-run={state.status}
      aria-busy={opening} onKeyDown={event => { if (event.key === 'Escape' && projectOpen) onToggleProject?.(); }}>
      {projectOpen && <button type="button" className="we-rail-shade" aria-label="Close project panel" onClick={onToggleProject} />}
      <aside className="we-rail" aria-label={railMode === 'chat' ? 'Chats' : 'Project'}>
        <div className="we-rail-top">
          <div className="we-switch" role="tablist" aria-label="Sidebar view">
            <button type="button" role="tab" aria-selected={railMode === 'chat'}
              className={railMode === 'chat' ? 'is-on' : ''}
              onClick={() => pickRailMode('chat')}>
              <Icon name="chat" size={14} /> Chat
            </button>
            <button type="button" role="tab" aria-selected={railMode === 'project'}
              className={railMode === 'project' ? 'is-on' : ''}
              onClick={() => pickRailMode('project')}>
              <Icon name="folder" size={14} /> Project
            </button>
          </div>
        </div>

        {railMode === 'project' ? <>
          <div className="we-project">
            <span className="we-project-mark" aria-hidden="true"><Icon name="project" size={16} /></span>
            <span className="we-project-copy">
              <span className="we-project-name">{project?.name || 'No Project'}</span>
              <span className="we-project-meta">{project ? `${TASKS.length} task · ${STAGES.length} stages` : 'No task yet'}</span>
            </span>
          </div>

          <div className="we-sections">
            <p className="we-sec-head"><span>Task</span><span className="we-count">{project ? TASKS.length : 0}</span></p>
            {project && <ul className="we-todo-list we-task-list" aria-label="Project task">
              {tasks.map((task, index) => {
                const taskPlayback = task.playback ? playbackOf(task.playback) : state;
                const taskRunning = RUNNING_STATES.has(taskPlayback.status);
                const taskDone = completed || task.done === true || taskPlayback.status === 'completed';
                /* The task is the workflow: it highlights while that workflow is open or running. */
                const selected = taskDone || (projectId !== null && (railMode === 'project' || RUNNING_STATES.has(state.status)));
                /* Without a per-task playback, the workflow's active stage is this task's stage. */
                const label = progressLabel(taskPlayback, taskRunning ? activeStage : null);
                const meta = progressMeta(taskPlayback);
                return <li key={task.id}
                  className={`we-todo we-task${taskDone ? ' is-done' : ''}${taskRunning ? ' is-running' : ''}${selected ? ' is-selected' : ''}`}
                  data-task-state={taskDone ? 'done' : taskRunning ? 'running' : 'idle'}
                  data-task-id={task.id}
                  style={{ '--we-order': index, '--we-progress': taskDone ? 1 : taskRunning ? taskPlayback.progress : 0 }}>
                  <span className="we-task-mark" aria-hidden="true">
                    {taskDone ? <Check size={12} />
                      : taskRunning ? <LoaderCircle size={12} className="we-spinner" />
                        : <span className="we-task-dot" />}
                  </span>
                  <button type="button" disabled={opening} onClick={() => onSelectStage?.(running ? state.activeStageId || task.stage : taskDone ? STAGES.at(-1).id : task.stage)} title={task.title}>
                    <span>{task.title}</span>
                    <small className="we-task-meta">
                      <span className="we-task-state">{label}</span>
                      {taskRunning && <span className="we-task-progress" aria-hidden="true">
                        {taskPlayback.iteration > 1 ? `it ${taskPlayback.iteration} · ` : ''}{Math.round(taskPlayback.progress * 100)}%
                      </span>}
                      {!taskRunning && meta ? <span>{meta}</span> : null}
                    </small>
                    {taskRunning && <span className="we-task-bar" aria-hidden="true"><span style={{ width: `${Math.round(taskPlayback.progress * 100)}%` }} /></span>}
                  </button>
                </li>;
              })}
            </ul>}
            <p className="we-sec-head"><span>Files</span><span className="we-count">{visibleFiles.length + (outputDone ? 1 : 0)}</span></p>
            {project && <ul className="we-project-files we-files" aria-label="Project files" data-files={visibleFiles.length}>
              {visibleFiles.map(name => {
                const doneFolder = completedFolders.includes(name);
                return <li key={name} data-file={name} data-file-state={doneFolder ? 'complete' : 'initial'}>
                  <span className="we-file-row we-file-row--static">
                    <Folder size={14} /><span className="we-file-folder-label">{name}</span>
                  </span>
                </li>;
              })}
              {outputDone && <li data-file={DELIVERABLE_FILE}><button type="button" className="we-file-output"
                onClick={() => onOpenDeliverables?.()} aria-label={`Open ${DELIVERABLE_FILE}`}>
                <FileText size={12} /><span>{DELIVERABLE_FILE}</span>
              </button></li>}
            </ul>}
          </div>
        </> : <>
          <button type="button" className="we-new-chat" onClick={() => pickRailMode('chat')}>
            <Icon name="plus" size={14} /> New chat
          </button>
          <div className="we-chat-list" />
        </>}

        <div className="we-user" role="group" aria-label="Signed in as SIDA User">
          <span className="we-user-avatar" aria-hidden="true">SU</span>
          <span className="we-user-copy">
            <span className="we-user-name">SIDA User</span>
            <span className="we-user-meta">Personal workspace</span>
          </span>
          <span className="we-user-dot" aria-hidden="true" />
        </div>
      </aside>

      <main className="we-main">
        <div className="we-tabs">

          <div className="we-tab-list" ref={tabList} role="tablist" aria-label="Workspace view">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" id={`we-tab-${tab.id}`}
                className={`we-tab${tab.id === activeTab ? ' is-on' : ''}`}
                data-tab={tab.id}
                aria-selected={tab.id === activeTab}
                aria-disabled={tab.enabled || (tab.id === 'flow' && project) || (tab.id === 'apps' && deliverablesReady) || (tab.id === 'soda' && sodaOpen) ? undefined : 'true'}
                disabled={opening}
                tabIndex={tab.id === activeTab ? 0 : -1}
                onClick={() => (tab.enabled || (tab.id === 'flow' && project) || (tab.id === 'apps' && deliverablesReady) || (tab.id === 'soda' && sodaOpen)) && onTab?.(tab.id)}>
                <span className="we-tab-icon" data-icon={tab.icon}>
                  {tab.icon === 'soda' ? <SodaIcon size={14} /> : <Icon name={tab.icon} size={14} />}
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <button type="button" className={`we-rail-toggle${railVisible ? ' is-on' : ''}`}
            aria-label={railVisible ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-pressed={railVisible} onClick={() => onToggleRail && onToggleRail()}>
            <PanelToggleIcon side="left" />
            <span className="we-rail-label">Sidebar</span>
          </button>

          <button type="button" className={`we-sup-toggle${supOpen ? ' is-on' : ''}`}
            aria-label="Router" aria-pressed={supOpen} onClick={() => onToggleSupervisor && onToggleSupervisor()}>
            <PanelToggleIcon side="right" /><span className="we-sup-label">Router</span>
          </button>
        </div>
        <div className="we-stage-area">{children}</div>
      </main>

      <aside className="we-sup" aria-label="Project Router" data-playback={state.status}>
        <header className="we-sup-head">
          <h2>Project Router</h2>
          <p className="we-sup-meta">{project ? `${project.name} · ${completed ? 'Completed' : running ? 'Running' : `${STAGES.length} stages prepared`}` : 'No project open'}</p>
          {RUNNING_STATES.has(state.status) && <p className="we-sup-status" role="status">
            <LoaderCircle size={11} className="we-spinner" aria-hidden="true" />
            <span>{progressLabel(state, activeStage)}</span>
            <span className="we-sup-status-bar" aria-hidden="true"><span style={{ width: `${Math.round(state.progress * 100)}%` }} /></span>
          </p>}
        </header>

        <div className="we-sup-body" ref={body} onScroll={onBodyScroll} data-pinned={pinned ? 'true' : 'false'}>
          {hasOutput ? (
            <ul className="we-thread" aria-live="polite" aria-relevant="additions text">
              {stream.map(message => <SupervisorMessage key={message.id} message={message} onOpenDeliverables={onOpenDeliverables} />)}
              {sent.map(item => <li key={item.id} className="we-msg we-msg--local">{item.text}</li>)}
            </ul>
          ) : running ? (
            <p className="we-sup-empty" data-empty="running">
              <LoaderCircle size={13} className="we-spinner" aria-hidden="true" />
              {activeStage ? `${activeStage.ordinal} ${activeStage.phase} is running…` : 'Starting the workflow…'}
            </p>
          ) : null}
        </div>

        {hasOutput && !pinned && <button type="button" className="we-follow" onClick={followLatest}>
          <ChevronDown size={13} aria-hidden="true" /> Jump to latest
        </button>}

        <form className="we-composer" onSubmit={submit}>
          <div className="we-composer-field">
            <textarea rows={1} value={draft} placeholder="Say something to the Router…"
              aria-label="Message the Router"
              onInput={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) submit(event);
              }} />
            <button type="submit" className="we-send" aria-label="Send message" disabled={!draft.trim()}>
              <Icon name="send" size={14} />
            </button>
          </div>
          <div className="we-composer-foot">
            <button type="button" className="we-chip" aria-label="Add context"><Icon name="plus" size={12} /> Add context</button>
            <span className="we-chip we-chip--static">Default · off</span>
          </div>
        </form>
      </aside>
    </div>

      {/* Navigation is a sibling below the visual demo window, never a row inside it. */}
      <nav className="we-demo-nav" aria-label="Demo stage" onKeyDown={onStageKeyDown}>
        {availableStages.map(item => {
          const on = item.n === stageNumber;
          return <button key={item.n} type="button"
            className={`we-dot${on ? ' is-on' : ''}`}
            data-demo-stage-button={item.n} data-demo-stage-target={item.n}
            aria-label={item.label}
            aria-current={on ? 'step' : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => pickDemoStage(item.n)} />;
        })}
      </nav>
    </div>
  );
}
