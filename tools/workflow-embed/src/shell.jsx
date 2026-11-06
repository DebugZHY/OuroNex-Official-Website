import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Boxes, ChevronDown, ChevronRight, FileText, Folder, FolderTree, House, LayoutDashboard, LayoutGrid, MessageSquare, PanelLeft, PanelRight, Plus, Waypoints } from 'lucide-react';
import './shell.css';
import { PROJECT_FILES, STAGES } from './model.js';

const ICONS = {
  chat: MessageSquare, folder: FolderTree, project: Boxes, home: House,
  console: LayoutDashboard, flow: Waypoints, apps: LayoutGrid,
  send: ArrowUp, plus: Plus, panel: PanelRight,
};
function Icon({ name, size = 15 }) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" size={size} />;
}

const TABS = [
  { id: 'welcome', label: 'Welcome', icon: 'home', enabled: true },
  { id: 'console', label: 'Console', icon: 'console', enabled: false },
  { id: 'flow', label: 'Flow', icon: 'flow', enabled: false },
  { id: 'apps', label: 'Apps', icon: 'apps', enabled: false },
];

export function WorkspaceShell({
  activeTab = 'welcome', onTab, supOpen = true, onToggleSupervisor, children,
  project = null, tasks = [], selectedId, onSelectStage, onToggleTask, opening = false, transition = 'idle',
  projectOpen = false, onToggleProject,
}) {
  const [railMode, setRailMode] = useState('project');
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState([]);
  const [folder, setFolder] = useState(null);
  const tabList = useRef(null);
  const remaining = tasks.filter(task => !task.done).length;
  useEffect(() => { if (project) setRailMode('project'); }, [project?.id]);
  useEffect(() => {
    const list = tabList.current, active = list?.querySelector('[aria-selected="true"]');
    if (!active) return;
    const a = active.getBoundingClientRect(), b = list.getBoundingClientRect();
    if (a.right > b.right) list.scrollLeft += a.right - b.right;
    if (a.left < b.left) list.scrollLeft -= b.left - a.left;
  }, [activeTab, project]);

  function submit(event) {
    if (event) event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSent((list) => [...list, text]);
    setDraft('');
  }

  return (
    <div className="we-shell" data-source-revision="project-demo-2" data-tab={activeTab} data-sup={supOpen ? 'on' : 'off'}
      data-project={project ? 'open' : 'closed'} data-transition={transition} data-project-drawer={projectOpen ? 'open' : 'closed'}
      aria-busy={opening} onKeyDown={event => { if (event.key === 'Escape' && projectOpen) onToggleProject?.(); }}>
      {projectOpen && <button type="button" className="we-rail-shade" aria-label="Close project panel" onClick={onToggleProject} />}
      <aside className="we-rail" aria-label={railMode === 'chat' ? 'Chats' : 'Project'}>
        <div className="we-rail-top">
          <div className="we-switch" role="tablist" aria-label="Sidebar view">
            <button type="button" role="tab" aria-selected={railMode === 'chat'}
              className={railMode === 'chat' ? 'is-on' : ''}
              onClick={() => setRailMode('chat')}>
              <Icon name="chat" size={14} /> Chat
            </button>
            <button type="button" role="tab" aria-selected={railMode === 'project'}
              className={railMode === 'project' ? 'is-on' : ''}
              onClick={() => setRailMode('project')}>
              <Icon name="folder" size={14} /> Project
            </button>
          </div>
        </div>

        {railMode === 'project' ? <>
          <div className="we-project">
            <span className="we-project-mark" aria-hidden="true"><Icon name="project" size={16} /></span>
            <span className="we-project-copy">
              <span className="we-project-name">{project?.name || 'No Project'}</span>
              <span className="we-project-meta">{project ? `${remaining} to-dos · ${STAGES.length} stages` : '0 to-dos'}</span>
            </span>
          </div>

          <div className="we-sections">
            <p className="we-sec-head"><span>To-do list</span><span className="we-count">{project ? remaining : 0}</span></p>
            {project && <ul className="we-todo-list" aria-label="Project to-do list">
              {tasks.map((task, index) => <li key={task.id} className={`we-todo${task.done ? ' is-done' : ''}${task.stage === selectedId ? ' is-selected' : ''}`} style={{ '--we-order': index }}>
                <input type="checkbox" disabled={opening} checked={task.done} aria-label={`Complete: ${task.title}`} onChange={() => onToggleTask?.(task.id)} />
                <button type="button" disabled={opening} onClick={() => onSelectStage?.(task.stage)} title={task.title}>
                  <span>{task.title}</span><small>{task.stage} · {task.done ? 'Done' : 'Open'}</small>
                </button>
              </li>)}
            </ul>}
            <p className="we-sec-head"><span>Files</span><span className="we-count">{project ? PROJECT_FILES.length : 0}</span></p>
            {project && <ul className="we-project-files" aria-label="Project files">
              {PROJECT_FILES.map(name => <li key={name}>
                {name.endsWith('.md') ? <span className="we-file-row"><FileText size={14} />{name}</span> : <>
                  <button type="button" className="we-file-row" disabled={opening} aria-expanded={folder === name} onClick={() => setFolder(current => current === name ? null : name)}>
                    {folder === name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={14} />{name}
                  </button>
                  {folder === name && <ul className="we-file-children">
                    {STAGES.filter(stage => name === 'stages' || (name === 'calculations' ? ['02-model','03-analysis','04-sizing','08-report'].includes(stage.id) : name === 'drawings' ? stage.id === '07-tender' : ['06-approval','09-handover'].includes(stage.id))).map(stage =>
                      <li key={stage.id}><button type="button" title={`Show ${stage.title} in workflow`} disabled={opening} onClick={() => onSelectStage?.(stage.id)}><FileText size={12} /><span>{name === 'stages' ? stage.id : stage.files[0]}</span></button></li>)}
                  </ul>}
                </>}
              </li>)}
            </ul>}
          </div>
        </> : <>
          <button type="button" className="we-new-chat">
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
          {project && <button type="button" className="we-project-toggle" aria-label="Project to-do list" aria-pressed={projectOpen} onClick={onToggleProject}><PanelLeft size={15} /></button>}
          <div className="we-tab-list" ref={tabList} role="tablist" aria-label="Workspace view">
            {TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" id={`we-tab-${tab.id}`}
                className={`we-tab${tab.id === activeTab ? ' is-on' : ''}`}
                data-tab={tab.id}
                aria-selected={tab.id === activeTab}
                aria-disabled={tab.enabled || (tab.id === 'flow' && project) ? undefined : 'true'}
                disabled={opening}
                tabIndex={tab.id === activeTab ? 0 : -1}
                onClick={() => (tab.enabled || (tab.id === 'flow' && project)) && onTab?.(tab.id)}>
                <span className="we-tab-icon" data-icon={tab.icon}><Icon name={tab.icon} size={14} /></span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <button type="button" className={`we-sup-toggle${supOpen ? ' is-on' : ''}`}
            aria-label="Supervisor" aria-pressed={supOpen} onClick={() => onToggleSupervisor && onToggleSupervisor()}>
            <Icon name="panel" size={14} /><span className="we-sup-label">Supervisor</span>
          </button>
        </div>
        <div className="we-stage-area">{children}</div>
      </main>

      <aside className="we-sup" aria-label="Project supervisor">
        <header className="we-sup-head">
          <h2>Project Supervisor</h2>
          <p className="we-sup-meta">{project ? `${project.name} · ${STAGES.length} stages prepared` : 'No project open'}</p>
        </header>

        <div className="we-sup-body">
          {sent.length === 0 ? null : (
            <ul className="we-thread">
              {sent.map((text, index) => (
                <li key={index} className="we-msg">{text}</li>
              ))}
            </ul>
          )}
        </div>

        <form className="we-composer" onSubmit={submit}>
          <div className="we-composer-field">
            <textarea rows={1} value={draft} placeholder="Say something to the Supervisor…"
              aria-label="Message the supervisor"
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
  );
}
