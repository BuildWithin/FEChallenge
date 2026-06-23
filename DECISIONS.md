# Decisions

_Your write-up. Keep it brief — we're reading for trade-offs and reasoning, not
completeness. Delete these prompts as you fill them in._

## Phase 0 — Orientation & agent setup

### What was done before any code

- Studied the challenge with Claude.ai before touching the repo: read the README
  in depth, asked clarifying questions on scope, stack gaps (tRPC unfamiliar,
  AI SDK unfamiliar), and the "4 hours" signal (scope boundary, not a timer)
- Clarified stretch goal strategy: evaluate all four options + deploy, write
  trade-off analysis in DECISIONS.md, implement the winner
- Designed the 5-subagent roster on paper before writing any code
- Created TASKLIST.md, CLAUDE.md (extends starter), and .claude/agents/\*.md
  from the planning session — committed before Phase 1

### Key decisions

- **5 subagents with tight scopes, not 1 general agent:** each has different
  non-negotiables (query-architect: never skip `scopeWhere`; tool-builder: never
  put `workspaceId` in Zod schema; eval-author: never write trivially-passing
  assertions). Splitting keeps rules sharp — a general agent would let them blur.
- **code-reviewer is deliberately read-only and separate:** independent review
  after each writing phase catches what the writing agent missed.
- **Anti-patterns captured upfront in CLAUDE.md:** listed specific failure modes
  before they happened — `workspaceId` in tool schema, PII filter in React
  component, `result.length > 0` eval assertion. Agent reads these at context load.
- **Progressive DECISIONS.md updates:** one bullet block per phase while reasoning
  is fresh. Prose expanded in Phase 10.
- **Provider: Anthropic** — aligns with the evaluators' own stack (they use Claude
  Code internally). Pending key acquisition.
- **Stretch: response caching** — reinforces the isolation story (cache key must
  include `workspaceId`, same way `scopeWhere` makes isolation structural).
  Visually demoable. Reduces LLM + DB cost on repeated questions.
- **Deploy: Vercel + Neon** — PGlite is file-backed, doesn't survive serverless
  cold starts. Neon is serverless Postgres, same Drizzle schema, free tier.

---

## Phase 1 — Wire the real model

### What was done

- Wired OpenAI `gpt-4o` via `src/agent/provider.ts` for development speed (key already available)
- Smoke test passed: `applicationCountByStage` tool fired on a real question, real response streamed
- Anthropic `claude-sonnet-4-6` swap planned before final submission (key pending)

### Key decisions

- **OpenAI for development, Anthropic for submission:** Both providers are wired in `provider.ts` behind `AI_PROVIDER` env var. Using OpenAI now avoids blocking on key acquisition. Swapping to Anthropic before submission aligns the demo stack with the evaluators' own tooling (they use Claude Code internally) — a small but real signal.
- **`claude-sonnet-4-6` as the Anthropic target:** Best-in-class reasoning at reasonable cost/latency. Haiku would be cheaper but weaker at tool selection across a 6-tool catalog. Opus would be stronger but slower and more expensive per token — unnecessary for this scope.
- **No changes to the agent loop (`run.ts`):** Provider switching is isolated to `provider.ts`. The loop is provider-agnostic by design; touching it for a provider swap would be scope creep.

---

## Phase 2 — Tool catalog design

### What was designed

Six tools planned (one is the given reference):

| Tool                       | Question answered                | Display     |
| -------------------------- | -------------------------------- | ----------- |
| `applicationCountByStage`  | Pipeline shape by stage          | `bar_chart` |
| `applicationsByJob`        | Volume per role                  | `table`     |
| `candidateSourceBreakdown` | Where candidates come from       | `bar_chart` |
| `timeToHireByJob`          | Speed per role                   | `table`     |
| `jobList`                  | What's open                      | `table`     |
| `candidateList`            | Candidates for a job (PII-gated) | `table`     |

### Key decisions

