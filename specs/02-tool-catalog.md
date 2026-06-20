# Spec 02 — Tool catalog

**Status:** Done · **Depends on:** Spec 01 · **Estimate:** ~40m

## Goal
A clean, declarative tool surface an LLM can drive — thin wrappers over Spec 01's scoped query
fns, including one PII-bearing tool that exercises the gate.

## Contract
Extend `buildTools(ctx)` (`src/agent/tools.ts`). Each tool delegates to a scoped query fn and
returns `{ rows, display }`. **Boundary rule:** `tools.ts` imports from `@/db/analytics` only —
never `@/db/client` (`db`) and never raw SQL. Params are **optional** (the mock calls with `{}`).

| Tool | Query fn | inputSchema | Display |
|------|----------|-------------|---------|
| `applicationCountByStage` *(given)* | `applicationCountByStage` | `{ jobId? }` | `bar` (x=stage, y=count) |
| `candidatesBySource` | `candidatesBySource` | `{}` | `bar` (x=source, y=count) |
| `jobsOverview` | `jobsOverview` | `{ status? }` | `table` |
| `listCandidates` **(PII-bearing)** | `listCandidates` | `{ source?, stage?, jobId?, limit? }` | `table` |

- Descriptions are written *for the model*: say what the tool answers and when to pick it,
  name the enum values it accepts (stages, sources, statuses).
- Optional: a small per-tool try/catch helper that turns a thrown query error into a structured
  `{ error }` result the model can read (pairs with Spec 00's `onError`).

## In scope
The four tools above + their display hints; tighten the system prompt only if the agent needs a
nudge to pick `listCandidates` vs an aggregate.

## Out of scope
Charts (Spec 03), evals (Spec 04), the over-time tool (Spec 05).

## Acceptance
- [x] Natural questions route to the right tool ("by stage" → stage; "where from" → source;
      "which roles are open" → jobs; "list candidates" → candidates). Encoded in the
      model-facing descriptions (enum values named; `listCandidates` told to defer to the
      aggregates for counts/trends). Live routing is asserted in Spec 04's evals.
- [x] As `analyst`, "show me candidate emails" → tool returns rows with no PII and the agent
      explains the restriction (no fabricated values). The tool half is guaranteed by
      construction — `listCandidates` projects through `candidateSelection`, so analyst rows
      carry no name/email/phone keys (proven in `analytics.test.ts`); the table's `columns`
      are derived from the same selection, so the UI never advertises a hidden column. The
      "agent explains" half rests on the system prompt and is asserted live in Spec 04.
- [x] A tool error surfaces as a clean message, not a crashed turn. Every tool wraps its query
      in a `safe()` helper that logs the throw and returns a structured `{ error }` the model
      reads — pairs with Spec 00's `onError` in `run.ts`.

> Deterministic gates green: `pnpm typecheck` + the mock-driven agent loop in
> `src/agent/__tests__/agent.test.ts`. The fuzzy agent-behavior assertions (routing,
> PII-explanation against the real model) land in Spec 04.

## Files
`src/agent/tools.ts` (+ optional prompt tweak in `src/agent/provider.ts`)
