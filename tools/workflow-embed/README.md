# SIDA workspace demo

An interactive website workbench with three stages: an empty Welcome screen, a sample workflow
with preparation and playback, and a SODA 3D deliverable viewer. It renders
Preact DOM, a lazy Three.js brand mark and a separately loaded React Flow canvas.
It uses local example data; no desktop service, account, provider or database is required.

The published host is `index.html#home`. Its embed assets are served from
`workflow-stages/ui/`.

## Opening a project

Welcome starts with `No Project`, no task and empty project files. Its navy, cyan and indigo
lighting follows the website's CoP Hub HK and Multidisciplinary Experts panels. New Project is the
primary action and carries a looping highlight — a breathing rim, a sheen sweep and a pulsing icon —
that is removed as soon as the sample project opens. The product's 224 px brand box, 24 px heading,
14 px card radii and system UI type remain the geometry reference from SIDA e77c74a3.

The Welcome GLB receives ambient and hemisphere lighting plus a locally generated 64-pixel
room environment. This lights the clearcoat and metal surfaces on the backplate without an
additional image request. The temporary environment scene and its render target are disposed.
Hovering the mark pauses its idle sway at the current pose. Pointer dragging rotates it directly;
leaving the mark resumes the gentle sway without resetting the chosen orientation. Dragging remains
available with reduced motion, while automatic movement stays disabled.

Click **New Project** to open `Steel Frame Design Optimization` in place:

- Welcome leaves, a short HTML/CSS project-opening animation appears, then Flow enters.
- The project rail starts with one task, `Complete the steel frame optimisation`, and one folder,
  `project information`. Folders are inert and cannot expand. Sidebar and Router each control
  their own panel; Project Router is a sibling card of the centre workspace in every stage.
  When the prepared Flow enters on a canvas wide enough for that sibling card, Router opens in
  the same 480ms layout transition: its track grows while the centre track gives up the width,
  so the 8px gutter stays fixed; below that width it stays closed.
- Flow shows six stages of a steel frame optimisation — read the references, query the code, build
  the model, analyse, optimise, hand over the optimised model — with one feedback loop from
  optimisation back into analysis. Every stage starts as `Not started`; the first card carries the
  amber start treatment. A floating **Accept and Start** action sits at the bottom of the canvas as
  the control for playback within the second stage.
- Welcome, Flow and an opened SODA tab can be switched without losing the current task, graph or
  camera state. Returning to Welcome does not highlight New Project or reset the walkthrough.
  The result adds a SODA tab after Apps. Console and Apps remain demonstration tabs.
- The Recent Projects entry opens the same prepared project.
- New Chat switches the left sidebar to Chat, revealing its drawer on narrow screens. Open Folder
  remains an inert demonstration control. Neither action shows a notification label.

## Workflow playback

**Accept and Start** runs the local demonstration model once, completing in approximately six
seconds. Task progress changes at stage boundaries. Project Router inserts complete short messages
in bursts, without typing characters or continuously interpolating progress.
The sequence reads references, looks up code requirements, builds the frame, analyses and optimises
it, repeats analysis and optimisation with the revised sections, then delivers the optimised model.
The feedback edge is highlighted during reanalysis. Every completed stage adds a short folder name
to Files. Completed stages show checkmarks; the final strip contains only **Task completed** and
**Check Result**. Files and the final Router message both contain `Frame-model-v2.dat`.

Cards place their Expert portrait on the left and every assigned tool on the right of one resource
row, above the final status line. The artwork and motion share their source with Multidisciplinary
Experts. Idle portraits are translucent and still; running and completed portraits are opaque and animate.
Reduced motion preserves their state while stopping decorative movement. Solutions uses the same
Expert portraits within its four separate engineering workflows.

The timing and output are scripted examples, not solver results. One cancellable playback clock
drives the Task, graph and transcript. Repeated Start presses are ignored; Replay clears the prior
run, and reset/destroy cancel pending callbacks. Dot buttons below and outside the application frame
unlock progressively: only Welcome is visible initially, Flow unlocks after the New Project
transition finishes, and SODA unlocks when a result link is opened after playback. Future dots are
absent; keyboard navigation and the stage API stay within the unlocked range. Reached stages remain
available for the mounted session, including after a project reset; reloading starts with one dot.
The controls have accessible names but no visible labels or tooltips. The selected dot becomes a
line. Selecting a stage restores that stage's initial state,
including the camera and panel controls on the result stage. Only the first dot fully resets the
project and restores the New Project highlight.