- **6 tools, not more:** too many tools confuses the LLM's tool selection. Too few means each tool is too broad to drive precisely. 6 covers the recruiter's core analytical questions without overlap.
- **Exactly one PII tool (`candidateList`):** concentrating PII in one tool limits the surface area where the role gate must be applied. Every other tool returns aggregate or non-identifying data.
- **`jobId?` as the common optional param:** tools that can be scoped to a single job accept `jobId?` — lets the LLM compose (call `jobList` to discover a job, then pass its `jobId` to `candidateList`). Explicit name (`jobId` not `id`) makes LLM param-filling reliable.
- **Display hints chosen for data shape, not aesthetics:** distributions (`stage`, `source`) → `bar_chart`; multi-field records → `table`. LLM picks the data; the hint tells the renderer what to draw.
- **Catalog documented in `tools.ts` comment block:** the design rationale lives next to the code, visible to the reviewer without opening a separate doc.

---

## Phase 3 — Query layer

### What was built

Five query functions added to `src/db/analytics.ts`, all scoped through `scopeWhere`:

- `getApplicationsByJob` — join `applications → jobs`, count + avg pipeline days per job
- `getCandidateSourceBreakdown` — join `applications → candidates`, group by source, percentage computed in TS post-aggregation
- `getTimeToHireByJob` — hired applications only, `percentile_cont(0.5)` for median days
- `getJobList` — direct `jobs` read, `daysOpen` via epoch math
- `getCandidatesForJob` — join `applications → candidates`, returns PII raw (gate is Phase 5)

### Key decisions

- **Secondary-table `workspaceId` filters added explicitly:** joins to `jobs` and `candidates` (both carry `workspaceId`) include `eq(secondaryTable.workspaceId, ctx.workspaceId)` in the `extra` array passed to `scopeWhere`. FK integrity would have been sufficient in practice, but the isolation contract should be structurally visible in the code — not inferred from schema constraints.
- **`openings` dropped from `getJobList`:** TASKLIST design included `openings: number` but the `jobs` table has no such column. Inventing a field violates hard rule 5. Dropped it; honest schema beats aspirational shape.
- **Percentage computed in TS, not SQL:** `getCandidateSourceBreakdown` sums counts post-aggregation and divides in TypeScript. Avoids SQL window functions and keeps return types strict (`number`, not `string`).
- **`percentile_cont` used for median:** no Drizzle built-in for ordered-set aggregates. PGlite is a WASM Postgres port — should support it, but unverified until UI smoke test in Phase 6. Fallback if it breaks: sort + pick midpoint row.
- **PII returned raw from `getCandidatesForJob`:** stripping at the query layer would be the wrong boundary — it would make the function's output role-dependent and harder to test. Gate lives in the tool layer (Phase 5), consistent with the reference design.
- **`Number()` coercion in every `.map()`:** Postgres `numeric`/`float8` columns come back as JS strings from the PGlite driver despite `sql<number>` generic typing. `Number()` normalises without `as` cast. Pattern consistent across all five functions.

---

## Phase 4 — Tool catalog

### What was built

Five tools added to `buildTools` in `src/agent/tools.ts`:

| Tool                       | Wraps                         | Display                      |
| -------------------------- | ----------------------------- | ---------------------------- |
| `applicationsByJob`        | `getApplicationsByJob`        | `table`                      |
| `candidateSourceBreakdown` | `getCandidateSourceBreakdown` | `bar`                        |
| `timeToHireByJob`          | `getTimeToHireByJob`          | `table`                      |
| `jobList`                  | `getJobList`                  | `table`                      |
| `candidateList`            | `getCandidatesForJob`         | `table` (role-aware columns) |

### Key decisions

- **`workspaceId` never in Zod input schema:** all tools read it from `ctx` (closed over from `buildTools(ctx)`). Putting it in the schema would let the LLM supply an arbitrary workspace ID — a tenant isolation bypass. Caught by code-reviewer in prior phases; architecture enforces it by construction.
- **Display columns role-aware in `candidateList`:** `piiCols` derived from `PII_COLUMNS.candidates` at execute time. Analyst gets `["stage", "source", "daysSinceApplied"]`; recruiter/admin get the full list including `["name", "email", "phone"]`. Prevents empty PII column headers from rendering for analyst-role callers.
- **`PII_COLUMNS.candidates` is the single source of truth:** column list derived in `tools.ts` via spread rather than re-declared. If a new PII field is added to `permissions.ts`, the display gate updates automatically.
- **No tool writes Drizzle queries inline:** all go through the analytics layer. Enforced by the tool-builder subagent's rules and verified by code-reviewer.

---

## Phase 5 — PII gate

### What was built

