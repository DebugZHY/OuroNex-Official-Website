/* App catalogue: names and icon slugs are taken from the existing Professional Tools panel. */
export const APPS = {
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
};

export const EXPERTS = {
  'site-planning': { name: 'Site & Planning Expert', portrait: 'flow-assets/experts/site-planning.svg' },
  compliance: { name: 'Hong Kong Compliance Expert', portrait: 'flow-assets/experts/compliance.svg' },
  analysis: { name: 'Structural Analysis Expert', portrait: 'flow-assets/experts/analysis.svg' },
  sections: { name: 'Section Design Expert', portrait: 'flow-assets/experts/sections.svg' },
  wind: { name: 'Wind Engineering Expert', portrait: 'flow-assets/experts/wind.svg' },
  connections: { name: 'Steel Connections Expert', portrait: 'flow-assets/experts/connections.svg' },
  modelling: { name: 'CAD & BIM Expert', portrait: 'flow-assets/experts/modelling.svg' },
  documentation: { name: 'Technical Documentation Expert', portrait: 'flow-assets/experts/documentation.svg' },
  reporting: { name: 'Engineering Reporting Expert', portrait: 'flow-assets/experts/reporting.svg' },
};

export const STATUS = {
  start: { key: 'start', label: 'Start' },
  running: { key: 'running', label: 'Running' },
  done: { key: 'done', label: 'Completed' },
};

const node = (id, ordinal, phase, title, summary, apps, expert, kind, output) => ({
  id, ordinal, phase, title, summary, apps, expert, kind: kind || 'task', output,
});