Flow JS and CSS warm on intent and load once. Repeated opening clicks share one operation. A failed
load returns to Welcome with an inline retry message. Reduced motion skips the timed transition and
stage entrance animations. The brand mark pauses out of view and when the document is hidden.

## Model deliverable

The Files item, **Check Result**, and the Router attachment all open the same SODA tab after Apps.
Only the centre page changes. Both side panels close and their controls become unchecked.

The light viewport has a compact dark toolbar with projection, Pan, Rotate, zoom and Fit
controls, with the filename at the far right. Its buttons use pressed states without slider tracks;
Selection and Undo/Redo buttons are omitted. The matching dark Model Explorer on the left contains Material,
Section, Node, Element and Area.
Only Material and Section expand. Their selectable children highlight matching model members;
selecting the same child again or clicking blank canvas clears the highlight. Clicking an actual
member, dragging, cancelled gestures and two-finger input preserve selection. Each material row
shows an S inside a square frame. Section contains only the 33 sections in use; rows show the
section designation only (for example L40x3 or 2L180x14), without the source grade prefix or
copied-section suffix, with their actual section-type glyphs. Node (945) and Element (1423) report the model counts.
The axis gizmo sits at the bottom right, with no wordmark or bottom information bar.
A softly lit backdrop surrounds a world-space floor with a fading major/minor grid and soft cast
shadows below the model. The environment follows the same orbit, pan and projection as the structure;
it fades away below the floor and becomes quieter during highlighting. Grid and shadow helpers remain
outside member picking, so clicking them still clears selection. Their resources are disposed with
the viewer, and the static environment adds no continuous animation. Views and Light Source are omitted. Drag to rotate
in SODA's fixed Z-Axis mode, shift-drag or use Pan mode to translate, and use the wheel/buttons to zoom.
Two-finger gestures combine pan and zoom. Orthographic and perspective buttons switch real cameras;
Fit recentres a panned model. Internal camera history remains available to the existing keyboard handlers.

The source is `Transmission Tower.json`; the displayed deliverable name is `Frame-model-v2.dat`.
Its 945 nodes and 1,423 members use all 33 source section definitions, baked using SODA's
JSON section-geometry data and extrusion geometry. Every member is extruded, so no centre-line
fallback remains. The structural model contains Element geometry only: 34,212 triangles with
section-coloured outlines. It preserves original coordinates, beta angles and colours.
Node markers, supports, loads, labels and analysis results are absent. The geometry is the supplied
example; the scripted workflow does not perform structural optimisation.

Material presents the source Q235, Q345 and Q420 groups. Q235 highlights its 100 original
members, Q345 highlights 952 members and Q420 highlights 371 members.
Original material IDs and member assignments remain intact in the model metadata. Selecting a
material or section changes the model highlight without changing the camera.

Runtime loads a compact section/counts JSON and a losslessly compressed GLB only on entering SODA.
The gzip payload is 687,642 bytes, versus 2,499,324 bytes for the uncompressed GLB. Native browser
decompression avoids an additional decoder dependency; browsers without that API use the raw GLB.
Decoded bytes are cached for repeat visits. Full conversion proof stays outside the published package.

Rebuild the static model from the repository root:

```sh
node tools/workflow-embed/prepare-model.mjs "path/to/model.json"
```

The converter uses the bundled SODA source at `D:/Development/SIDA/apps/soda-app/dist/source`;
set `SODA_SOURCE_ROOT` to use another checkout. The website needs neither this source tree nor the DAT.
The renderer loads on demand, fits the complete model at the current aspect ratio, and renders only
when loaded, resized or dragged. Closing/resetting disposes its WebGL resources and ignores late loads.

## Responsive layout

The component uses container queries; the entire shell is never scaled with a transform.

| Host width | Layout |
|---|---|
| Above 1040 px | Project rail, centre workspace, optional Supervisor |
| 800–1040 px | Compact independent columns whenever the Supervisor is open |
| 721–799 px | Project rail and centre; Supervisor opens as a drawer |
| Up to 720 px | Centre and tabs; the Sidebar control opens the chat/task/file drawer |

The phone Supervisor button remains outside the scrollable tab list. Short Welcome frames scroll
instead of reducing the original control and text sizes. Vendor Flow CSS is scoped to
`.sida-demo-embed` so the website's Business diagram keeps its own styles.