- `stripPII<T>(records, role)` implemented in `src/db/permissions.ts`
- Applied in `candidateList` execute function, between query return and `result()` call
- `PII_COLUMNS` typed `as const` for literal type inference; `CandidatePIIKey` derived from it
- `canReadColumn` made real (reads from `PII_COLUMNS`), replacing permissive stub
- Return type `Array<Omit<T, CandidatePIIKey>>` — TypeScript enforces the stripped shape at the call site

### Key decisions

- **Gate at tool boundary, not query layer:** stripping in the query function would make `getCandidatesForJob` role-dependent — it couldn't be called without a role, and couldn't be tested in isolation. The tool layer is the right boundary: it has `ctx.role`, sits between DB and serialization, and is the last server-side point before the result leaves the process.
- **Not in the LLM prompt, not in the UI:** these are both wrong boundaries. The LLM can't be trusted to redact; the UI is post-serialization (PII already on the wire). Hard rule 4 in CLAUDE.md.
- **`stripPII` return type `Array<Omit<T, CandidatePIIKey>>`:** the union `| T` was initially used on the fast path but widened the type enough for callers to access `.name` post-call. Changed to the stripped type unconditionally; recruiter/admin path uses `as` with an explanatory comment (T is structurally assignable to Omit<T, ...> — superset satisfies subset).
- **`phone` included in PII gate:** initial implementation gated `name` and `email` but omitted `phone` from `candidateList` columns. Caught in code review — `phone` is in `PII_COLUMNS.candidates`, so it must be stripped for analysts and only shown to authorized roles.

---

## Phase 6 — Generative UI

### What was built

- `src/app/components/BarChart.tsx` — Recharts horizontal bar chart with `STAGE_ORDER` sort when `xKey === "stage"`, explicit pixel dimensions (no `ResponsiveContainer`)
- `src/app/components/DataTable.tsx` — Tailwind table, `formatLabel` on headers, `formatValue` with `ENUM_PATTERN` on cells (formats `careers_site` → "Careers Site"; leaves emails/names untouched)
- `src/app/components/LineChart.tsx` — Recharts line chart, same width-measurement pattern as `BarChart`, wired for `display.kind === "line"`
- `src/app/components/format.ts` — shared util: `LABEL_OVERRIDES`, `formatLabel`, `formatValue`, `ENUM_PATTERN`. Single source of truth for all display formatting across chart and table components.
- `src/app/page.tsx` — full renderer wired: `ToolCall` component, `ToolResult` memoized renderer, `isToolPart()` runtime guard, streaming deferral per-message, auto-scroll; `"bar"` / `"line"` / `"table"` switch covering full `Display` union
- `src/agent/provider.ts` — full `SYSTEM_PROMPT` rewrite with named sections
- `src/db/analytics.ts` — `getTimeToHireByJob` rewritten to avoid `percentile_cont` (PGlite does not support ordered-set aggregates); median computed in TypeScript post-fetch. `getJobList` `orderBy` de-duplicated to `asc(jobs.createdAt)`.

### Key decisions

- **`React.memo(ToolResult)` with custom comparator is the fix for streaming cut-off:** `RechartsBarChart` dispatches Redux actions on every render. During streaming, parent re-renders on every text delta → Recharts re-renders → Redux middleware calls `JSON.stringify` on actions → something in Next.js 16's internals throws → `useChat` catches → `status = "error"` → stream stops mid-sentence. `memo` prevents re-renders of completed tool results during subsequent streaming. This was the hardest bug in the session; three other approaches (streaming deferral, `useLayoutEffect`/`useState`, removing `ResponsiveContainer`) each partially addressed symptoms. The `memo` fix cuts the root cause.
- **`ResponsiveContainer` dropped permanently:** its internal `ResizeObserver` stays subscribed after mount. Layout shifts during streaming (new content pushing the page down) trigger the observer → Redux dispatch → same throw chain. Replaced with one-time `useRef` + `useEffect` width measurement + explicit pixel `width`/`height` on `RechartsBarChart`. One-shot `ResizeObserver` fallback added for containers hidden at mount.
- **`streaming={isLastMessage && busy}` scopes deferral to current message only:** previous messages' charts always show. Avoids remount cycle that was causing scroll jumps and DOM reflow.
- **SYSTEM_PROMPT restructured:** LLM was repeating table rows as numbered lists and re-calling `jobList` when job IDs were already in context. Added explicit rules: "never list table rows — the chart is already rendered", "read jobId from conversation history before calling jobList again". Added prompt-injection resistance section.
- **`isToolPart()` runtime guard replaces `as` cast:** `message.parts` is typed but the property bag isn't fully narrowed. Guard checks `typeof part === "object"` and `type` is a string before any property access.
- **Nested `scopeWhere(table, ctx)` in extra arrays:** three query functions joined to a secondary table (`jobs`, `candidates`) and needed to scope both sides. Pattern: pass `scopeWhere(secondaryTable, ctx)` as a SQL fragment in the `extra` array of the outer `scopeWhere`. Drizzle accepts SQL fragments in AND conditions; the INNER JOIN constrains by FK, the double-scope is defensive depth. Documented inline.
- **`percentile_cont` removed from `getTimeToHireByJob`:** PGlite (WASM Postgres) does not support ordered-set aggregates. Rewritten to fetch all hired rows per workspace and compute median in TypeScript. Trade-off: loads full hired-application set into memory — acceptable for dev/eval scale, would need streaming or pagination before high-volume prod use.
- **Shared `format.ts` util:** `BarChart` and `DataTable` originally had divergent `LABEL_OVERRIDES` — e.g. `jobTitle` override was missing from `BarChart`. Consolidated into one module so adding a new override propagates to all components automatically.

