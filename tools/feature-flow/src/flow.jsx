import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import {
  EDGES,
  FEEDBACK,
  GRAPH_BOUNDS,
  HANDLE_FLAGS,
  INCOMING,
  NODE_HEIGHT,
  NODE_WIDTH,
  OUTGOING,
  STAGES,
  STAGE_BY_ID,
} from "./data.js";

/* Three board states only: succeeded, running and not_started, printed as
   Done, Running and Not started. */
const STATUS = {
  succeeded: { label: "Done", tone: "ok", badge: "done", Icon: CheckIcon },
  running: { label: "Running", tone: "run", badge: "running", Icon: LoaderIcon },
  blocked: { label: "Blocked", tone: "bad", badge: "failed", Icon: AlertIcon },
  failed: { label: "Failed", tone: "bad", badge: "failed", Icon: AlertIcon },
  cancelled: { label: "Cancelled", tone: "cancelled", badge: "cancelled", Icon: BanIcon },
  not_started: { label: "Not started", tone: "idle", badge: "not-started", Icon: CircleDashedIcon },
};

function statusOf(stage) {
  return STATUS[stage.status] ?? STATUS.not_started;
}

function iconProps(size = 12) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
  };
}

function CircleDashedIcon({ size = 12 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" strokeDasharray="2 3" />
    </svg>
  );
}

