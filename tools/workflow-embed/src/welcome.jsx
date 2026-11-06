import { useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderPlus, MessageSquarePlus } from 'lucide-react';
import { BuilderRobot } from './builder-robot.jsx';
import './welcome.css';

/* Welcome keeps the brand, the three start actions and recent projects. */

const DOORS = [
  { id: 'new-project', label: 'New Project', hint: 'Create a workflow project in a folder you choose', icon: FolderPlus, primary: true },
  { id: 'open-folder', label: 'Open Folder', hint: 'Register a folder you already have, with no stage added', icon: FolderOpen },
  { id: 'new-chat', label: 'New Chat', hint: 'Ask the agent without opening a project', icon: MessageSquarePlus },
];

export function WelcomeHome({
  projects = [],
  onOpenProject,
  onNewProject,
  onPrepareProject,
  opening = false,
}) {
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? projects : projects.slice(0, 6);
  const timer = useRef(0);
  const prepared = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  function say(text) {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2400);
  }

  function prepareProject() {
    if (prepared.current || !onPrepareProject) return;
    prepared.current = true;
    onPrepareProject();
  }

  function startNewProject() {
    if (opening) return;
    prepareProject();
    if (onNewProject) {
      onNewProject();
      return;
    }
    say('New Project is available in the desktop app — this preview stays on the welcome screen.');
  }

  function openDoor(door) {
    if (door.primary) {
      startNewProject();
      return;
    }
    say(`${door.label} opens the desktop app — this preview stays on the welcome screen.`);
  }

  return <div className="we-welcome" data-welcome="true">
    <div className="we-welcome-inner">
      <header className="we-welcome-brand" data-welcome-brand="true">
        <BuilderRobot />
        <h1 data-welcome-title="true">Welcome to SIDA</h1>
      </header>

      <div className="we-welcome-actions" role="group" aria-label="Ways to start" data-welcome-actions="true">
        {DOORS.map((door) => <button key={door.id} type="button"
          className={`we-door${door.primary ? ' is-primary' : ''}`} data-welcome-action={door.id}
          disabled={door.primary && opening}
          aria-busy={door.primary && opening ? 'true' : undefined}
          onPointerEnter={door.primary ? prepareProject : undefined}
          onFocus={door.primary ? prepareProject : undefined}
          onClick={() => openDoor(door)}>
          <span className="we-door-icon" aria-hidden="true"><door.icon size={28} /></span>
          <span className="we-door-copy">
            <span className="we-door-title">{door.label}</span>
            <span className="we-door-hint">{door.hint}</span>
          </span>
        </button>)}
      </div>

      <section className="we-welcome-recent" aria-labelledby="we-recent-title">
        <h2 id="we-recent-title" data-welcome-recent-title="true">Recent Projects</h2>
        {projects.length === 0
          ? <p className="we-recent-empty">No projects yet — New Project creates the first one.</p>
          : <ul className={`we-recent-list${showAll ? ' is-expanded' : ''}`}>
            {shown.map((project) => <li key={project.id} className="we-recent-row">
              <button type="button" className="we-recent-open"
                onClick={() => onOpenProject ? onOpenProject(project) : say(`${project.name} opens in the desktop app.`)}>
                <span>{project.name}</span>
              </button>
              <button type="button" className="we-recent-reveal" aria-label={`Show ${project.name} in its folder`} title="Show in folder"
                onClick={() => say('Show in folder is available in the desktop app.')}>
                <FolderOpen size={16} />
              </button>
            </li>)}
          </ul>}
        {projects.length > 6 && <button type="button" className="we-recent-more" aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show ${projects.length - 6} more`}</button>}
      </section>
    </div>

    <div className={`we-toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
