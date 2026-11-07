import { STAGES, initialStatuses } from './model.js';

/* Local demonstration script; the website does not run a structural solver. */
export const RUN_STEPS = [
  {
    id: 'references', stageId: '01-references', duration: 480, progress: 3, iteration: 0,
    title: '01 · Read the design references',
    reports: ['Design brief read.', 'Geometry and loads captured.'],
  },
  {
    id: 'codes', stageId: '02-codes', duration: 620, progress: 13, iteration: 0,
    title: '02 · Query the code requirements',
    reports: ['Steel design clauses found.', 'Limits and combinations set.'],
  },
  {
    id: 'model', stageId: '03-model', duration: 860, progress: 26, iteration: 0,
    title: '03 · Build the frame model',
    reports: ['Frame model assembled.', 'Sections and load cases assigned.'],
  },
  {
    id: 'analysis-1', stageId: '04-analysis', duration: 800, progress: 43, iteration: 1,
    title: '04 · Analyse the frame · Iteration 1',
    reports: ['Baseline analysis complete.', 'Lighter member candidates found.'],
  },
  {
    id: 'optimise-1', stageId: '05-optimise', duration: 560, progress: 58, iteration: 1,
    title: '05 · Optimise member sizes · Iteration 1',
    reports: ['Member sizes revised.', 'Returning to analysis for checks.'],
  },
  {
    id: 'analysis-2', stageId: '04-analysis', duration: 880, progress: 72, iteration: 2,
    title: '04 · Verify the revised model · Iteration 2',
    reports: ['Revised frame verified.', 'Strength and drift checks passed.'],
  },
  {
    id: 'optimise-2', stageId: '05-optimise', duration: 700, progress: 83, iteration: 2,
    title: '05 · Confirm convergence · Iteration 2',
    reports: ['Section search converged.', 'Final member sizes confirmed.'],
  },
  {
    id: 'handover', stageId: '06-handover', duration: 1100, progress: 94, iteration: 2,
    title: '06 · Deliver the optimised model',
    reports: ['Preparing the final model.', 'Deliverable packaged.'],
  },
];

export const RUN_DURATION = RUN_STEPS.reduce((total, step) => total + step.duration, 0);

export function idlePlayback() {
  return { status: 'idle', progress: 0, stepIndex: -1, activeStageId: null, activeEdgeId: null, iteration: 0,
    statuses: initialStatuses(), completedStageIds: [], messages: [] };
}

export function playbackAt(elapsed) {
  const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const statuses = initialStatuses();
  const messages = [];
  const completed = new Set();
  let start = 0;
  for (const [index, step] of RUN_STEPS.entries()) {
    const localTime = time - start;
    if (localTime < 0) break;
    const complete = localTime >= step.duration;
    step.reports.forEach((text, reportIndex) => {
      if (localTime >= reportIndex * Math.round(step.duration * 0.56)) {
        messages.push({ id: `${step.id}-${reportIndex}`, stageId: step.stageId, title: step.title,
          iteration: step.iteration, text, complete: true });
      }
    });
    statuses[step.stageId] = complete ? 'done' : 'running';
    if (complete) completed.add(step.stageId);
    if (!complete) {
      const previous = RUN_STEPS[index - 1];
      return { status: 'running', progress: step.progress, stepIndex: index,
        activeStageId: step.stageId,
        activeEdgeId: previous ? `${previous.stageId}--${step.stageId}` : null,
        iteration: step.iteration, statuses, completedStageIds: [...completed], messages };
    }
    start += step.duration;
  }
  messages.push({ id: 'deliverable', stageId: '06-handover', title: 'Task completed', iteration: 2,
    text: 'Your model is ready.', complete: true, attachment: { name: 'Frame-model-v2.dat' } });
  return { status: 'done', progress: 100, stepIndex: RUN_STEPS.length, activeStageId: null, activeEdgeId: null, iteration: 2,
    statuses: Object.fromEntries(STAGES.map(stage => [stage.id, 'done'])),
    completedStageIds: STAGES.map(stage => stage.id), messages };
}

/* A generation guard also rejects callbacks already queued when reset or destroy cancels a timer. */
export function createPlayback(onFrame, {
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, interval = 60,
} = {}) {
  let snapshot = idlePlayback(), timer = null, generation = 0, destroyed = false;
  const stop = () => { generation += 1; if (timer !== null) cancel(timer); timer = null; };
  const publish = next => { snapshot = next; onFrame(next); };
  return {
    start() {
      if (destroyed || snapshot.status !== 'idle') return false;
      const token = ++generation, started = now();
      const tick = () => {
        if (destroyed || token !== generation) return;
        timer = null;
        publish(playbackAt(now() - started));
        if (!destroyed && token === generation && snapshot.status === 'running') timer = schedule(tick, interval);
      };
      tick();
      return true;
    },
    reset() { if (destroyed) return; stop(); publish(idlePlayback()); },
    finish() { if (destroyed) return; stop(); publish(playbackAt(RUN_DURATION)); },
    getState: () => snapshot,
    destroy() { stop(); destroyed = true; },
  };
}
