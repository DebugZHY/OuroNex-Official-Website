# Feature flow — construction project workflow

Isolated React Flow build for `workflow-stages/features/complex-workflow.html`.

## Build

From the website repo root:

```sh
node tools/feature-flow/build.mjs
```

Outputs:

- `workflow-stages/features/flow-assets/flow.js`
- `workflow-stages/features/flow-assets/flow.css`

The build reuses `tools/workflow-embed/node_modules` (esbuild, postcss, Preact, `@xyflow/react` 12.3.5) through `createRequire`. It does not install dependencies, write to `tools/workflow-embed`, or touch `workflow-stages/ui`.

## What it draws

- One `@xyflow/react` viewport containing every node, handle, edge and arrowhead, arranged as a compact 4-column, 5-row overview.
- At desktop widths (>=720 px) the first paint fits the whole graph; below 720 px it opens on a readable partial overview centred on the current stage. No popup opens until a card is clicked.
- SIDA-style stage cards: ordinal + phase kicker, title, one-line summary, status icon in the header and status word + dependency count in the footer. Card colours and status vocabulary follow the real `StageNodeView.tsx` / flow-motion vocabulary.
- Detail popup anchored below the selected card, clamped inside the canvas, with purpose, inputs, outputs, source note, dependencies and feedback. Click another card/related chip to switch; click outside or Escape to dismiss.
- Scenario/sources panel from the header button.
- Pan/zoom/Fit and keyboard-focusable nodes.

## Scenario

Two-stage design & build, Hong Kong private new-build. Design Stages 0–4; contractor appointed during Stage 4; specialist subcontractor design integrated in late Stage 4 with Stage 4/5 overlap. Tender timing is drawn as a procurement branch, not a universal stage gate. GBP Stage I/II/III approval and consent to commence are separate steps. Statuses are illustrative.

## Source mapping

| Graph area | Source |
|---|---|
| Stage names, card structure, status vocabulary, 12px card radius, popover shape | SIDA source: `hosts/shell/components/workflow-flow/StageNodeView.tsx`, `StageInfoPopover.tsx`, `WorkflowCanvas.tsx`, `flow-motion.css` |
| Node/edge styling and canvas dot grid | `hosts/shell/app/globals.css` workflow-canvas block (scoped, website palette) |
| RIBA stages 0–7, briefing, concept/coordination, Stage 3 tender warning, Stage 4 specialist design, Stage 6–7 handover | RIBA Plan of Work 2020 Overview (official PDF linked below) |
| Pre-submission enquiry, Stage I/II/III GBP, approval vs consent, concurrent applications, 28-day rule, OP/TOP gate | PNAP ADM-19 Building Approval Process (official PDF linked below) §4, §6, §§14–19, §§33–39 |
| Works-specific supervision planning as a consent input | PNAP ADM-19 §34(d) (A&A/drainage/secondary-works concurrent route, not a universal new-build mandate); Technical Memorandum for Supervision Plans; Code of Practice for Site Supervision |
| BO s.16(3)(a), s.21(6)(a), B(A)R reg 32(3) | As cited in PNAP ADM-19 §14 and §39(c) |

## Corrections

- Replaced the previous `ADM-19 §19(d)` supervision-plan citation. §19 is about staged GBP submissions; §34(d) is the paragraph that mentions site supervision plans among possible consent supporting documents.
- Approval of plans and consent to commence are distinct. The graph shows Stage I/II approval, consent to commence superstructure and Stage III approval as separate nodes.
- The 28-day period in B(A)R reg 32(3) is shown as a conditional timing rule in the source note, not a promise of consent in 28 days.
- Tender/award is route-dependent and is not placed at a fixed RIBA stage.
- The graph follows a chosen staged-GBP route under ADM-19 §14; Stage II/III edges are scenario dependencies, not a universal sequence.
- OP/TOP is not equated with Practical Completion; completion evidence is route- and works-specific, and a TOP need not wait for full PC.

Official sources:

- RIBA Plan of Work 2020 Overview: <https://www.riba.org/media/syneeeto/2020ribaplanofworkoverviewpdf.pdf>
- PNAP ADM-19 Building Approval Process: <https://www.bd.gov.hk/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap/ADM/ADM019.pdf>