---

## Phase 7 — Evals

### What was built

Three eval files covering the two non-negotiables (isolation, PII) and one stretch (answer quality):

- `evals/isolation.eval.ts` — calls `getJobList`, `getApplicationsByJob`, `getCandidatesForJob`, `getCandidateSourceBreakdown` directly for each workspace; asserts every returned row ID / jobId carries the expected workspace prefix. Must fail if `scopeWhere` is removed from any query. Result: **100%**.
- `evals/permissions.eval.ts` — calls `getCandidatesForJob` + `stripPII` directly; asserts analyst path has no `name`/`email`/`phone` keys and recruiter path retains `name`. No LLM involved. Must fail if `stripPII` is bypassed. Result: **100%**.
- `evals/quality.eval.ts` — full copilot run via `streamCopilot`; two scorers: (1) deterministic `usedCorrectTool` via `toolCallAccuracy` flexible mode; (2) LLM-as-judge `answerCorrectness` (75% factual + 25% semantic similarity). Result: **~77-82%** (stochastic — LLM judge varies per run). Overall suite: **~92%**.

### Key decisions

- **Isolation and permissions evals are LLM-free:** calling query/permission functions directly means the assertions are O(1) latency, 100% deterministic, and can't pass trivially due to a mock model returning empty results. This is the right layer: the rules live in the query/permission code, not in the LLM.
- **`usedCorrectTool` omits `input` from actual tool calls:** the OpenAI Responses API passes empty strings for optional params (`{ jobId: "" }`). Passing these to `toolCallAccuracy` produces `nameOnly` matches (0.5) instead of exact matches (1.0). Since we test name only — not argument values — omitting `input` from the extracted tool calls produces exact matches and honest scores.
- **Quality eval weights: 75% factual / 25% semantic — kept intentionally.** The ~80% score is a structural ceiling, not a calibration failure. The judge penalizes reference claims missing from the copilot's output (false negatives). The copilot is designed to state one insight in 2-4 sentences, so most enumerable reference claims will be absent by construction. Raising the score would mean either making the copilot more verbose (contradicts SYSTEM_PROMPT) or reducing factual weight (makes the judge easier to game). The rigorous factual check is the point — the score tells you answer quality is "good", not "perfect", which is accurate.
- **LLM judge requires `openai.chat()` + `strictJsonSchema: false` middleware:** `evalite/scorers` sends JSON schemas without `additionalProperties: false`. The default `openai()` call (Responses API) enforces strict schema and rejects these calls. Using `openai.chat("gpt-4o-mini")` (Chat Completions) with `defaultSettingsMiddleware({ settings: { providerOptions: { openai: { strictJsonSchema: false } } } })` routes through JSON object mode instead of strict JSON schema mode.
- **`.env.local` loaded via `evalite.config.ts` `define` block:** evalite runs its own Vite instance and ignores `vitest.config.ts`. `OPENAI_API_KEY` and `AI_PROVIDER` are read at config load time with Node's `fs.readFileSync` and baked into the eval bundle via Vite's `define`. Process-level `process.env` mutations are set as a belt-and-suspenders fallback for non-transformed paths.
- **PGlite in-memory for evals:** the WASM database can't share a file-backed data directory across concurrent workers. Setting `PGLITE_DIR = undefined` when `process.env.VITEST` is truthy creates an in-memory instance per process. Each eval file seeds its own fresh state.
- **`isolation.eval.ts` counts applications, not candidates:** `getCandidateSourceBreakdown` groups by application (each candidate can have multiple), so the expected count is 24 (brightwave) and 19 (meridian), not 18 and 14 (candidate count). Using candidate count would cause a false pass on a leaked tenant (source totals would be inflated, not equaled).

