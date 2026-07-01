# Decisions

## Overview

Multi-tenant ATS analytics copilot: scoped recruiting queries, an AI agent with
seven tools, Evalite security benchmarks, and a chat UI that renders tool results
as bar/line charts or role-aware tables. Mock model boots keyless; real model
(OpenAI `gpt-4o-mini` in dev) drives the demo. Generative UI uses inline SVG /
CSS bars — no charting library.

## Architecture & key decisions

- **Tool catalog** — Seven tools, one question each (`applicationCountByStage`,
  `candidatesBySource`, `applicationsOverTime`, `jobsByStatus`, `openJobs`,
  `timeInFunnel`, `listCandidates`). All inputs optional so the offline mock can
  call with `{}`. Each returns `{ rows, display }` with a `table` / `bar` / `line`
  hint; the UI dispatches on `display.kind` with no per-tool React code.

- **Query layer** — Composable functions in `src/db/analytics.ts`, all taking
  `ctx: { workspaceId, role }` first. Filters funnel through `scopeWhere`; row-level
  candidate reads use `candidateColumns(role)`.

- **Tenant scoping** — `scopeWhere(workspaceId, …extra)` is the single choke point
  for workspace isolation. Documented invariant: every new query must use it. Evalite
  compares tool row ids against the other workspace’s seeded entities.

- **Permissions** — PII is **unrepresentable** for analysts: `candidateColumns`
  never SELECTs name/email/phone. `assertCanReadPII` guards explicit PII paths.
  No post-filtering that could leak if a column is forgotten.

- **Generative UI** — `ToolResult` switches on `display.kind`. Bar charts use
  horizontal CSS bars; line charts use SVG polylines. `Number()` coercion at the
  render edge handles PGlite string counts. Internal columns (`id`, `workspaceId`)
  are hidden from tables.

## Model & agent

- **Provider:** OpenAI `gpt-4o-mini` via `AI_PROVIDER=openai` for demos; mock
  default for CI/evals (`pnpm eval`). Gateway supported via `AI_GATEWAY_BASE_URL`
  on anthropic/openai providers. Chose mini for cost/latency on a tool-heavy loop;
  quality sufficient for scoped analytics + list summarization.

- **Loop:** Vercel AI SDK `streamText` with `stepCountIs(6)`, tools from
  `buildTools(ctx)`, role/workspace baked into system prompt and tool context.
  Tool errors surface as `output-error` in the UI.

## Benchmarks

Evalite (`evals/copilot.eval.ts`, 11 cases): tenant isolation asserts no foreign
`workspaceId` or entity ids in tool rows; permission evals run as `analyst` and
fail on any name/email/phone column or seed contact string in rows. Scorers inspect
tool output rows, not model prose — breaking scope or PII gating turns evals red.

## Trade-offs & cuts

- No Recharts/Victory — SVG/Tailwind only; good enough for categorical counts
  and a weekly series.
- tRPC mirrors only two analytics endpoints; the agent is the primary consumer.
- No LLM-as-judge answer-quality eval (deterministic security evals prioritized).
- No typed structured answer artifact (stretch); prose + `display` hints suffice.
- With another day: richer charts, answer-quality evals, gateway in CI, resumable
  streams.

## Working with the agent

- **Delegated:** Boilerplate query/tool wiring, Evalite scorer scaffolding, chart
  markup, seed fixtures, test stubs.
- **Caught wrong:** Static prompt said “never expose PII” without role → model
  refused contacts for admin/recruiter; fixed with `buildSystemPrompt(role)`.
  Required tool params broke the mock; made inputs optional. Case-sensitive source
  filter returned empty Meridian lists; added `normalizeSource`. Identical seed PII
  across workspaces looked like a tenant leak; differentiated seed per slug.
- **Never delegated:** `scopeWhere` / `candidateColumns` contract, what counts as
  PII, eval assertions for isolation — reviewed and tested by hand.

## Hours

Roughly 4–5 hours across Phases 1–4 (security, tools, evals + real model, generative UI).
