export const STATUS = {
  idle: 'Not started',
  ready: 'Ready',
  running: 'Running',
  done: 'Done',
  decision: 'Needs decision',
};

/* One worked example: a steel frame sized by iteration until the tonnage stops falling. */
export const DEMO_PROJECT = { id: 'steel-frame-optimisation', name: 'Steel Frame Design Optimization', root: 'Steel Frame Design Optimization' };

export const STAGES = [
  { id: '01-references', ordinal: '01', phase: 'INPUT', title: 'Read the design references', app: 'PDF', status: 'idle',
    objective: 'Read the brief, the grid drawings and the imposed load schedule.', deps: 0, files: ['design-brief.md'] },
  { id: '02-codes', ordinal: '02', phase: 'CODES', title: 'Query the code requirements', app: 'Codes', status: 'idle',
    objective: 'Pull the steel code limits, load factors and drift allowance.', deps: 1, files: ['code-clauses.md'] },
  { id: '03-model', ordinal: '03', phase: 'MODEL', title: 'Build the frame model', app: 'SODA', status: 'idle',
    objective: 'Set the grid, member groups, releases and load cases.', deps: 1, files: ['frame-model.md'] },
  { id: '04-analysis', ordinal: '04', phase: 'ANALYSIS', title: 'Run the global analysis', app: 'SODA', status: 'idle',
    objective: 'Check forces, drift and stability against the code limits.', deps: 1, files: ['analysis-run.csv'] },
  { id: '05-optimise', ordinal: '05', phase: 'OPTIMISE', title: 'Optimise the steel tonnage', app: 'SODA', status: 'idle',
    objective: 'Resize members to the lightest set that still passes every check.', deps: 1, files: ['optimisation-log.csv'] },
  { id: '06-handover', ordinal: '06', phase: 'OUTPUT', title: 'Hand over the optimised model', app: '', status: 'idle',
    objective: 'Issue the converged section set as the optimised structural model.', deps: 1, files: ['optimised-model.md'] },
];

/* `kind: 'loop'` edges are drawn as feedback arcs, not as forward dependencies. */
export const LINKS = [
  { from: '01-references', to: '02-codes', kind: 'flow' },
  { from: '02-codes', to: '03-model', kind: 'flow' },
  { from: '03-model', to: '04-analysis', kind: 'flow' },
  { from: '04-analysis', to: '05-optimise', kind: 'flow' },
  { from: '05-optimise', to: '06-handover', kind: 'flow' },
  { from: '05-optimise', to: '04-analysis', kind: 'loop' },
];

/* One task per project: the task is the whole workflow, and it ends with the optimised model. */
export const TASKS = [
  { id: 'steel-frame-optimisation', title: 'Complete the steel frame optimisation', stage: '01-references',
    meta: '6 stages · ends with the optimised model' },
];

export const PROJECT_FILES = ['stages', 'calculations', 'deliverables', 'README.md'];

export const STAGE_FOLDERS = {
  stages: STAGES.map(stage => stage.id),
  calculations: ['03-model', '04-analysis', '05-optimise'],
  deliverables: ['06-handover'],
};

/* Name shown for the converged model that the completed workflow hands over. */
export const DELIVERABLE_NAME = 'Frame-model-v2.dat';

export const initialStatuses = () => Object.fromEntries(STAGES.map(stage => [stage.id, stage.status]));

/* ---------- tool and expert catalogue ---------- */

/* Icon slugs are the existing Professional Tools brand tiles; portraits are the nine expert
   portraits already published for the Multidisciplinary Experts panel. Both are loaded from
   the same asset folder, so nothing is duplicated for this canvas. */
export const APP_ICONS = {
  doc: { name: 'Doc', slug: 'doc' },
  spreadsheet: { name: 'Spreadsheet', slug: 'spreadsheet' },
  pdf: { name: 'PDF Editor', slug: 'pdf-editor' },
  cad: { name: 'CAD Editor', slug: 'cad-editor' },
  bim: { name: 'BIM Helper', slug: 'bim-helper' },
  soda: { name: 'SODA', slug: 'soda' },
  ccd: { name: 'CCD-HK', slug: 'ccd-hk' },
  scd: { name: 'SCD-HK', slug: 'scd-hk' },
  cop: { name: 'CoP Hub HK', slug: 'cop-hub-hk' },
  sitescope: { name: 'SiteScope', slug: 'sitescope' },
  fejoint: { name: 'FEJoint', slug: 'fejoint' },
  windcode: { name: 'WindCode Pro HK', slug: 'windcode-pro-hk' },
  calculator: { name: 'Calculator', slug: 'calculator' },
  slide: { name: 'Slide', slug: 'slide' },
};