---

## Phase 8 — Response caching

### What was built

- Module-level `toolCache = new Map<string, { data: unknown; expiresAt: number }>()` in `src/agent/tools.ts`
- `getCached(key)` / `setCached(key, data)` helpers with 60s TTL
- Cache applied to: `applicationsByJob`, `candidateSourceBreakdown`, `timeToHireByJob`, `candidateList`
- Cache NOT applied to: `applicationCountByStage` (reference tool — immutable by rule), `jobList` (job listings change frequently)
- `evals/caching.eval.ts` — two scorers: `resultsAreIdentical` (deep row comparison, non-empty guard) and `secondCallIsFaster` (relative timing, 0.5ms floor for sub-ms CI flakiness prevention). Result: **100%**.

### Key decisions

- **`workspaceId` mandatory in cache key:** omitting it would be the cache-equivalent of omitting `scopeWhere` — a tenant isolation bypass where Workspace A's cached data is served to Workspace B. The key format `${workspaceId}::${toolName}::${JSON.stringify(params)}` makes the isolation boundary visible by construction.
- **Raw (pre-PII) data stored; `stripPII` applied per-request after retrieval:** role excluded from cache key. Two callers with different roles (analyst vs recruiter) for the same workspace+params hit the same cache entry; the PII gate runs on the way out based on the caller's role. Storing stripped data by role would double the cache entries and complicate invalidation.
- **`console.log("[cache HIT]"` / `"[cache MISS]")` kept intentionally:** these are Loom demo signals, not debugging leftovers. Flagged CRITICAL by code-reviewer; acknowledged and deferred to Phase 10 (strip before PR merge, after Loom is recorded).
- **`jobList` excluded:** job open/close status changes in real time. Caching it would serve stale pipeline state. All aggregate analytics tools are cached — they reflect historical data that doesn't change within a 60s window.
- **`secondCallIsFaster` scorer uses 0.5ms floor:** on a warm JIT with a tiny PGlite dataset, the first DB call can complete sub-millisecond. Scheduler jitter at that resolution can reverse the elapsed ordering spuriously, causing a working cache to fail the eval. Score 0.5 (inconclusive) when `elapsed1Ms < 0.5` instead of 0 (false fail). Only the relative ordering matters above the floor.

---

## Phase 9 — Deployment

### What was built

- `@neondatabase/serverless` installed; `src/db/client.ts` branched on `DATABASE_URL`
- `src/env.ts` — `DATABASE_URL?: string` added
- `buildDb()` function: Neon HTTP pooling when `DATABASE_URL` set, PGlite otherwise (PGlite path unchanged, including `globalThis` HMR guard and `VITEST` in-memory branch)
- Neon project seeded (Brightwave + Meridian) via `DATABASE_URL=... pnpm db:seed`
- Deployed to Vercel — production branch: `ats-analytics-copilot`

### Key decisions

- **Neon over Railway:** Neon's serverless HTTP driver matches Vercel's stateless execution model — no persistent connection needed per function invocation. Railway would let PGlite survive, but PGlite file-backed is fundamentally incompatible with serverless cold starts.
- **Same Drizzle schema, zero query changes:** the Neon and PGlite drivers both expose the same `PgDatabase` query builder interface. Every query function in `analytics.ts` compiles and runs unchanged.
- **PGlite still imported in production bundle:** both imports are at the top of `client.ts`. The WASM binary is included in the production bundle even when the Neon path is taken. For a take-home this is acceptable; splitting into `client.pglite.ts` / `client.neon.ts` with a conditional re-export would eliminate the dead weight in production.
- **`DATABASE_URL` absent in local dev:** `.env.local` does not set it, so local `pnpm dev` continues to use file-backed PGlite. Evals use `VITEST=true` in-memory PGlite — unaffected.
- **OpenAI `gpt-4o` in production:** key already available, avoids blocking on Anthropic key provisioning for deployment verification. Can swap to Anthropic before final PR merge if desired.

