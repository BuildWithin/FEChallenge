# Spec 03 — Generative UI

**Status:** Draft · **Depends on:** Spec 02 · **Estimate:** ~45m

> **Sequencing:** built **after Spec 04** (benchmarks). The adversarial evals validate the
> agent's tool-driving and guardrails first; this spec turns those proven tool results into UI.

## Goal
Turn tool results into real, streaming generative UI — charts and tables that feel shippable,
with deliberate loading/empty/error states.

## Contract
In `src/app/page.tsx`, replace the bare `RowsTable` stub with a dispatch on `display.kind`
(type from `src/agent/artifact.ts`):

```ts
function ToolArtifact({ output }: { output?: ToolResult }) // { rows, display }
// display.kind === "bar"  → <BarChart rows x={display.x} y={display.y} title={display.title} />
// display.kind === "table" → <DataTable rows columns={display.columns} />
// display.kind === "line"  → only built in Spec 05; until then, fall back to <DataTable/>
```

- **States:** `calling…` (skeleton/shimmer), `output-available` (render artifact),
  `output-error` (inline error). Make the transition feel intentional.
- **Empty:** a tool with zero rows shows a quiet "no data," not a broken chart.
- **Chart approach:** lightweight — hand-rolled SVG bars (zero deps) or a small lib. Decide by
  feel; don't over-install.

## In scope
`bar` + `table` renderers and the three states. `line` falls back to a table until Spec 05.

## Out of scope
Any display kind the catalog doesn't emit. No design-system overhaul.

## Acceptance
- [ ] A "by stage" answer renders a real bar chart from live tool output.
- [ ] `jobsOverview` / `listCandidates` render a readable table.
- [ ] Loading, empty, and error states each look deliberate.

## Files
`src/app/page.tsx` (+ small `BarChart` / `DataTable` components)
