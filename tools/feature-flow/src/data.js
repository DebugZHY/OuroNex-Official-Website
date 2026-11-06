export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 96;
export const DEFAULT_FOCUS = "04-technical";

/* A coordination map for one procurement scenario, not a statutory timetable.
   Positions are flow coordinates; the browser owns pan/zoom, so nothing here is
   scaled by hand. Cards are placed by dependency chain rather than by fixed
   row bands, so each chain reads straight through and unrelated cards sit apart. */
export const STAGES = [
  {
    id: "00-strategic",
    ordinal: "00",
    phase: "RIBA 0",
    title: "Strategic definition",
    summary: "Test whether a building is the right answer.",
    app: "Flow",
    status: "succeeded",
    category: "Strategy",
    position: { x: 0, y: 0 },
    purpose:
      "Determine the best means of achieving the client's requirements before committing to a building solution. Establish the business case, client requirements, budget envelope and the skills the client team needs.",
    inputs: ["Client brief and business case", "Site and portfolio constraints", "Whole-life and affordability checks"],
    outputs: ["Business case", "Client requirements", "Project budget envelope", "Stage 1 appointment plan"],
    note:
      "RIBA treats Stage 0 as strategic. A detailed design brief belongs in Stage 1, and design work normally starts at Stage 2.",
    source: "RIBA Plan of Work 2020, Stage 0.",
  },
  {
    id: "01-brief",
    ordinal: "01",
    phase: "RIBA 1",
    title: "Brief & design basis",
    summary: "Fix the brief, budget and design basis.",
    app: "Word document",
    status: "succeeded",
    category: "Brief",
    position: { x: 228, y: 0 },
    purpose:
      "Develop the project brief and confirm it can be accommodated on the site. Set the design basis, information requirements, responsibility matrix and procurement considerations before concept design starts.",
    inputs: ["Business case and client requirements", "Site survey and feasibility studies", "Budget and programme constraints"],
    outputs: ["Project brief", "Design basis", "Responsibility matrix", "Procurement options appraisal", "Information requirements"],
    note:
      "Stage 1 is briefing and feasibility, not the start of building design. Procurement route is selected separately and does not change the RIBA stage outcomes.",
    source: "RIBA Plan of Work 2020, Stage 1.",
  },
  {
    id: "02-concept",
    ordinal: "02",
    phase: "RIBA 2",
    title: "Concept design",
    summary: "Settle the architectural and structural concept.",
    app: "BIM",
    status: "succeeded",
    category: "Design",
    position: { x: 456, y: 0 },
    purpose:
      "Develop the architectural concept and structural strategy against the brief, budget and site constraints. Test options and settle the design direction before spatial coordination.",
    inputs: ["Project brief and design basis", "Site constraints and planning context", "Structural and services options"],
    outputs: ["Architectural concept", "Structural scheme and grid", "Design review record", "Updated project brief"],
    note:
      "The concept should be concluded at Stage 2. Stage 3 is for spatial coordination, not for reopening the concept without change control.",
    source: "RIBA Plan of Work 2020, Stage 2.",
  },
  {
    id: "03-coordination",
    ordinal: "03",
    phase: "RIBA 3",
    title: "Spatial coordination",
    summary: "Coordinate architecture, structure and services.",
    app: "BIM",
    status: "succeeded",
    category: "Design",
    position: { x: 684, y: 0 },
    purpose:
      "Coordinate architecture, structure, services and specialist information into one spatially coordinated design before technical design accelerates. Resolve clashes and conclude the project strategies.",
    inputs: ["Architectural concept", "Structural scheme", "Services and specialist information", "Project strategies"],
    outputs: ["Coordinated model", "Clash resolution record", "Coordinated project strategies", "Stage 3 design review"],
    note:
      "Stage 3 deliverables are coordinated but generally not detailed enough for robust tender pricing. Tender timing is a procurement decision, not a Stage 3 gate.",
    source: "RIBA Plan of Work 2020, Stage 3.",
  },
  {
    id: "04-technical",
    ordinal: "04",
    phase: "RIBA 4",
    title: "Technical design",
    summary: "Produce construction-ready technical information.",
    app: "SODA",
    status: "running",
    category: "Design",
    position: { x: 486, y: 170 },
    purpose:
      "Produce the information required to manufacture and construct the building, including specialist subcontractor design where the procurement route assigns it. Resolve site queries only as an exception once construction starts.",
    inputs: ["Coordinated Stage 3 design", "Approved design basis", "Specialist and subcontractor information"],
    outputs: ["Calculations", "Technical drawings", "Specifications", "Construction information", "Integrated specialist design"],
    note:
      "RIBA places specialist subcontractor design in Stage 4. Stage 5 is manufacturing and construction, except for site-query resolution. Stage 4 and Stage 5 can overlap depending on procurement.",
    source: "RIBA Plan of Work 2020, Stage 4.",
  },
  {
    id: "p1-procurement",
    ordinal: "P1",
    phase: "Procurement",
    title: "Procurement strategy",
    summary: "Choose route and responsibility matrix.",
    app: "Word document",
    status: "succeeded",
    category: "Procurement",
    position: { x: 30, y: 170 },
    purpose:
      "Choose the procurement route and responsibility matrix. Tender timing is a consequence of that route, not a fixed RIBA stage: traditional, two-stage design & build and early-contractor-involvement routes place tender and specialist design at different points.",
    inputs: ["Project brief", "Risk allocation and client capability", "Market and programme constraints"],
    outputs: ["Procurement route", "Responsibility matrix", "Tender strategy", "Contract strategy"],
    note:
      "This showcase assumes a two-stage design & build: the contractor is appointed during Stage 4, specialist design follows award, and Stages 4 and 5 overlap. No universal tender date is implied.",
    source: "RIBA Plan of Work 2020, Stage 1 and Stage 4 procurement notes.",
  },
  {
    id: "g2-gbp1",
    ordinal: "G2",
    phase: "Statutory",
    title: "GBP Stage I submission",
    summary: "First GBP approval milestone.",
    app: "PDF",
    status: "succeeded",
    category: "Submission",
    position: { x: 690, y: 170 },
    purpose:
      "Submit the general building plans for the first approval milestone. Stage I covers the fundamental information required for first approval; Stage II and Stage III details may be deferred under the staged-submission practice.",
    inputs: ["General building plans", "Stage I information set", "Prescribed forms and fees"],
    outputs: ["GBP Stage I submission", "Submission record", "Comments or approval"],
    note:
      "PNAP ADM-19 §§14–15 describe the three staged GBP milestones and the Stage I curtailed check. §19 applies the practice to new building developments (not A&A) whose first GBP or major revision is submitted after 31 March 2023. This diagram follows that staged route as a chosen scenario; a §4 pre-submission enquiry is optional and not a prerequisite.",
    source: "PNAP ADM-19 §§14–15 and §19.",
  },
  {
    id: "g3-approval1",
    ordinal: "G3",
    phase: "Statutory",
    title: "Stage I approval",
    summary: "BD approves the Stage I plans.",
    app: "PDF",
    status: "succeeded",
    category: "Approval",
    position: { x: 690, y: 300 },
    purpose:
      "BD's approval of the Stage I GBP. Plan approval is a decision on the plans; it is not consent to commence works.",
    inputs: ["GBP Stage I submission", "BD comments"],
    outputs: ["Approved plans with BD stamp", "Approval conditions", "Record of approved revision"],
    note:
      "Scenario dependency: Stage I approval follows the Stage I submission in this staged-GBP route. Approval is not consent; consent under BO s.16(3)(a) is a separate application, and concurrent approval/consent is available only in the cases and on the terms in §§33–39.",
    source: "PNAP ADM-19 §§14–16, §§33–39; BO s.16(3)(a) as cited in §14.",
  },
  {
    id: "g4-gbp2",
    ordinal: "G4",
    phase: "Statutory",
    title: "GBP Stage II approval",
    summary: "Staged-route step before consent.",
    app: "PDF",
    status: "running",
    category: "Approval",
    position: { x: 456, y: 300 },
    purpose:
      "Seek Stage II GBP approval before applying for consent to commence superstructure works. The full set of GBP information required for Stages I and II must be submitted.",
    inputs: ["Approved Stage I GBP", "Stage II information set", "Updated plans and details"],
    outputs: ["Stage II curtailed-check record", "Approved GBP revision"],
    note:
      "Scenario dependency: ADM-19 §16 says that, after first Stage I approval, the AP must submit the full GBP incorporating Stage I and II information and seek Stage II approval prior to applying for consent for superstructure works. This is a dependency of the chosen staged-GBP route, not a universal sequence for every project.",
    source: "PNAP ADM-19 §16.",
  },
  {
    id: "g5-supervision",
    ordinal: "G5",
    phase: "Consent input",
    title: "Works-specific supervision planning",
    summary: "Arrangements where the works require them.",
    app: "PDF",
    status: "not_started",
    category: "Consent input",
    position: { x: 0, y: 300 },
    purpose:
      "Agree supervision arrangements for the relevant works where the contract or consent route requires them. Scope, roles, hold points, inspection and testing vary by works and route; there is no generic plan that applies to every new-build superstructure.",
    inputs: ["Contractor and supervision appointments", "Works scope, method and programme", "Applicable supervision requirements"],
    outputs: ["Works-specific supervision arrangements", "Roles and hold points", "Inspection and test arrangements where required"],
    note:
      "ADM-19 §34(d) sits in the concurrent approval/consent route for A&A, drainage and secondary structural element works; it says supporting information “may include site supervision plans”. It is not a universal new-build superstructure mandate. In this scenario, consent supporting information is works-specific; prepare a supervision plan only where the works and applicable requirements call for one.",
    source: "PNAP ADM-19 §34(d) (A&A/drainage/secondary-works concurrent route); Technical Memorandum for Supervision Plans; Code of Practice for Site Supervision.",
  },
  {
    id: "g6-consent",
    ordinal: "G6",
    phase: "Statutory",
    title: "Consent to commence superstructure",
    summary: "Separate consent under BO s.16(3)(a).",
    app: "PDF",
    status: "not_started",
    category: "Consent",
    position: { x: 228, y: 300 },
    purpose:
      "Obtain the Building Authority's consent under BO s.16(3)(a) to commence the superstructure works. Consent is separate from plan approval and is applied for after the relevant approvals, with the required supporting documents.",
    inputs: ["Approved GBP", "Completed consent application", "Works-specific supporting information, including supervision arrangements where required"],
    outputs: ["Consent to commence", "Consent conditions", "Application record"],
    note:
      "ADM-19 §39: where approval and consent are concurrent, the consent application is effective from the date approval is given; it is not processed before the plans are approved; where approval is given but consent cannot be concurrent, the 28-day period in B(A)R reg 32(3) runs from the date of approval. This is not a universal 28-day promise. Consent supporting information is works-specific; §34(d)'s supervision-plan reference is not a universal new-build requirement.",
    source: "PNAP ADM-19 §39(a)–(c); BO s.16(3)(a); B(A)R reg 32(3).",
  },
  {
    id: "g7-gbp3",
    ordinal: "G7",
    phase: "Statutory",
    title: "GBP Stage III approval",
    summary: "Staged-route step before OP/TOP.",
    app: "PDF",
    status: "not_started",
    category: "Approval",
    position: { x: 486, y: 470 },
    purpose:
      "Seek Stage III GBP approval for this staged route before the OP/TOP application. Stage III covers deferred GBP information for OP/TOP; treat it as a scenario dependency, not a universal sequence.",
    inputs: ["Updated GBP", "Stage III information set", "Completion-related information where available"],
    outputs: ["Stage III approval", "Final approved GBP set"],
    note:
      "Scenario dependency: §18 says the AP may seek Stage III approval in an amendment and should ensure approval is obtained prior to the OP/TOP application. This diagram places Stage III before OP/TOP for the chosen staged-GBP route; it is not a universal sequence. §14 cites BO s.21(6)(a).",
    source: "PNAP ADM-19 §§14 and 18; BO s.21(6)(a) as cited in §14.",
  },
  {
    id: "p2-tender",
    ordinal: "P2",
    phase: "Procurement",
    title: "Tender & contract award",
    summary: "Award during Stage 4 in this scenario.",
    app: "Spreadsheet",
    status: "not_started",
    category: "Procurement",
    position: { x: 258, y: 170 },
    purpose:
      "Run the tender and award the building contract. In the assumed two-stage design & build route, the contractor is appointed during Stage 4; the second stage completes specialist design and pricing before construction.",
    inputs: ["Procurement strategy", "Stage 4 design information", "Tender documents and pricing schedule"],
    outputs: ["Tender returns", "Evaluation report", "Contract award", "Contractor's stage-two proposals"],
    note:
      "RIBA Stage 4 notes place specialist subcontractor design in Stage 4 and acknowledge that Stages 4 and 5 may overlap. Tender timing depends on procurement; no fixed tender stage or statutory deadline is implied.",
    source: "RIBA Plan of Work 2020, Stage 4 procurement notes.",
  },
  {
    id: "construction",
    ordinal: "05",
    phase: "RIBA 5",
    title: "Manufacture & construction",
    summary: "Build under contract and supervision.",
    app: "Flow",
    status: "not_started",
    category: "Delivery",
    position: { x: 30, y: 470 },
    purpose:
      "Manufacture and construct the building under the building contract and the site supervision plan, resolving site queries and recording inspections and test results.",
    inputs: ["Building contract", "Construction information", "Consent to commence", "Site supervision plan"],
    outputs: ["Constructed works", "Inspection and test records", "Site query log", "As-built changes"],
    note:
      "RIBA Stage 5 is manufacturing and construction; design work other than site-query resolution belongs in Stage 4. Consent and the relevant supervision arrangements must be in place before the works they cover begin.",
    source: "RIBA Plan of Work 2020, Stage 5.",
  },
  {
    id: "completion",
    ordinal: "06",
    phase: "RIBA 5–6",
    title: "Completion evidence",
    summary: "Evidence for the chosen OP/TOP route.",
    app: "PDF",
    status: "not_started",
    category: "Completion",
    position: { x: 258, y: 470 },
    purpose:
      "Assemble the completion or stage-of-works evidence required for the OP/TOP route actually chosen. This is not a universal “full Practical Completion before TOP” gate: permit conditions and the part of the works covered determine the evidence.",
    inputs: ["Construction records", "Inspection and test results", "Completion or stage-of-works checks"],
    outputs: ["Completion evidence pack", "As-built information", "Test and inspection records", "Evidence required by the chosen permit route"],
    note:
      "RIBA Stage 5 ends at Practical Completion, and handover activities can start before that date and continue after it. Contractual completion is not the statutory OP/TOP; a TOP can relate to part of the works, so this node is completion evidence, not a universal PC gate.",
    source: "RIBA Plan of Work 2020, Stages 5–6.",
  },
  {
    id: "occupation",
    ordinal: "G8",
    phase: "Statutory",
    title: "OP / TOP",
    summary: "Statutory permission to occupy.",
    app: "Browser",
    status: "not_started",
    category: "Occupation",
    position: { x: 486, y: 600 },
    purpose:
      "Apply for an occupation permit or temporary occupation permit after the relevant GBP approvals and the completion or stage-of-works evidence the permit requires. OP/TOP is the statutory permission to occupy, distinct from contractual Practical Completion.",
    inputs: ["Stage III GBP approval for this staged route", "Completion or stage-of-works evidence for the chosen route", "OP/TOP application and prescribed documents"],
    outputs: ["OP/TOP application", "Permit or conditions", "Occupation record"],
    note:
      "In this staged-GBP scenario, Stage III approval precedes the OP/TOP application; §18 says the AP should ensure approval is obtained prior to application, and §14 cites BO s.21(6)(a). This is a scenario dependency, not a universal sequence. No fixed processing time is asserted; TOP is temporary and subject to permit conditions.",
    source: "PNAP ADM-19 §§14 and 18; BO s.21(6)(a) as cited in §14.",
  },
  {
    id: "handover",
    ordinal: "07",
    phase: "RIBA 6–7",
    title: "Handover, aftercare & use",
    summary: "O&M, defects, aftercare and use.",
    app: "Flow",
    status: "not_started",
    category: "Use",
    position: { x: 714, y: 600 },
    purpose:
      "Hand over the building and operate it: complete defects, deliver O&M information and training, run aftercare and post-occupancy evaluation. Stage 7 covers use until the end of the building's life.",
    inputs: ["Completion and as-built information", "O&M manuals and training plan", "Plan for Use Strategy"],
    outputs: ["Building manual and O&M information", "Training records", "Defects schedule", "Post-occupancy evaluation", "Aftercare plan"],
    note:
      "RIBA Stage 6 covers handover and closing out the Building Contract; Stage 7 is use. Aftercare and post-occupancy evaluation that continue beyond Stage 6 need separate appointments.",
    source: "RIBA Plan of Work 2020, Stages 6–7.",
  },
];