export const SERVICES = [
  {
    id: 'planning',
    label: 'Project Planning',
    scenario: 'Site survey, client brief and Hong Kong approval requirements.',
    deliverable: 'Reviewed feasibility brief, risk register and approval route.',
    nodes: [
      node('01-brief', '01', 'PROJECT BASIS', 'Brief & site evidence', 'Register the survey datum, site boundary, access constraints and client capacity requirements. Separate verified records from missing investigations before making feasibility assumptions.', ['sitescope', 'doc'], 'site-planning', 'task', 'Revision-controlled brief and evidence register.'),
      node('02-codes', '02', 'COMPLIANCE', 'Constraints & approvals', 'Cross-check applicable code editions and clauses in CoP Hub HK against the project scope. Record statutory submissions, responsible parties and matters requiring authority clarification.', ['cop', 'doc'], 'compliance', 'task', 'Cited constraints matrix and submission route.'),
      node('03-model', '03', 'FEASIBILITY', 'Structural scheme options', 'Compare load paths, preliminary spans, stability systems and foundation assumptions in SODA. Record load assumptions and unresolved geotechnical information alongside each option.', ['soda', 'spreadsheet'], 'analysis', 'task', 'Scheme comparison with analysis assumptions.'),
      node('04-reconcile', '04', 'RECONCILE', 'Risk & interface register', 'Reconcile structural options with site constraints and approval requirements. Assign an owner and next action to each unresolved interface; distinguish a design assumption from an accepted requirement.', ['spreadsheet', 'doc'], 'reporting', 'task', 'Owned risks, information gaps and decision log.'),
      node('05-review', '05', 'HUMAN REVIEW', 'Engineer feasibility review', 'The responsible engineer reviews the evidence, load-path logic and approval strategy. Unresolved safety-critical assumptions return for investigation before a preferred scheme is issued.', ['pdf', 'doc'], 'analysis', 'review', 'Reviewed scheme recommendation and recorded exceptions.'),
      node('06-output', '06', 'ISSUE', 'Feasibility & approval brief', 'Issue the reviewed brief with linked source revisions, scheme comparison, risks and the next-stage information requirements. Retain the reviewer and issue status in the project record.', ['doc', 'spreadsheet'], 'documentation', 'task', 'Versioned feasibility brief and approval roadmap.'),
    ],
    links: [['01-brief', '02-codes'], ['01-brief', '03-model'], ['02-codes', '03-model'], ['02-codes', '04-reconcile'], ['03-model', '04-reconcile'], ['04-reconcile', '05-review'], ['05-review', '06-output']],
  },
  {
    id: 'optimization',
    label: 'Design Optimization',
    scenario: 'A concrete frame, fixed loads and a bounded set of section options.',
    deliverable: 'Checked section schedule with traceable design comparisons.',
    nodes: [
      node('01-baseline', '01', 'BASELINE', 'Freeze the design basis', 'Reconcile CAD geometry with the analysis model. Freeze units, material grades, restraints, load combinations and ULS/SLS limits so every option is compared on the same basis.', ['cad', 'soda'], 'modelling', 'task', 'Checked baseline model and option bounds.'),
      node('03-envelopes', '02', 'GLOBAL ANALYSIS', 'Actions & stability', 'Establish governing load combinations, second-order response and serviceability envelopes in SODA. Check stability, deflections and sensitivity to the assumed restraints before ranking options.', ['soda', 'spreadsheet'], 'analysis', 'task', 'Governing action, drift and deflection envelopes.'),
      node('02-sections', '03', 'SECTION CHECK', 'Section capacity study', 'Use CCD-HK to assess the bounded section and reinforcement options. Record capacity and detailing constraints against the baseline actions; these results are screening checks until global stiffness is updated.', ['ccd', 'spreadsheet'], 'sections', 'task', 'Candidate section and reinforcement schedule.'),
      node('04-checks', '04', 'ITERATE & CHECK', 'Reanalyse shortlisted designs', 'Apply shortlisted sections to SODA and rerun the global analysis. Recheck concrete member capacity and serviceability with SCD-HK against the updated actions; repeat until section choices and demand agree.', ['soda', 'scd'], 'analysis', 'task', 'Consistent model/check set with material and utilisation comparisons.'),
      node('05-review', '05', 'HUMAN REVIEW', 'Engineer trade-off review', 'The engineer reviews strength, serviceability, robustness, reinforcement congestion and constructability. Record why the accepted option is preferable; a lower material quantity alone is not acceptance.', ['pdf', 'spreadsheet'], 'sections', 'review', 'Accepted option and signed comparison record.'),
      node('06-output', '06', 'ISSUE', 'Checked design schedule', 'Issue the selected sections, governing checks, model revision and calculation notes together. Preserve rejected-option reasons and unresolved coordination items for the next design stage.', ['spreadsheet', 'doc'], 'reporting', 'task', 'Reviewed section schedule and calculation package.'),
    ],
    links: [['01-baseline', '03-envelopes'], ['03-envelopes', '02-sections'], ['02-sections', '04-checks'], ['04-checks', '05-review'], ['05-review', '06-output'], ['04-checks', '02-sections', { feedback: true, label: 'Revise section set' }]],
  },
  {
    id: 'tendering',
    label: 'Tendering',
    scenario: 'A frozen drawing set, specifications and tender addenda.',
    deliverable: 'Reviewed quantities, scope qualifications and tender queries.',
    nodes: [
      node('01-frozen', '01', 'DOCUMENT CONTROL', 'Freeze the tender set', 'Register drawing and specification revisions, addenda and the measurement basis. Flag conflicting or superseded documents before quantities or scope statements are extracted.', ['cad', 'pdf'], 'documentation', 'task', 'Controlled tender document index.'),
      node('02-quantities', '02', 'MEASUREMENT', 'Traceable quantity take-off', 'Measure against the frozen drawings, recording source sheet, location, unit and measurement rule for each quantity. Mark assumptions, provisional quantities and duplicated elements for review.', ['cad', 'spreadsheet'], 'modelling', 'task', 'Quantity workbook with drawing references.'),
      node('03-compliance', '03', 'SCOPE', 'Scope & compliance matrix', 'Map specification obligations, interfaces and exclusions to tender clauses. Use the code library for engineering references; distinguish specified obligations from clarification questions.', ['doc', 'cop'], 'compliance', 'task', 'Clause-linked compliance and scope matrix.'),
      node('04-reconcile', '04', 'RECONCILE', 'Resolve gaps & qualifications', 'Reconcile measured items with scope coverage. Check units, missing work, double counting and addendum changes; keep unresolved quantities and commercial qualifications explicit.', ['spreadsheet', 'doc'], 'reporting', 'task', 'Reconciled schedule and clarification register.'),
      node('05-approval', '05', 'HUMAN REVIEW', 'Estimator & technical review', 'The estimator checks measurement and commercial qualifications with the engineering reviewer. Record accepted assumptions, outstanding queries and authorisation before issuing the package.', ['pdf', 'spreadsheet'], 'documentation', 'review', 'Reviewed tender basis and release decision.'),
      node('06-output', '06', 'ISSUE', 'Schedules & tender queries', 'Assemble the checked quantity schedule, compliance matrix, exclusions and query register. Link every issued document to the frozen tender revision and reviewer record.', ['spreadsheet', 'doc'], 'reporting', 'task', 'Versioned tender preparation package.'),
    ],
    links: [['01-frozen', '02-quantities'], ['01-frozen', '03-compliance'], ['02-quantities', '04-reconcile'], ['03-compliance', '04-reconcile'], ['04-reconcile', '05-approval'], ['05-approval', '06-output']],
  },
  {
    id: 'bim',
    label: 'BIM Modelling',
    scenario: 'An approved structural model and agreed BIM exchange requirements.',
    deliverable: 'Coordinated model package with a validation and change record.',
    nodes: [
      node('01-approved', '01', 'MODEL BASIS', 'Freeze model & exchange rules', 'Confirm the approved structural revision, shared coordinates, units and exchange information requirements. Record model ownership and intended coordination use before editing.', ['bim', 'doc'], 'modelling', 'task', 'Model baseline and exchange checklist.'),
      node('02-geometry', '02', 'GEOMETRY', 'Levels, axes & member geometry', 'Review grids, elevations, offsets and section orientation against approved drawings. Distinguish analytical centrelines from physical member geometry and record intentional offsets.', ['bim', 'cad'], 'modelling', 'task', 'Checked geometry and coordinate mapping.'),
      node('03-properties', '03', 'INFORMATION', 'Prepare exchange information', 'Reconcile member IDs, section names, materials and required properties with the structural schedule. Flag missing values and ambiguous mappings without silently substituting defaults.', ['bim', 'spreadsheet'], 'modelling', 'task', 'Property mapping and exception register.'),
      node('04-validation', '04', 'VALIDATE', 'Validate the exchange model', 'Review the prepared exchange model in BIM Helper. Compare member counts, geometry, units and required properties with the baseline; reconcile exceptions before coordination issue.', ['bim', 'spreadsheet'], 'analysis', 'task', 'Model comparison and validation record.'),
      node('05-review', '05', 'HUMAN REVIEW', 'Designer coordination review', 'The designer reviews model changes and open interfaces with other disciplines. Resolve blocking discrepancies or record an explicit issue limitation before approving the exchange package.', ['bim', 'pdf'], 'modelling', 'review', 'Coordination decision and accepted limitations.'),
      node('06-output', '06', 'ISSUE', 'Model & change register', 'Issue the agreed model format with its validation record, revision identifier and change register. Retain links to the approved structural source and coordination decisions.', ['bim', 'doc'], 'documentation', 'task', 'Versioned model package and traceable change record.'),
    ],
    links: [['01-approved', '02-geometry'], ['02-geometry', '03-properties'], ['03-properties', '04-validation'], ['03-properties', '05-review'], ['04-validation', '05-review'], ['05-review', '06-output']],
  },
];

export const SERVICE_BY_ID = Object.fromEntries(SERVICES.map(service => [service.id, service]));

export function fixedStatuses(service) {
  const primary = service.links.filter(link => !link[2]?.feedback);
  const incoming = new Set(primary.map(link => link[1]));
  const outgoing = new Set(primary.map(link => link[0]));
  const sources = service.nodes.filter(stage => !incoming.has(stage.id));
  const sinks = service.nodes.filter(stage => !outgoing.has(stage.id));
  const source = sources[0]?.id;
  const sink = sinks[0]?.id;
  return Object.fromEntries(service.nodes.map(stage => [
    stage.id,
    stage.id === source ? 'start' : stage.id === sink ? 'running' : 'done',
  ]));
}

export function dependenciesFor(service, id) {
  return service.links.filter(link => !link[2]?.feedback && link[1] === id).length;
}

export function handlesFor(from, to) {
  if (Math.abs(from.y - to.y) > Math.abs(from.x - to.x)) return from.y < to.y ? ['s-bottom', 't-top'] : ['s-top', 't-bottom'];
  return from.x < to.x ? ['s-right', 't-left'] : ['s-left', 't-right'];
}