---

## Summary

This is a multi-tenant ATS analytics copilot: a chat UI where hiring team members ask natural-language questions about their recruiting data and a real LLM agent answers by calling typed tools that run scoped Drizzle queries. Results render as bar charts or tables depending on data shape. The two non-negotiables — tenant isolation and PII gating — are enforced by construction, not by convention: every query goes through `scopeWhere`, and PII stripping happens server-side at the tool boundary before anything leaves the process.

**What's live:** full 6-tool catalog, generative UI (bar chart + table + line chart), PII gate (analyst role strips name/email/phone), response caching (60s TTL, workspace-scoped keys), deployed to Vercel + Neon. Eval suite: 5 files, 9 evals, ~93% overall.

**What's pending:** Loom recording.

---

## Architecture & key decisions

### Tool catalog

Six tools, not more. Too many confuses LLM tool selection; too few makes each tool too broad to drive precisely. Each answers one question:

| Tool                       | Question                             | Display   |
| -------------------------- | ------------------------------------ | --------- |
| `applicationCountByStage`  | Pipeline shape                       | bar chart |
| `applicationsByJob`        | Volume per role                      | table     |
| `candidateSourceBreakdown` | Where candidates come from           | bar chart |
| `timeToHireByJob`          | Speed per role                       | table     |
| `jobList`                  | What's open                          | table     |
| `candidateList`            | Candidates for a job (**PII-gated**) | table     |

Exactly one PII tool limits the surface area where the role gate applies. `jobId?` as the common optional param lets the LLM compose: call `jobList` to discover a job, then pass `jobId` to `candidateList`.

Tool descriptions are written as questions the recruiter asks, not as API specs. This makes LLM tool selection reliable — the model matches the user's question to the description, not to implementation details.

### Query layer

All query functions live in `src/db/analytics.ts`. Each wraps Drizzle ORM — no raw SQL except `sql<number>` tagged expressions for computed columns (epoch math, `percentile_cont`). All functions accept `ctx: AnalyticsCtx` as the first argument, making it impossible to call a query without providing tenant scope.

### Tenant scoping

`scopeWhere(table, ctx, extra?)` is the single enforcement point. It AND-s `eq(table.workspaceId, ctx.workspaceId)` into every query's WHERE clause. There is no other way to write a workspace-filtered query; the function is the only place the filter is constructed.

**Why this is right by construction:** a query that tries to omit scoping would have to not call `scopeWhere` at all. The function signature makes the workspace filter the default, not an option.

For joined tables (where two tables each carry `workspaceId`), both are scoped: `scopeWhere(primaryTable, ctx, [scopeWhere(secondaryTable, ctx), ...extra])`. This is defensive — the INNER JOIN already constrains by FK, but the double-scope makes the intent explicit.

### Permissions

`stripPII<T>(records, role)` in `src/db/permissions.ts` strips `name`, `email`, `phone` for `analyst` role. Applied in the `candidateList` tool's `execute` function, between the query return and `result()` serialization. This is the only correct boundary:

- Query layer: wrong — makes the function role-dependent, harder to test
- LLM prompt: wrong — LLM cannot be trusted to redact
- React component: wrong — PII already on the wire

`PII_COLUMNS` is `as const` — a single source of truth. Adding a new PII field to it automatically propagates to both `stripPII` and the `candidateList` column display gate.

### Generative UI

Each tool returns `{ rows, display }` where `display.kind` is `"bar" | "table" | "line"`. The LLM picks the data shape; the display hint tells the renderer what to draw. This separation means the LLM can't accidentally pick the wrong visual — it only picks the data, and the tool author decides the appropriate visualization at build time. The renderer's switch statement is exhaustive over the `Display` union; adding a new `kind` produces a type error until the component is wired.

The hardest bug in the project was `ToolResult` re-rendering during streaming. Recharts dispatches Redux actions on every mount. During streaming, the parent re-renders on every text delta → Recharts remounts → Redux middleware calls `JSON.stringify` on internal actions → something in Next.js 16's internals throws → `useChat` catches and sets `status = "error"` → stream stops mid-sentence. The fix: `React.memo(ToolResult)` with a custom comparator that short-circuits if the tool result hasn't changed. This prevents Recharts from remounting on every incoming token. `ResponsiveContainer` was also removed — its internal `ResizeObserver` fires on layout shifts caused by new streaming content, triggering the same chain. Replaced with a one-time `useRef` + `useEffect` width measurement.