export const EDGES = [
  { id: "00-01", source: "00-strategic", target: "01-brief", sh: "out-right", th: "in-left", state: "done" },
  { id: "01-02", source: "01-brief", target: "02-concept", sh: "out-right", th: "in-left", state: "done" },
  { id: "02-03", source: "02-concept", target: "03-coordination", sh: "out-right", th: "in-left", state: "done" },
  { id: "03-04", source: "03-coordination", target: "04-technical", sh: "out-bottom", th: "in-top", state: "run" },
  { id: "03-g2", source: "03-coordination", target: "g2-gbp1", sh: "out-bottom", th: "in-top", state: "done" },
  { id: "01-p1", source: "01-brief", target: "p1-procurement", sh: "out-bottom", th: "in-top", state: "done" },
  { id: "p1-p2", source: "p1-procurement", target: "p2-tender", sh: "out-right", th: "in-left", state: "idle" },
  { id: "04-p2", source: "04-technical", target: "p2-tender", sh: "out-left", th: "in-right", state: "idle" },
  { id: "g2-g3", source: "g2-gbp1", target: "g3-approval1", sh: "out-bottom", th: "in-top", state: "done" },
  { id: "g3-g4", source: "g3-approval1", target: "g4-gbp2", sh: "out-left", th: "in-right", state: "run" },
  { id: "g4-g6", source: "g4-gbp2", target: "g6-consent", sh: "out-left", th: "in-right", state: "idle" },
  { id: "g5-g6", source: "g5-supervision", target: "g6-consent", sh: "out-right", th: "in-left", state: "optional", optional: true },
  { id: "g6-construction", source: "g6-consent", target: "construction", sh: "out-bottom", th: "in-top", state: "idle" },
  { id: "p2-construction", source: "p2-tender", target: "construction", sh: "out-bottom", th: "in-left", state: "idle", channel: "bottom-left" },
  { id: "g4-g7", source: "g4-gbp2", target: "g7-gbp3", sh: "out-bottom", th: "in-top", state: "idle" },
  { id: "g7-occupation", source: "g7-gbp3", target: "occupation", sh: "out-bottom", th: "in-top", state: "idle" },
  { id: "construction-completion", source: "construction", target: "completion", sh: "out-right", th: "in-left", state: "idle" },
  { id: "completion-occupation", source: "completion", target: "occupation", sh: "out-bottom", th: "in-left", state: "idle", channel: "drop" },
  { id: "occupation-handover", source: "occupation", target: "handover", sh: "out-right", th: "in-left", state: "idle" },
  { id: "loop-coordination", source: "03-coordination", target: "02-concept", sh: "out-bottom", th: "in-bottom", state: "loop", loop: true, loopDown: true, lift: 18, label: "spatial feedback", iteration: true },
  { id: "loop-resubmit", source: "g3-approval1", target: "g2-gbp1", sh: "out-right", th: "in-right", state: "loop", channel: "right", iteration: true },
];

