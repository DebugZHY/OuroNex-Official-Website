# Engineering workflows

Four compact, illustrative engineering workflows for the Solutions section:
Project Planning, Design Optimization, Tendering and BIM Modelling.

## Build

From the repository root:

```sh
node tools/application-flow/build.mjs
```

The build reuses `tools/workflow-embed/node_modules` through `createRequire` (esbuild, PostCSS,
Preact and React Flow). It writes only:

- `workflow-stages/features/application-assets/app-flow.js`
- `workflow-stages/features/application-assets/app-flow.css`

App icons are referenced directly from `workflow-stages/features/flow-assets/apps/`, the same
catalogue used by Professional Tools; the build does not duplicate them.

No manifest or package file is written. The iframe entry is
`workflow-stages/features/application-workflows.html`.

Each service has its own desktop and narrow-screen layout in `src/layout.js`. Primary dependencies
determine a fixed presentation: the single starting task is amber, intermediate tasks are green and
completed, and the final task is blue and running. Feedback paths illustrate engineering revision
without changing those states. There are no playback controls or timed status changes.

Every task opens an engineering description and a named output. App icons retain accessible names and
hover titles. Expert roles are assigned through `EXPERTS` in `src/data.js`; cards and detail panels
render the existing SVG portraits from `workflow-stages/features/flow-assets/experts/`, with the expert
name preserved as the accessible label and hover title.
Decorative edge and running-state animations pause offscreen and respect reduced motion.