Workflow nodes retain fixed coordinates and the same viewport when a panel opens or the host resizes.
The initial desktop fit reserves both side panels and the full feedback-label width; the actual
canvas always fills the centre panel. Explicit Fit uses the currently available canvas space.
Narrow screens can pan the graph. Model Explorer can collapse on narrow SODA viewports and reopen
from its title control. The toolbar buttons remain in one horizontally scrollable row beside the
filename. The tree scrolls independently of the model viewport.

## Build

```sh
cd tools/workflow-embed
npm ci
npm run build
node sync-manifest.mjs
```

The manifest sync includes the homepage CSS, entry bundles, lazy Flow bundles, brand renderer,
fallback PNG, brand GLB, lazy SODA viewer and static model assets. The local file service requires matching manifest hashes and sizes.

| Output | Purpose | Approximate uncompressed size |
|---|---|---|
| `ui/embed.js` and `ui/embed.css` | Shell, Welcome, project state, playback and transition | 70 KB / 38 KB |
| `ui/welcome-robot.js` | Lazy Three.js renderer | 617 KB |
| `ui/flow.js` and `ui/flow.css` | Lazy project workflow | 225 KB / 35 KB |
| `ui/soda-viewer.js` and `ui/soda-viewer.css` | Lazy SODA 3D View | 659 KB / 7 KB |
| `models/transmission-tower.glb.gz` | Default lossless geometry transfer | 0.69 MB |
| `models/transmission-tower.glb` | Uncompressed fallback | 2.5 MB |
| `models/transmission-tower.meta.json` | Bounds, counts, provenance and section list | 4 KB |
| `ui/soda-icons/` | Original SODA toolbar icons | Local image assets |
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
| `selectDemoStage(1..3)` | Reset and enter a reached stage; returns false for a stage not yet unlocked |
| `setTab('welcome', 'flow' or 'soda')` | Switch view; Flow requires a project, SODA requires completed playback |
| `selectStage(id)` | Focus a workflow stage in an open project |
| `toggleSupervisor()` | Show or hide Project Router; the existing API name is retained |
| `toggleRail()` | Show or hide the project rail |
| `startPlayback()` | Start the prepared workflow once; returns false while opening or already started |
| `replay()` | Restart a completed workflow with an empty transcript |
| `openDeliverables()` | Open the completed model in the SODA tab; returns false until playback completes |
| `closeDeliverables()` | Close the model and restore the completed workflow |
| `getState()` | Current tab, panels, rail mode, project, stages, Task, playback and `maxUnlockedStage` snapshot |
| `reset()` | Restore empty Welcome and clear the sample project's changes |
| `destroy()` | Unmount and release observers, renderer and canvas |

The host emits `sida:workflow-ready` and `sida:workflow-change`; the canvas emits `sida:accept-start`
when **Accept and Start** is pressed, and `mount(el, { onAcceptStart })` receives the same signal. The
canvas additionally exposes `window.SIDAFlow.mount(el)` with `ready`, `selectStage`, `setStageStatus`,
`setViewport`, `fit`, `getState`, `reset` and `destroy`. Its `setPlayback(snapshot)` method applies
bulk stage states, active edge, progress and execution state. The `onReplay` callback delegates
restart to the workspace's clock.

## Source

- `src/index.jsx`: lifecycle, project state and bundle orchestration.
- `src/shell.jsx`, `shell.css`: tabs, project navigation, task list, files, rail and Router toggles.
- `src/welcome.jsx`, `welcome.css`: Welcome geometry, primary action and lighting.
- `src/project.css`: project entrance and responsive project drawer.
- `src/flow-loader.js`: shared lazy asset loading with retry.
- `src/soda-loader.js`: lazy model viewer loading and static asset URLs.
- `src/soda-viewer.jsx`, `soda-viewer.css`, `soda-renderer.js`: minimal SODA window and quaternion orbit renderer.
- `prepare-model.mjs`: offline NIDA-to-GLB conversion using the bundled SODA reader and extrusion code.
- `src/model.js`: project, tasks, stages, dependencies and layout.
- `src/playback.js`: six-second execution script, complete message snapshots and cancellable clock.
- `src/flow.jsx`, `styles.css`: canvas, stage cards, details and graph controls.
- `src/builder-robot.jsx`, `robot-renderer.js`: lazy brand renderer and cleanup.

Only the active embed assets are published; local preview pages and historical screenshot examples are excluded.

