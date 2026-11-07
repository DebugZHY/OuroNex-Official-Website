# SIDA interactive workspace

The homepage at `index.html#home` contains the current three-stage SIDA workspace sample:
Welcome, a prepared workflow with approximately six seconds of playback, and the SODA result tab.

For local viewing, run `python -m http.server 8123` from the repository root and
open `http://127.0.0.1:8123/index.html#home`.

The workspace presents a six-step steel frame optimisation. Nodes, ports and edges share one React Flow viewport and retain fixed coordinates when the host or panels resize. The canvas fills the available centre panel. The project rail starts with one task and the inert `project information` folder. Expert portraits and animations share their source with Multidisciplinary Experts. Each card places its Expert on the left and tools on the right, above the status line. Project Router is a separate card. The unlabelled stage dots outside and below the frame unlock as the visitor progresses: one initially, two after New Project finishes opening, and three only after a completed result is opened. Reached dots remain available for the current session; reloading starts with one. The first dot resets the project, while the Welcome tab preserves it.

The shell uses CSS grid and container queries. Side panels become independent drawers on narrow containers; phone layouts keep nodes readable and allow graph panning. Accept and Start triggers discrete progress updates, complete short Router messages and stage folders. Completion shows Task completed and Check Result, with Frame-model-v2.dat in both Files and the Router attachment.

All three result links open SODA after Apps inside the same frame and hide both side panels. The light viewport displays the prebaked MGM Skylight model with element extrusion, a tall list of section-type glyphs, aligned model information, original toolbar icons and an axis gizmo. Fixed Z-Axis rotation, pan, zoom, projection switching and view history work locally. The source DAT and solver are not loaded by the webpage.

The entry loads `ui/embed.js` and `ui/embed.css`; Flow, the Welcome brand renderer and SODA are lazy bundles. The model uses native gzip decompression when available, with a raw GLB fallback and cached bytes for repeat visits. The displayed account and project are sample data; messages stay in memory. Source, build commands and the public instance API are documented in `../tools/workflow-embed/README.md`.