---

## Provider choice

**Production: OpenAI `gpt-4o`** via `@ai-sdk/openai`, behind `AI_PROVIDER=openai` env var. The provider factory in `src/agent/provider.ts` also supports `anthropic`, `bedrock`, and a `mock` model (used in CI/evals). Switching providers is a one-line env change — the agent loop is provider-agnostic.

OpenAI was chosen for production because the key was available immediately. Anthropic (`claude-sonnet-4-6`) would have been the first-choice — it aligns with the evaluators' own tooling and is the stronger reasoning model for a 6-tool catalog — but key acquisition would have blocked the deployment. The wiring is already there; swapping is a `AI_PROVIDER=anthropic` env var change.

**Loop:** `streamText` with `stopWhen: stepCountIs(6)`. Most questions resolve in 1–2 steps (orient → query → answer). Six steps is a hard cap against infinite tool loops. `maxOutputTokens: 2048` prevents truncation on longer analytical responses.

**Structured output:** not used. Each tool's `display` hint is the typed output — the LLM picks the data, not the visualization. A typed wrapper around the final prose response was considered (one of the Phase 8 stretch options) but cut: it adds schema overhead for invisible demo value.

---

## Benchmarks

**Eval suite: ~93% overall** (`pnpm eval`, 5 files, 9 evals, ~20s)

| Eval                          | Score   | Type                   |
| ----------------------------- | ------- | ---------------------- |
| `isolation.eval.ts`           | 100%    | Deterministic          |
| `permissions.eval.ts`         | 100%    | Deterministic          |
| `copilot.eval.ts` (reference) | 100%    | Semi-deterministic     |
| `caching.eval.ts`             | 100%    | Deterministic          |
| `quality.eval.ts`             | ~77-82% | Stochastic (LLM judge) |

**Why these assertions are non-trivial:** `result.length > 0` would pass even with a tenant leak (more rows, not zero). The isolation eval asserts every row ID starts with the expected workspace prefix; a leaked row from Meridian would carry "mer-" in a Brightwave result. The permissions eval asserts `!("name" in row)` for every analyst-role row — not just that the result is non-empty.

---

## Stretch trade-off analysis

Four options were on the table. All four were analyzed before implementing any of them.

| Option                  | Demo value                             | Complexity | Production value | Verdict   |
| ----------------------- | -------------------------------------- | ---------- | ---------------- | --------- |
| Typed structured answer | Low — invisible to the user            | Low–Med    | Medium           | Cut       |
| Resumable streams       | Low — needs a flaky connection to demo | High       | High             | Cut       |
| **Response caching**    | **High — second ask is instant**       | **Med**    | **High**         | **Built** |
| Rate limiting           | Low — no visible signal                | Low        | High             | Cut       |

**Why caching won:** it's the only stretch that reinforces the core isolation story. The cache key must include `workspaceId` — omitting it would be the cache-equivalent of omitting `scopeWhere`. You can demo the win (ask the same question twice, second is instant) and explain the architectural decision in the same breath. It also reduces real costs: LLM tokens and DB round-trips are both expensive on repeated questions.

**Why resumable streams were cut:** high implementation complexity, and the evaluators will test on a local network where streams complete in under a second. The failure mode (dropped connection mid-stream) simply won't manifest in the demo environment.

**Why rate limiting was cut:** correct for production but has zero demo value. There's no visible UI signal when a rate limit is in effect, and the seed data doesn't stress-test throughput.

---

## Deployment

**Stack: Vercel + Neon serverless Postgres.**

PGlite is file-backed WASM — it can't share state across Vercel's serverless function instances and doesn't survive cold starts. Neon's serverless HTTP driver is stateless by design: each function invocation gets a connection from Neon's pool without managing a persistent process. The Drizzle schema is identical; only the driver import changes.

The branch in `src/db/client.ts` is on `DATABASE_URL`: if set, use Neon; if absent, use PGlite. Local dev and all evals continue to use PGlite — the `VITEST=true` in-memory branch is unaffected. Swapping to Neon in production required zero changes to any query function.

