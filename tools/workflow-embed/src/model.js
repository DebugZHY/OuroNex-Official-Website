export const STATUS = {
  ready: 'Ready',
  done: 'Done',
  running: 'Running',
  decision: 'Needs decision',
  idle: 'Not started',
};

export const DEMO_PROJECT = { id: 'sida-project', name: 'SIDA Project', root: 'SIDA Project' };

export const STAGES = [
  { id: '01-brief', title: 'Brief and basis of design', app: 'docx', status: 'ready',
    objective: 'Lock the design basis: codes, loadings and grid.', deps: 0, files: ['brief.md'] },
  { id: '02-model', title: 'Structural model and load take-down', app: 'SODA', status: 'idle',
    objective: 'Build the framing model and carry loads down.', deps: 1, files: ['load-takedown.csv', 'model-notes.md'] },
  { id: '03-analysis', title: 'Global analysis and drift check', app: 'SODA', status: 'idle',
    objective: 'Check drift, torsion and period against code.', deps: 1, files: ['drift-check.csv', 'period.txt'] },
  { id: '04-sizing', title: 'Member sizing and utilisation', app: 'SODA', status: 'idle',
    objective: 'Size members to keep utilisation under 0.90.', deps: 1, files: ['sizing-set.md', 'utilisation.csv'] },
  { id: '05-review', title: 'Independent design review', app: 'PDF', status: 'idle',
    objective: 'Second-engineer check of the sizing set.', deps: 1, files: ['review-note.md'] },
  { id: '06-approval', title: 'Issue for client approval', app: 'PDF', status: 'idle',
    objective: 'Package the set and record client sign-off.', deps: 1, files: ['issue-sheet.md'] },
  { id: '07-tender', title: 'Tender drawing package', app: 'CAD', status: 'idle',
    objective: 'Prepare tender drawings and the bill of quantities.', deps: 1, files: ['tender-list.md'] },
  { id: '08-report', title: 'Calculation report', app: 'docx', status: 'idle',
    objective: 'Write the calculation report and its checks.', deps: 1, files: ['report-outline.md'] },
  { id: '09-handover', title: 'Deliverable handover', app: '', status: 'idle',
    objective: 'Archive the issued set, model and report.', deps: 2, files: ['handover-checklist.md'] },
];

export const LINKS = [
  ['01-brief', '02-model'], ['02-model', '03-analysis'], ['03-analysis', '04-sizing'],
  ['04-sizing', '05-review'], ['05-review', '06-approval'],
  ['06-approval', '07-tender'], ['06-approval', '08-report'],
  ['07-tender', '09-handover'], ['08-report', '09-handover'],
];

export const TASKS = [
  { id: 'wind', title: 'Confirm wind load parameters', stage: '01-brief' },
  { id: 'columns', title: 'Sweep column sections against utilisation', stage: '04-sizing' },
  { id: 'transfer', title: 'Review transfer girder demand at level 6', stage: '05-review' },
  { id: 'drift', title: 'Confirm the drift limit against the code', stage: '03-analysis' },
  { id: 'report', title: 'Prepare the calculation report', stage: '08-report' },
  { id: 'drawings', title: 'Issue the approved tender drawing set', stage: '07-tender' },
];

export const PROJECT_FILES = ['stages', 'calculations', 'deliverables', 'drawings', 'README.md'];
export const initialStatuses = () => Object.fromEntries(STAGES.map(stage => [stage.id, stage.status]));
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 142;

export function sizeFor(width) {
  return width < 700 ? { width: 202, height: 132 } : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

export function positionsFor(width) {
  const { width: w, height: h } = sizeFor(width);
  if (width < 480) return STAGES.map((_, index) => ({ x: 0, y: index * (h + 24) }));
  return STAGES.map((_, index) => {
    const row = Math.floor(index / 3);
    const column = row % 2 ? 2 - index % 3 : index % 3;
    return { x: column * (w + 34), y: row * (h + 44) };
  });
}

export function handlesFor(from, to) {
  if (Math.abs(from.y - to.y) > 50) return from.y < to.y ? ['s-bottom', 't-top'] : ['s-top', 't-bottom'];
  return from.x < to.x ? ['s-right', 't-left'] : ['s-left', 't-right'];
}

