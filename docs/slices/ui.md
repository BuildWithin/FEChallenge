# UI slice

Generative UI for tool results. Read this before editing
[src/app/page.tsx](../../src/app/page.tsx).

## Goal

Each tool result is `{ rows, display }`. Render one component per result, keyed off
`display.kind`, **while the agent streams**. The current `ToolCall` / `RowsTable`
is a deliberate stub (everything renders as a table); replace it with real
generative UI you'd ship.

## Constraints

- **No charting library.** Hand-roll SVG for `bar` and `line`. A `<table>` for
  `table`. This keeps the dependency surface small and the rendering legible.
- Switch on `display.kind`:
  - `table` → render `display.columns` as headers, `rows` as cells.
  - `bar` → SVG bars; category axis from `display.x`, value from `display.y`,
    heading from `display.title`.
  - `line` → SVG polyline; `display.x` (often a date bucket) on the x-axis,
    `display.y` on the y-axis, heading from `display.title`.
- Render against the streaming tool-part lifecycle. A tool part moves through
  states; today the page reads `state === "output-available"` (done) and
  `state === "output-error"` (errored), with a `· calling…` placeholder otherwise.
  Keep that **calling → result** transition visible, and handle:
  - **empty** results (`rows.length === 0`) — a clear "no data" state, not a broken
    chart.
  - **error** results — show `errorText`, don't crash the conversation.

## Notes

- Values can be `unknown` / `bigint`-ish counts (Drizzle `count()`); coerce safely
  for display (the stub uses `String(...)` / `Number(...)`).
- The right-hand side panel already shows a reference scoped tRPC read
  (`analytics.applicationsByStage`); the new work is the in-conversation tool
  rendering, not the panel.
- PII gating happens upstream in the query layer — for an `analyst`, PII columns
  simply aren't in `rows`. The UI renders whatever columns it's given and must not
  reintroduce PII (e.g. don't hardcode a "Name" column).