One known trade-off: PGlite's WASM binary is still bundled in the production build because both drivers are imported at the top level. This adds unnecessary bundle weight when running on Neon. A future cleanup would split the imports into `client.pglite.ts` / `client.neon.ts` with a conditional re-export at build time.

---

## What I cut and why

**Admin-specific tools:** recruiter and admin have the same data access by spec. Adding admin-only tools would push the catalog past the 5–7 tool sweet spot without adding analytical value.

**`openings` field on jobs:** the initial design included it, but the `jobs` table has no such column. Inventing a field violates the "never invent fields" rule — honest schema beats aspirational shape.

**Resumable streams:** high complexity, low demo value. See stretch analysis above.

**Rate limiting:** correct for production, invisible in a demo. See stretch analysis above.

**StatCard component:** no tool returns a single number. Building a component with no renderer path would be dead code.

---

## What I'd do with another day

1. **Per-row drill-down:** clicking a chart bar opens the underlying candidate rows. The most natural analytics UX — "why is interview stage so high?" → click → see the candidates. Would make the demo significantly more compelling.
2. **Tool error UX:** tool failures currently render as raw error text. A production version would surface user-readable messages with a retry option per tool.
3. **Multi-tool orchestration:** the LLM already chains `jobList` → `candidateList` partially. Explicit orchestration hints in the system prompt would make this reliable for compound questions like "show me candidates for the most popular role."
4. **Cache invalidation on write:** the current TTL-only strategy means up to 60s of stale data after a mutation. A write-through or tag-based invalidation approach would be correct in a real multi-user system.

---

## Working with the agent

Before writing a single line of code, I opened Claude.ai to understand the full scope of the build. I used it to read the README in depth, ask clarifying questions on the stack (tRPC and the AI SDK were unfamiliar), and think through the "4 hours" signal as a scope boundary rather than a stopwatch. Out of that session came my own `CLAUDE.md` (hard rules, anti-patterns, collaboration protocol), `TASKLIST.md` (10-phase plan with per-substep checklists), and the 5-subagent roster — all committed before Phase 1 touched any code. The planning investment paid off: every subagent entered with tight scope and explicit rules, so there was no "figure it out as you go" ambiguity mid-build.

**What I delegated:** query writing (all five functions in `analytics.ts`), tool wrapping (all five new tools in `tools.ts`), component scaffolding (`BarChart.tsx`, `DataTable.tsx`), eval planning, and code review passes. The subagent roster was the right call — each subagent's tight scope kept the rules sharp (query-architect: never skip `scopeWhere`; tool-builder: never put `workspaceId` in tool params; eval-author: never write trivially-passing assertions).

**Where the agent was wrong and I caught it:**

- `workspaceId` initially appeared in a tool's Zod input schema — caught by `code-reviewer`, moved to `ctx`.
- `stripPII` was initially applied in the React component layer, not server-side — caught in network tab review, moved to tool boundary.
- Eval initially asserted `result.length > 0` — would pass even with a tenant leak. Rewritten to assert `workspaceId` on every row.
- `as ToolPart` cast on `unknown` with no runtime guard — caught by `code-reviewer`, replaced with `isToolPart()` predicate.
- Bare `eq(table.workspaceId, ctx.workspaceId)` in query extra arrays, bypassing `scopeWhere` — caught in review, replaced with `scopeWhere(table, ctx)` calls.
- `ResponsiveContainer` causing streaming cut-off — the agent tried three different fixes (streaming deferral, `useLayoutEffect`, `useEffect`) before identifying the root cause (Recharts Redux dispatch on re-render). The correct fix (`React.memo`) required understanding the full chain from Recharts internals through `useChat` error handling.

**What I'd never let it decide on its own:** tool catalog shape (which questions to answer and at what granularity), scoping pattern (where `scopeWhere` lives and why), permission boundary location (tool layer, not query layer or UI), eval semantics (what a tenant-isolation assertion must actually check).

---

## Hours

7 hours total, spread across Monday around 7am to Tuesday around 8am.
I caught a cold over the weekend, rested for most of Monday, and spent the build running a fever, so work happened in bursts with frequent breaks. That explains the commit spacing. Of the total time, roughly 1 hour was upfront brainstorming in Claude.ai before any code: scoping the build, mapping the stack gaps, and designing the subagent roster and collaboration protocol. The remaining 6 hours were implementation across the 10 phases. Healthy, I would have finished faster.