export const GRAPH_BOUNDS = { x: -33, y: -22, width: 955, height: 726 };

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((stage) => [stage.id, stage]));

export const INCOMING = Object.fromEntries(
  STAGES.map((stage) => [
    stage.id,
    EDGES.filter((edge) => edge.target === stage.id && edge.iteration !== true && edge.optional !== true).map(
      (edge) => edge.source,
    ),
  ]),
);

export const OUTGOING = Object.fromEntries(
  STAGES.map((stage) => [
    stage.id,
    EDGES.filter((edge) => edge.source === stage.id && edge.iteration !== true).map((edge) => edge.target),
  ]),
);

export const FEEDBACK = Object.fromEntries(
  STAGES.map((stage) => [
    stage.id,
    EDGES.filter((edge) => edge.iteration === true && (edge.source === stage.id || edge.target === stage.id)),
  ]),
);

export const HANDLE_FLAGS = Object.fromEntries(
  STAGES.map((stage) => {
    const uses = (handle, key) => EDGES.some((edge) => edge[key] === handle && (edge.source === stage.id || edge.target === stage.id));
    return [
      stage.id,
      {
        topIn: uses("in-top", "th"),
        bottomIn: uses("in-bottom", "th"),
        bottomOut: uses("out-bottom", "sh"),
        loopIn: uses("loop-in", "th"),
        loopOut: uses("loop-out", "sh"),
      },
    ];
  }),
);