export const EXPERTS = {
  'site-planning': 'Site & Planning Expert',
  compliance: 'Hong Kong Compliance Expert',
  analysis: 'Structural Analysis Expert',
  sections: 'Section Design Expert',
  wind: 'Wind Engineering Expert',
  connections: 'Steel Connections Expert',
  modelling: 'CAD & BIM Expert',
  documentation: 'Technical Documentation Expert',
  reporting: 'Engineering Reporting Expert',
};

/* Resolve local assets from the bundle, including when mounted on the homepage. */
const entryScript = typeof document === 'undefined' ? null : document.currentScript?.src;
export const ASSET_ROOT = entryScript ? new URL('../features/flow-assets/', entryScript).href.replace(/\/$/, '')
  : 'workflow-stages/features/flow-assets';
export const appIconPath = slug => `${ASSET_ROOT}/apps/${slug}.svg`;
export const expertPortraitPath = id => `${ASSET_ROOT}/experts/${id}.svg`;

/* Which expert runs each stage, and which local tools it works with. */
const RESOURCES = {
  '01-references': { expert: 'documentation', tools: ['pdf', 'doc', 'spreadsheet'] },
  '02-codes': { expert: 'compliance', tools: ['cop', 'pdf'] },
  '03-model': { expert: 'modelling', tools: ['soda', 'cad', 'bim'] },
  '04-analysis': { expert: 'analysis', tools: ['soda', 'spreadsheet', 'calculator'] },
  '05-optimise': { expert: 'sections', tools: ['soda', 'scd', 'spreadsheet'] },
  '06-handover': { expert: 'reporting', tools: ['soda', 'doc', 'pdf'] },
};

export function resourcesFor(stageId) {
  const entry = RESOURCES[stageId] || { expert: null, tools: [] };
  return {
    expert: entry.expert ? { id: entry.expert, name: EXPERTS[entry.expert], src: expertPortraitPath(entry.expert) } : null,
    tools: entry.tools.map(key => ({ key, ...APP_ICONS[key], src: appIconPath(APP_ICONS[key].slug) })),
  };
}

/* ---------- fixed graph geometry ---------- */

/* Node coordinates, node size and the two columns are absolute graph units. They never read the
   canvas, the container or the viewport width, so a resize can only change the camera, never the
   layout — and the Supervisor opening cannot reflow a card or reset the reader's view. */
export const NODE_WIDTH = 212;
export const NODE_HEIGHT = 172;
export const COLUMN_GAP = 52;
export const ROW_GAP = 46;

export const NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };

/* Fixed two-column snake, read left to right then back:
     01 → 02
          ↓
     04 ← 03
     ↓
     05 → 06
   The odd row is mirrored, so the forward path only ever steps sideways along a row or straight
   down at the column it just finished in — it never jumps columns while descending. The feedback
   arc (05 → 04) therefore stays a short hop up the same column. */
export function gridSlot(index) {
  const row = Math.floor(index / 2);
  const pair = index % 2;
  const column = row % 2 === 0 ? pair : 1 - pair;
  return { row, column };
}

export const positions = STAGES.map((_, index) => {
  const { row, column } = gridSlot(index);
  return { x: column * (NODE_WIDTH + COLUMN_GAP), y: row * (NODE_HEIGHT + ROW_GAP) };
});

/* Same name and contract as before; the width argument is accepted and ignored. */
export function sizeFor() {
  return { ...NODE_SIZE };
}

export function positionsFor() {
  return positions.map(position => ({ ...position }));
}

/* The loop arc needs clearance to the right of the first column; the fit keeps it in view. */
export const LOOP_ARC = 58;

export function handlesFor(from, to) {
  if (Math.abs(from.y - to.y) > 40) return from.y < to.y ? ['s-bottom', 't-top'] : ['s-top', 't-bottom'];
  return from.x < to.x ? ['s-right', 't-left'] : ['s-left', 't-right'];
}
