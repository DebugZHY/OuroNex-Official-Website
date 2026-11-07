/* Explicit graph geometry for each service. Positions are card top-left coordinates in the
   layout canvas; routes carry the handles and any waypoints the runtime should draw through. */

const DESKTOP = { width: 196, height: 132 };
const MOBILE = { width: 160, height: 136 };

const route = (sourceHandle, targetHandle, via, label) => ({
  sourceHandle,
  targetHandle,
  ...(via ? { via } : {}),
  ...(label ? { label } : {}),
});

const LAYOUTS = {
  planning: {
    desktop: {
      positions: {
        '01-brief': { x: 0, y: 82 },
        '02-codes': { x: 232, y: 0 },
        '03-model': { x: 232, y: 164 },
        '04-reconcile': { x: 464, y: 82 },
        '05-review': { x: 464, y: 328 },
        '06-output': { x: 232, y: 328 },
      },
      routes: {
        '01-brief->02-codes': route('s-right', 't-left'),
        '01-brief->03-model': route('s-right', 't-left'),
        '02-codes->03-model': route('s-bottom', 't-top'),
        '02-codes->04-reconcile': route('s-right', 't-left'),
        '03-model->04-reconcile': route('s-right', 't-left'),
        '04-reconcile->05-review': route('s-bottom', 't-top'),
        '05-review->06-output': route('s-left', 't-right'),
      },
    },
    mobile: {
      positions: {
        '01-brief': { x: 89, y: 0 },
        '02-codes': { x: 0, y: 168 },
        '03-model': { x: 178, y: 168 },
        '04-reconcile': { x: 178, y: 336 },
        '05-review': { x: 0, y: 504 },
        '06-output': { x: 178, y: 504 },
      },
      routes: {
        '01-brief->02-codes': route('s-bottom', 't-top'),
        '01-brief->03-model': route('s-bottom', 't-top'),
        '02-codes->03-model': route('s-right', 't-left'),
        '02-codes->04-reconcile': route('s-bottom', 't-left', [{ x: 80, y: 404 }]),
        '03-model->04-reconcile': route('s-bottom', 't-top'),
        '04-reconcile->05-review': route('s-bottom', 't-top'),
        '05-review->06-output': route('s-right', 't-left'),
      },
    },
  },
  optimization: {
    desktop: {
      positions: {
        '01-baseline': { x: 0, y: 0 },
        '03-envelopes': { x: 232, y: 0 },
        '02-sections': { x: 464, y: 0 },
        '04-checks': { x: 464, y: 204 },
        '05-review': { x: 232, y: 204 },
        '06-output': { x: 0, y: 204 },
      },
      routes: {
        '01-baseline->03-envelopes': route('s-right', 't-left'),
        '03-envelopes->02-sections': route('s-right', 't-left'),
        '02-sections->04-checks': route('s-bottom', 't-top'),
        '04-checks->05-review': route('s-left', 't-right'),
        '05-review->06-output': route('s-left', 't-right'),
        '04-checks->02-sections': route('s-right', 't-right', [{ x: 696, y: 270 }, { x: 696, y: 66 }]),
      },
    },
    mobile: {
      positions: {
        '01-baseline': { x: 0, y: 0 },
        '03-envelopes': { x: 178, y: 0 },
        '02-sections': { x: 178, y: 168 },
        '04-checks': { x: 178, y: 336 },
        '05-review': { x: 0, y: 336 },
        '06-output': { x: 0, y: 168 },
      },
      routes: {
        '01-baseline->03-envelopes': route('s-right', 't-left'),
        '03-envelopes->02-sections': route('s-bottom', 't-top'),
        '02-sections->04-checks': route('s-bottom', 't-top'),
        '04-checks->05-review': route('s-left', 't-right'),
        '05-review->06-output': route('s-top', 't-bottom'),
        '04-checks->02-sections': route('s-right', 't-right', [{ x: 354, y: 404 }, { x: 354, y: 236 }]),
      },
    },
  },
  tendering: {
    desktop: {
      positions: {
        '01-frozen': { x: 0, y: 0 },
        '02-quantities': { x: 272, y: 0 },
        '03-compliance': { x: 0, y: 164 },
        '04-reconcile': { x: 272, y: 164 },
        '05-approval': { x: 272, y: 328 },
        '06-output': { x: 0, y: 328 },
      },
      routes: {
        '01-frozen->02-quantities': route('s-right', 't-left'),
        '01-frozen->03-compliance': route('s-bottom', 't-top'),
        '02-quantities->04-reconcile': route('s-bottom', 't-top'),
        '03-compliance->04-reconcile': route('s-right', 't-left'),
        '04-reconcile->05-approval': route('s-bottom', 't-top'),
        '05-approval->06-output': route('s-left', 't-right'),
      },
    },
    mobile: {
      positions: {
        '01-frozen': { x: 0, y: 0 },
        '02-quantities': { x: 178, y: 0 },
        '03-compliance': { x: 0, y: 168 },
        '04-reconcile': { x: 178, y: 168 },
        '05-approval': { x: 178, y: 336 },
        '06-output': { x: 0, y: 336 },
      },
      routes: {
        '01-frozen->02-quantities': route('s-right', 't-left'),
        '01-frozen->03-compliance': route('s-bottom', 't-top'),
        '02-quantities->04-reconcile': route('s-bottom', 't-top'),
        '03-compliance->04-reconcile': route('s-right', 't-left'),
        '04-reconcile->05-approval': route('s-bottom', 't-top'),
        '05-approval->06-output': route('s-left', 't-right'),
      },
    },
  },
  bim: {
    desktop: {
      positions: {
        '01-approved': { x: 0, y: 0 },
        '02-geometry': { x: 232, y: 0 },
        '03-properties': { x: 232, y: 164 },
        '04-validation': { x: 464, y: 164 },
        '05-review': { x: 232, y: 328 },
        '06-output': { x: 464, y: 328 },
      },
      routes: {
        '01-approved->02-geometry': route('s-right', 't-left'),
        '02-geometry->03-properties': route('s-bottom', 't-top'),
        '03-properties->04-validation': route('s-right', 't-left'),
        '03-properties->05-review': route('s-bottom', 't-top'),
        '04-validation->05-review': route('s-bottom', 't-top'),
        '05-review->06-output': route('s-right', 't-left'),
      },
    },
    mobile: {
      positions: {
        '01-approved': { x: 0, y: 0 },
        '02-geometry': { x: 0, y: 168 },
        '03-properties': { x: 0, y: 336 },
        '04-validation': { x: 178, y: 336 },
        '05-review': { x: 178, y: 168 },
        '06-output': { x: 178, y: 0 },
      },
      routes: {
        '01-approved->02-geometry': route('s-bottom', 't-top'),
        '02-geometry->03-properties': route('s-bottom', 't-top'),
        '03-properties->04-validation': route('s-right', 't-left'),
        '03-properties->05-review': route('s-right', 't-left', [{ x: 169, y: 404 }, { x: 169, y: 236 }]),
        '04-validation->05-review': route('s-top', 't-bottom'),
        '05-review->06-output': route('s-top', 't-bottom'),
      },
    },
  },
};

export function layoutFor(service, width) {
  const entry = LAYOUTS[service.id];
  if (!entry) throw new Error(`Unknown application workflow: ${service.id}`);
  const mobile = Number(width) < 560;
  const layout = mobile ? entry.mobile : entry.desktop;
  return {
    nodeSize: mobile ? { ...MOBILE } : { ...DESKTOP },
    positions: layout.positions,
    routes: layout.routes,
  };
}
