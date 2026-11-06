# SIDA workspace demo

An interactive website workbench with two states: an empty Welcome screen and a prepared sample
project. It renders Preact DOM, a lazy Three.js brand mark and a separately loaded React Flow canvas.
It uses local example data; no desktop service, account, provider or database is required.

The published host is `index.html#sida`. Its embed assets are served from
`workflow-stages/ui/`.

## Opening a project

Welcome starts with `No Project`, zero to-dos and empty project files. Its navy, cyan and indigo
lighting follows the website's CoP Hub HK and Multidisciplinary Experts panels. New Project is the
primary action. The product's 224 px brand box, 24 px heading, 14 px card radii and system UI type
remain the geometry reference from SIDA e77c74a3.

Click **New Project** to open `SIDA Project` in place:

- Welcome leaves, a short HTML/CSS project-opening animation appears, then Flow enters.
- The project rail contains six editable to-do checkboxes and five file roots. Selecting a to-do
  or an expanded file entry focuses its workflow stage.
- Flow contains nine prepared stages, nine dependencies, stage details, dragging, panning and zoom
  controls. The initial desktop view fits all stages. On phone widths the first stage stays readable
  and the graph can be panned or fitted with the controls.
- Welcome and Flow can be switched without losing the current to-do or graph state. Console and
  Apps remain inert. Chat/Project and the Supervisor toggle remain available.
- The Recent Projects entry opens the same prepared project.

Flow JS and CSS warm on intent and load once. Repeated opening clicks share one operation. A failed
load returns to Welcome with an inline retry message. Reduced motion skips the timed transition and
stage entrance animations. The brand mark pauses out of view and when the document is hidden.

## Responsive layout

The component uses container queries; the entire shell is never scaled with a transform.

| Host width | Layout |
|---|---|
| Above 1040 px | Project rail, centre workspace, optional Supervisor |
| 721–1040 px | Project rail and centre; Supervisor opens as a drawer |
| Up to 720 px | Centre and tabs; the Project icon opens the to-do/file drawer |

The phone Supervisor button remains outside the scrollable tab list. Short Welcome frames scroll
instead of reducing the original control and text sizes. Vendor Flow CSS is scoped to
`.sida-demo-embed` so the website's Business diagram keeps its own styles.

## Build

```sh
cd tools/workflow-embed
npm ci
npm run build
node sync-manifest.mjs
```

The manifest sync includes the homepage CSS, entry bundles, lazy Flow bundles, brand renderer,
fallback PNG and existing GLB. The local file service requires matching manifest hashes and sizes.

| Output | Purpose | Approximate uncompressed size |
|---|---|---|
| `ui/embed.js` and `ui/embed.css` | Shell, Welcome, project state and transition | 54 KB / 24 KB |
| `ui/welcome-robot.js` | Lazy Three.js renderer | 617 KB |
| `ui/flow.js` and `ui/flow.css` | Lazy project workflow | 215 KB / 24 KB |
| `ui/sida-mark-*.png` | First-frame and no-WebGL fallback | 79 KB |
| `SIDA-Logo-3D/建造者机器人立体图标.glb` | Existing brand model | 5,781,844 bytes |

## Embed

The host needs a height; its width is fluid. Asset paths resolve relative to the entry script.

```html
<link rel="stylesheet" href="ui/embed.css">
<div data-sida-workflow style="height:740px"></div>
<script src="ui/embed.js"></script>
```

Every `[data-sida-workflow]` host mounts once. Multiple hosts keep separate state.

## Instance API

`window.SIDAWorkflowDemo.mount(hostOrSelector)` returns the instance or its existing instance.
Await `ready` before calling instance methods.

| Call | Effect |
|---|---|
| `ready` | Promise resolving after the initial render |
| `openProject()` | Promise resolving after the prepared project and transition are ready |
| `setTab('welcome' or 'flow')` | Switch view; Flow requires an open project |
| `selectStage(id)` | Focus a workflow stage in an open project |
| `toggleSupervisor()` | Show or hide the Supervisor panel |
| `getState()` | Current tab, panel, phase, transition, project, stages and to-dos |
| `reset()` | Restore empty Welcome and clear the sample project's changes |
| `destroy()` | Unmount and release observers, renderer and canvas |

The host emits `sida:workflow-ready` and `sida:workflow-change`. The canvas additionally exposes
`window.SIDAFlow.mount(el)` with `ready`, `selectStage`, `setStageStatus`, `setViewport`, `fit`,
`getState`, `reset` and `destroy`.

## Source

- `src/index.jsx`: lifecycle, project state and bundle orchestration.
- `src/shell.jsx`, `shell.css`: tabs, project navigation, to-do list, files and Supervisor.
- `src/welcome.jsx`, `welcome.css`: Welcome geometry, primary action and lighting.
- `src/project.css`: project entrance and responsive project drawer.
- `src/flow-loader.js`: shared lazy asset loading with retry.
- `src/model.js`: project, tasks, stages, dependencies and layout.
- `src/flow.jsx`, `styles.css`: canvas, stage cards, details and graph controls.
- `src/builder-robot.jsx`, `robot-renderer.js`: lazy brand renderer and cleanup.

Only the active embed assets are published; local preview pages and historical screenshot examples are excluded.