function LoaderIcon({ size = 12 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CheckIcon({ size = 12 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.6 12.2 2.2 2.2 4.6-4.8" />
    </svg>
  );
}

function AlertIcon({ size = 12 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M10.3 3.9 2.6 17.2a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 16.5h.01" />
    </svg>
  );
}

function BanIcon({ size = 12 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </svg>
  );
}

function XIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

function PlusIcon({ size = 13 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon({ size = 13 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 12h14" />
    </svg>
  );
}

function FitIcon({ size = 13 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

function InfoIcon({ size = 13 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function ArrowIcon({ size = 11 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function StatusBadge({ stage, compact = false }) {
  const status = statusOf(stage);
  const Icon = status.Icon;
  return (
    <span
      className={`sff-badge sff-badge--${status.badge}${compact ? " sff-badge--compact" : ""}`}
      data-stage-badge={status.badge}
    >
      <Icon size={compact ? 10 : 11} />
      {status.label}
    </span>
  );
}

function NodeHandles({ stage, selected }) {
  const flags = HANDLE_FLAGS[stage.id] ?? {};
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in-left"
        className="sff-handle sff-handle--left"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="out-left"
        className="sff-handle sff-handle--left"
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="in-right"
        className="sff-handle sff-handle--right"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out-right"
        className="sff-handle sff-handle--right"
        isConnectable={false}
      />
      {flags.topIn ? (
        <Handle
          type="target"
          position={Position.Top}
          id="in-top"
          className="sff-handle sff-handle--top"
          isConnectable={false}
        />
      ) : null}
      {flags.bottomIn ? (
        <Handle
          type="target"
          position={Position.Bottom}
          id="in-bottom"
          className="sff-handle sff-handle--bottom"
          isConnectable={false}
        />
      ) : null}
      {flags.bottomOut ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="out-bottom"
          className="sff-handle sff-handle--bottom"
          isConnectable={false}
        />
      ) : null}
      {flags.loopIn ? (
        <Handle
          type="target"
          position={Position.Top}
          id="loop-in"
          className="sff-handle sff-handle--loop"
          isConnectable={false}
        />
      ) : null}
      {flags.loopOut ? (
        <Handle
          type="source"
          position={Position.Top}
          id="loop-out"
          className="sff-handle sff-handle--loop"
          isConnectable={false}
        />
      ) : null}
    </>
  );
}

const StageNode = memo(function StageNode({ data, selected }) {
  const { stage, dimmed } = data;
  const status = statusOf(stage);
  const StatusIcon = status.Icon;
  const dependencies = (INCOMING[stage.id] ?? []).length;
  return (
    <article
      className={`sff-node sff-node--${status.tone}`}
      data-stage-id={stage.id}
      data-stage-node={selected ? "selected" : "idle"}
      data-stage-state={status.badge}
      data-status={stage.status}
      data-adjacency={dimmed ? "far" : "near"}
      aria-label={`${stage.title}. ${stage.phase}. ${status.label}. ${stage.category}.`}
      title={`${stage.title} · ${stage.phase} · ${status.label}`}
    >
      <NodeHandles stage={stage} selected={selected} />
      <div className="sff-node__top">
        <span className="sff-node__ordinal">{stage.ordinal}</span>
        <span className="sff-node__phase">{stage.phase}</span>
        <span className="sff-node__status-icon" data-stage-status-icon={status.badge} aria-hidden="true">
          <StatusIcon size={14} />
        </span>
      </div>
      <h3 className="sff-node__title">{stage.title}</h3>
      <div className="sff-node__foot">
        <span className={`sff-node__status sff-node__status--${status.badge}`}>
          <StatusIcon size={11} />
          {status.label}
        </span>
        {dependencies > 0 ? (
          <span className="sff-node__deps">
            <span aria-hidden="true">·</span>
            {dependencies} {dependencies === 1 ? "dependency" : "dependencies"}
          </span>
        ) : null}
      </div>
    </article>
  );
});

const EDGE_STYLES = {
  done: { stroke: "rgba(157,191,239,.76)", dash: undefined, label: "done" },
  run: { stroke: "#8fb9ff", dash: "9 6", label: "run" },
  idle: { stroke: "rgba(157,191,239,.48)", dash: "4 5", label: "idle" },
  optional: { stroke: "rgba(157,191,239,.34)", dash: "3 5", label: "optional" },
  loop: { stroke: "#f3bd72", dash: "5 4", label: "loop" },
};

const StageEdge = memo(function StageEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  label,
}) {
  let path;
  let labelX;
  let labelY;
  if (data?.channel === "bottom-left") {
    const channelX = targetX - 30;
    const dropY = sourceY + 14;
    path = `M ${sourceX} ${sourceY} L ${sourceX} ${dropY} L ${channelX} ${dropY} L ${channelX} ${targetY} L ${targetX} ${targetY}`;
    labelX = channelX;
    labelY = (dropY + targetY) / 2;
  } else if (data?.channel === "drop") {
    const turn = targetX > sourceX ? 12 : -12;
    path = `M ${sourceX} ${sourceY} L ${sourceX} ${targetY - 12} Q ${sourceX} ${targetY} ${sourceX + turn} ${targetY} L ${targetX} ${targetY}`;
    labelX = sourceX;
    labelY = targetY;
  } else if (data?.channel === "right") {
    const channelX = targetX + 30;
    path = `M ${sourceX} ${sourceY} L ${channelX} ${sourceY} L ${channelX} ${targetY} L ${targetX} ${targetY}`;
    labelX = channelX;
    labelY = (sourceY + targetY) / 2;
  } else if (data?.loop) {
    const lift = data.lift ?? 52;
    if (data.loopDown) {
      path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + lift}, ${targetX} ${targetY + lift}, ${targetX} ${targetY}`;
      labelX = (sourceX + targetX) / 2;
      labelY = Math.max(sourceY, targetY) + lift * 0.72;
    } else {
      path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY - lift}, ${targetX} ${targetY - lift}, ${targetX} ${targetY}`;
      labelX = (sourceX + targetX) / 2;
      labelY = Math.min(sourceY, targetY) - lift * 0.72;
    }
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 14,
      offset: 24,
    });
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={18} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={`sff-edge-label sff-edge-label--${data?.state ?? "idle"}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const nodeTypes = { stage: StageNode };
const edgeTypes = { stage: StageEdge };

function stageEdges() {
  return EDGES.map((edge) => {
    const tone = EDGE_STYLES[edge.state] ?? EDGE_STYLES.idle;
    const live = STAGE_BY_ID[edge.source]?.status === "running" || STAGE_BY_ID[edge.target]?.status === "running";
    const stroke = live ? EDGE_STYLES.run.stroke : tone.stroke;
    return {
      ...edge,
      type: "stage",
      sourceHandle: edge.sh,
      targetHandle: edge.th,
      animated: live || edge.state === "run",
      style: {
        stroke,
        strokeDasharray: live ? EDGE_STYLES.run.dash : tone.dash,
        strokeWidth: live ? 2.8 : 2.1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: live ? 8 : 10,
        height: live ? 8 : 10,
      },
      data: {
        state: edge.state,
        loop: edge.loop,
        loopDown: edge.loopDown,
        channel: edge.channel,
        lift: edge.lift,
      },
    };
  });
}

function titleOf(id) {
  return STAGE_BY_ID[id]?.title ?? id;
}

function StagePopover({ stage, style, arrowX, placement, panelRef, onClose, onSelect }) {
  const incoming = INCOMING[stage.id] ?? [];
  const outgoing = OUTGOING[stage.id] ?? [];
  const feedback = FEEDBACK[stage.id] ?? [];
  const titleId = `sff-popover-${stage.id}`;

  return (
    <aside
      ref={panelRef}
      className="sff-popover"
      data-stage-popover=""
      data-stage-id={stage.id}
      data-placement={placement}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ ...style, "--sff-arrow-x": `${arrowX}px` }}
    >
      <span className="sff-popover__arrow" aria-hidden="true" />
      <header className="sff-popover__head" data-stage-popover-head="">
        <div className="sff-popover__heading">
          <p className="sff-popover__eyebrow">
            {stage.phase} <span aria-hidden="true">·</span> {stage.category}
            {stage.optional ? " · optional" : ""}
          </p>
          <h2 id={titleId} className="sff-popover__title" data-stage-popover-title="">
            {stage.title}
          </h2>
          <div className="sff-popover__meta">
            <StatusBadge stage={stage} />
            <span className="sff-popover__app">{stage.app}</span>
          </div>
        </div>
        <button className="sff-icon-button" type="button" onClick={onClose} aria-label="Close stage detail" data-stage-popover-close="">
          <XIcon size={15} />
        </button>
      </header>

      <div className="sff-popover__body" data-stage-popover-body="">
        <section className="sff-popover__section">
          <h3>Purpose</h3>
          <p>{stage.purpose}</p>
        </section>

        <div className="sff-popover__columns">
          <section className="sff-popover__section">
            <h3>Inputs</h3>
            <ul className="sff-list">
              {stage.inputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="sff-popover__section">
            <h3>Outputs / evidence</h3>
            <ul className="sff-list">
              {stage.outputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="sff-callout">
          <h3>
            <InfoIcon size={12} /> Source note
          </h3>
          <p>{stage.note}</p>
          <p className="sff-callout__source">{stage.source}</p>
        </section>

        {incoming.length > 0 ? (
          <section className="sff-popover__section">
            <h3>Depends on</h3>
            <div className="sff-related">
              {incoming.map((id) => (
                <button key={id} type="button" className="sff-related__chip" onClick={() => onSelect(id)}>
                  {titleOf(id)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {outgoing.length > 0 ? (
          <section className="sff-popover__section">
            <h3>Leads to</h3>
            <div className="sff-related">
              {outgoing.map((id) => (
                <button key={id} type="button" className="sff-related__chip" onClick={() => onSelect(id)}>
                  {titleOf(id)}
                  <ArrowIcon size={10} />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {feedback.length > 0 ? (
          <section className="sff-popover__section">
            <h3>Iteration / feedback</h3>
            <div className="sff-related">
              {feedback.map((edge) => {
                const other = edge.source === stage.id ? edge.target : edge.source;
                return (
                  <button
                    key={edge.id}
                    type="button"
                    className="sff-related__chip sff-related__chip--loop"
                    onClick={() => onSelect(other)}
                    title={edge.label ?? "Iteration"}
                  >
                    {titleOf(other)}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function AboutPanel({ onClose }) {
  const titleId = "sff-about-title";
  return (
    <div className="sff-about-scrim" onMouseDown={onClose}>
      <aside
        className="sff-about"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sff-about__head">
          <div>
            <p className="sff-about__eyebrow">Showcase note</p>
            <h2 id={titleId}>Scenario &amp; sources</h2>
          </div>
          <button className="sff-icon-button" type="button" onClick={onClose} aria-label="Close scenario and sources">
            <XIcon size={15} />
          </button>
        </header>

        <div className="sff-about__body">
          <p>
            This is a coordination map, not a statutory timetable. Blue wires are dependencies (solid where delivered,
            dashed where still open); amber dashed loops are iterations or re-submissions; grey dashed wires are optional
            or route-dependent.
          </p>

          <h3>Chosen scenario</h3>
          <ul className="sff-list">
            <li>Private Hong Kong new-build, competitive two-stage design &amp; build.</li>
            <li>Design team develops Stages 0–4; the contractor is appointed during Stage 4.</li>
            <li>Specialist subcontractor design is integrated in late Stage 4, with Stage 4/5 overlap.</li>
            <li>Tender and award sit in the procurement branch because timing follows the route; they are not a universal Stage 3 or Stage 4 gate.</li>
            <li>This is a chosen staged-GBP route under ADM-19 §14, where the AP defers information to Stage I/II/III. The Stage II and Stage III edges are dependencies of this scenario, not a universal statutory sequence.</li>
            <li>Consent to commence is a separate decision from plan approval. Statuses are an illustrative snapshot, not a live project record.</li>
          </ul>

          <h3>Statutory guardrails</h3>
          <ul className="sff-list">
            <li>Plan approval is not consent to commence. ADM-19 treats them as separate applications (§§14–16, 33–39).</li>
            <li>ADM-19 §34(d) sits in the concurrent A&amp;A/drainage/secondary-works route and says supporting information “may include site supervision plans”. It is not a universal new-build superstructure mandate; consent inputs here are works-specific.</li>
            <li>For concurrent approval and consent, ADM-19 §39(a)–(c) says the consent application is effective from approval, is not processed before approval, and the B(A)R reg 32(3) 28-day period runs from approval where approval is given but consent cannot be concurrent.</li>
            <li>In this staged-GBP scenario, Stage III approval precedes OP/TOP; §18 says the AP may seek Stage III and should ensure approval before application. This is a scenario dependency, not a universal sequence.</li>
            <li>OP/TOP is separate from contractual Practical Completion. Completion evidence is route- and works-specific; a TOP need not wait for full Practical Completion.</li>
          </ul>

          <h3>Sources</h3>
          <ul className="sff-list sff-list--sources">
            <li><a href="https://www.riba.org/media/syneeeto/2020ribaplanofworkoverviewpdf.pdf" target="_blank" rel="noopener noreferrer">RIBA Plan of Work 2020 Overview (official PDF)</a> — Stages 0–7; procurement independence; Stage 3 tender warning; Stage 4 specialist design; Stages 6–7 handover and aftercare.</li>
            <li><a href="https://www.bd.gov.hk/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap/ADM/ADM019.pdf" target="_blank" rel="noopener noreferrer">PNAP ADM-19 Building Approval Process (official PDF)</a> — §4 pre-submission enquiry; §6 curtailed check; §§14–19 staged GBP; §16 Stage II; §18 Stage III and OP/TOP; §34(d) works-specific supervision input; §39(a)–(c) concurrent applications and the 28-day rule.</li>
            <li>Buildings Ordinance ss.16(3)(a) and 21(6)(a), as cited by PNAP ADM-19 §14.</li>
            <li>Building (Administration) Regulations reg 32(3), as cited by PNAP ADM-19 §39(c).</li>
            <li>Technical Memorandum for Supervision Plans; Code of Practice for Site Supervision — scope of site supervision plans.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function FlowCanvas() {
  const { setViewport, getZoom, zoomIn, zoomOut, fitView } = useReactFlow();
  const hostRef = useRef(null);
  const popoverRef = useRef(null);
  const returnFocusRef = useRef(null);
  const initializedRef = useRef(false);
  const apiRef = useRef({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewportState] = useState({ x: 0, y: 0, zoom: 1 });
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [popoverHeight, setPopoverHeight] = useState(320);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [flowReady, setFlowReady] = useState(false);

  const selectedStage = selectedId ? STAGE_BY_ID[selectedId] ?? null : null;

  useEffect(() => {
    const panel = popoverRef.current;
    if (!selectedId || !panel) return;
    const measured = panel.offsetHeight;
    if (measured && Math.abs(measured - popoverHeight) > 2) setPopoverHeight(measured);
  }, [selectedId, viewport, popoverHeight]);

  const adjacency = useMemo(() => {
    if (!selectedId) return null;
    return new Set([
      selectedId,
      ...(INCOMING[selectedId] ?? []),
      ...(OUTGOING[selectedId] ?? []),
      ...(FEEDBACK[selectedId] ?? []).map((edge) => (edge.source === selectedId ? edge.target : edge.source)),
    ]);
  }, [selectedId]);

  const nodes = useMemo(
    () =>
      STAGES.map((stage) => ({
        id: stage.id,
        type: "stage",
        position: stage.position,
        selected: stage.id === selectedId,
        draggable: false,
        connectable: false,
        focusable: true,
        ariaLabel: `${stage.title}, ${stage.phase}, ${statusOf(stage).label}`,
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
        data: {
          stage,
          dimmed: adjacency ? !adjacency.has(stage.id) : false,
        },
      })),
    [adjacency, selectedId],
  );

  const edges = useMemo(() => stageEdges(), []);

  const focusStage = useCallback(
    (id, options = {}) => {
      const stage = STAGE_BY_ID[id];
      if (!stage || !size.width || !size.height) return;
      const duration = options.duration ?? (prefersReducedMotion() ? 0 : 280);
      const comfortableZoom = size.width < 720 ? 0.92 : Math.max(0.84, Math.min(1, size.width / 900));
      const currentZoom = Number.isFinite(getZoom()) ? getZoom() : 1;
      const preferredZoom =
        options.preserveZoom === true ? Math.max(0.84, Math.min(currentZoom, 1.08)) : comfortableZoom;
      const nextZoom = options.zoom ?? preferredZoom;
      const targetY = size.height * (size.width < 720 ? 0.31 : 0.29);
      const nextViewport = {
        x: size.width / 2 - (stage.position.x + NODE_WIDTH / 2) * nextZoom,
        y: targetY - (stage.position.y + NODE_HEIGHT / 2) * nextZoom,
        zoom: nextZoom,
      };
      setViewportState(nextViewport);
      setZoom(nextZoom);
      setViewport(nextViewport, { duration });
    },
    [getZoom, setViewport, size.height, size.width],
  );

  const closeSelection = useCallback(() => {
    setSelectedId(null);
    if (returnFocusRef.current && returnFocusRef.current.isConnected) {
      window.requestAnimationFrame(() => returnFocusRef.current?.focus?.());
    }
  }, []);

  const selectStage = useCallback(
    (id) => {
      if (!STAGE_BY_ID[id]) return;
      setAboutOpen(false);
      setSelectedId(id);
      // Desktop keeps the whole map in view; only a narrow canvas needs to recentre.
      if (size.width < 720) focusStage(id);
    },
    [focusStage, size.width],
  );

  const openAbout = useCallback(() => {
    setSelectedId(null);
    setAboutOpen(true);
  }, []);

  const closeAbout = useCallback(() => setAboutOpen(false), []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!flowReady || !size.width || !size.height || initializedRef.current) return;
    initializedRef.current = true;
    if (size.width >= 600) {
      const zoom = Math.min(1.25, (size.width - 16) / GRAPH_BOUNDS.width, (size.height - 16) / GRAPH_BOUNDS.height);
      setViewport({
        x: (size.width - GRAPH_BOUNDS.width * zoom) / 2 - GRAPH_BOUNDS.x * zoom,
        y: (size.height - GRAPH_BOUNDS.height * zoom) / 2 - GRAPH_BOUNDS.y * zoom,
        zoom,
      }, { duration: 0 });
    } else {
      setViewport({ x: 14, y: 38, zoom: Math.min(0.82, (size.width - 28) / (NODE_WIDTH * 2 + 16)) }, { duration: 0 });
    }
  }, [flowReady, setViewport, size.height, size.width]);

  useEffect(() => {
    if (!initializedRef.current || !selectedId || size.width >= 720) return;
    focusStage(selectedId, { duration: 0 });
  }, [focusStage, selectedId, size.height, size.width]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => popoverRef.current?.focus?.(), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  useEffect(() => {
    const button = document.querySelector("[data-about-trigger]");
    if (!button) return undefined;
    button.addEventListener("click", openAbout);
    return () => button.removeEventListener("click", openAbout);
  }, [openAbout]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (aboutOpen) {
        closeAbout();
        return;
      }
      if (selectedId) closeSelection();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, closeAbout, closeSelection, selectedId]);

  apiRef.current = {
    selectStage,
    openAbout,
    closeAbout,
    fit: () => fitView({ padding: 0.08, minZoom: 0.2, maxZoom: 1.25, duration: 0 }),
    getState: () => ({ selectedId, aboutOpen, zoom, viewport }),
  };

  useEffect(() => {
    window.SIDAFeatureFlow = {
      selectStage: (id) => apiRef.current.selectStage(id),
      openAbout: () => apiRef.current.openAbout(),
      closeAbout: () => apiRef.current.closeAbout(),
      fit: () => apiRef.current.fit(),
      getState: () => apiRef.current.getState(),
    };
    window.dispatchEvent(new CustomEvent("sida:feature-flow-ready"));
    return () => {
      delete window.SIDAFeatureFlow;
    };
  }, []);

  const popupWidth = Math.min(440, Math.max(260, size.width - 24));
  let popupLeft = 0;
  let popupTop = 0;
  let popupArrowX = 0;
  let popupPlacement = "below";
  let popupMaxHeight = Math.max(200, size.height - 24);
  if (selectedStage && size.width > 0) {
    const nodeCenterX = (selectedStage.position.x + NODE_WIDTH / 2) * viewport.zoom + viewport.x;
    const nodeTop = selectedStage.position.y * viewport.zoom + viewport.y;
    const nodeBottom = (selectedStage.position.y + NODE_HEIGHT) * viewport.zoom + viewport.y;
    popupLeft = Math.max(12, Math.min(nodeCenterX - popupWidth / 2, size.width - popupWidth - 12));
    const need = Math.min(popoverHeight, 360);
    const roomBelow = size.height - (nodeBottom + 10) - 12;
    const roomAbove = nodeTop - 22;
    if (roomBelow < need && roomAbove >= need) {
      popupPlacement = "above";
      popupTop = Math.max(12, nodeTop - 10 - popoverHeight);
      popupMaxHeight = Math.max(180, nodeTop - 10 - popupTop);
    } else {
      popupTop = Math.max(12, Math.min(nodeBottom + 10, size.height - 244));
      popupMaxHeight = Math.max(200, size.height - popupTop - 12);
    }
    popupArrowX = Math.max(18, Math.min(nodeCenterX - popupLeft, popupWidth - 18));
  }

  return (
    <div className="sff-canvas" ref={hostRef} data-feature-flow-canvas="">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          const initial = instance.getViewport();
          setViewportState(initial);
          setZoom(initial.zoom);
          setFlowReady(true);
        }}
        onNodeClick={(event, node) => {
          returnFocusRef.current = event.target?.closest?.(".react-flow__node") ?? null;
          selectStage(node.id);
        }}
        onPaneClick={() => {
          setAboutOpen(false);
          closeSelection();
        }}
        onMove={(_, next) => {
          setViewportState(next);
          setZoom(next.zoom);
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.6}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        aria-label="SIDA construction project workflow"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.3}
          color="rgba(146,182,238,.20)"
          className="sff-dot-grid"
        />
      </ReactFlow>

      <p className="sff-hint">
        Select a stage for detail <span aria-hidden="true">·</span> drag to pan <span aria-hidden="true">·</span> scroll to zoom
      </p>

      <div className="sff-zoom" role="group" aria-label="Canvas zoom">
        <button type="button" onClick={() => zoomOut({ duration: prefersReducedMotion() ? 0 : 160 })} aria-label="Zoom out">
          <MinusIcon />
        </button>
        <button
          type="button"
          className="sff-zoom__value"
          onClick={() => fitView({ padding: 0.08, minZoom: 0.2, maxZoom: 1.25, duration: prefersReducedMotion() ? 0 : 320 })}
          title="Fit the whole graph"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomIn({ duration: prefersReducedMotion() ? 0 : 160 })} aria-label="Zoom in">
          <PlusIcon />
        </button>
        <span className="sff-zoom__divider" aria-hidden="true" />
        <button
          type="button"
          onClick={() => fitView({ padding: 0.08, minZoom: 0.2, maxZoom: 1.25, duration: prefersReducedMotion() ? 0 : 320 })}
          aria-label="Fit to view"
          title="Fit to view"
        >
          <FitIcon />
        </button>
      </div>

      {selectedStage ? (
        <StagePopover
          key={selectedStage.id}
          stage={selectedStage}
          panelRef={popoverRef}
          placement={popupPlacement}
          onClose={closeSelection}
          onSelect={selectStage}
          style={{
            width: popupWidth,
            left: popupLeft,
            top: popupTop,
            maxHeight: popupMaxHeight,
          }}
          arrowX={popupArrowX}
        />
      ) : null}

      {aboutOpen ? <AboutPanel onClose={closeAbout} /> : null}

      <div className="sff-live" aria-live="polite">
        {selectedStage ? `Selected ${selectedStage.title}` : ""}
      </div>
    </div>
  );
}

function FeatureFlow() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}

const mounted = new WeakMap();

export function mount(target) {
  const host = typeof target === "string" ? document.querySelector(target) : target;
  if (!host) return null;
  if (mounted.has(host)) return mounted.get(host);
  const root = createRoot(host);
  mounted.set(host, root);
  root.render(<FeatureFlow />);
  return root;
}

function mountAll() {
  document.querySelectorAll("[data-sida-feature-flow]").forEach((host) => mount(host));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll, { once: true });
} else {
  mountAll();
}
