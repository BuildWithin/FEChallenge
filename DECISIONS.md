# Decisions

Brief write-up of **why** we built it this way. The code is the source of truth;
this document is the line of thought reviewers asked for.

## Overview

We shipped a multi-tenant **ATS analytics copilot**: seven scoped tools, an agent
loop on the Vercel AI SDK, Evalite security benchmarks, and a chat UI that renders
tool results as bar/line charts or role-aware tables.

We worked in **four PR-sized phases** (security → tools → evals/agent → generative
UI) so each slice stayed reviewable. The repo still boots keyless on the **mock**
model; demos use **OpenAI `gpt-4o-mini`** via `AI_PROVIDER=openai` in `.env.local`.

### `docs/` (supplementary)

Not required to run the app. Brief map of what’s there:

| File | Contents |
| --- | --- |
| `implementationPlan.md` | Phase overview, git workflow (one branch/PR per phase), links to phase guides |
| `phase1.md` … `phase4.md` | Step-by-step notes per delivery slice (security, tools, evals, UI) |
| `roadmap.md` | Follow-up items (e.g. date filters, `listApplications`) aligned with prompt **KNOWN LIMITATIONS** |

---

## How we approached the hard requirements

### Tenant isolation — scope by construction, not by discipline

**Problem:** In a growing query layer, “remember to filter by workspace” fails.

**Decision:** One choke point — `scopeWhere(table, ctx, extra)` in
`src/db/analytics.ts`. Every function takes `ctx: { workspaceId, role }` **first**,
so a query cannot be expressed without tenant context.

**Why:** A leak is the worst bug here. Centralizing the filter is cheaper than
auditing every new `WHERE` clause. Evalite compares tool row ids against the *other*
workspace’s seed data so regressions go red without reading model prose.

### Permissions — PII unrepresentable for analysts

**Problem:** Post-filtering PII from query results still SELECTs sensitive columns;
one forgotten path leaks.

**Decision:** `candidateColumns(role)` builds the `SELECT` list. Analysts never
request `name` / `email` / `phone`; recruiters and admins do. `assertCanReadPII` is
defense in depth for hand-built column lists.

**Why:** “Cannot appear in the result type” beats “strip before JSON.” The UI and
agent inherit the same guarantee because tools call the same layer.

---

## Tool catalog & query layer

### One tool ≈ one analytical question

**Decision:** Seven tools (`applicationCountByStage`, `candidatesBySource`,
`applicationsOverTime`, `jobsByStatus`, `openJobs`, `timeInFunnel`, `listCandidates`).
Each maps to one composable query in `analytics.ts`.

**Why:** Small, named surfaces are easier for the model to route than a generic
“run SQL” tool, and easier for us to scope and test. The agent never writes SQL.

### Optional tool inputs

**Decision:** Every tool input is optional (Zod `.optional()`), so the offline mock
can call `{}` and CI stays deterministic.

**Why:** Required params broke the mock early; optional params with sensible
defaults in the query layer kept boot + evals green while we wired a real model.

### `{ rows, display }` contract

**Decision:** Tools return rows plus a `display` hint (`table` | `bar` | `line`) —
see `src/agent/artifact.ts`.

**Why:** Decouples data from presentation. Phase 4 added **one** UI dispatcher
(`ToolResult` in `page.tsx`) instead of per-tool React code. New tools only need a
known `display` shape.

### `normalizeSource` on `listCandidates`

**Decision:** Lowercase, alias, and **ignore** invalid source strings from the model.

**Why:** Case-sensitive `eq(candidates.source, …)` plus hallucinated sources returned
zero rows; the model then said “no candidates” for Meridian. Ignoring bad filters
beats false empty results.

---

## Model & agent loop

### Provider: `gpt-4o-mini` for demos, mock for CI

**Decision:** OpenAI `gpt-4o-mini` in dev; `AI_PROVIDER=mock` default in repo.
Gateway via `AI_GATEWAY_BASE_URL` supported on openai/anthropic providers.

**Why:** Tool-heavy loop with many short turns — mini is fast and cheap enough for
a take-home demo. Quality was sufficient for routing, summarization, and following
role rules. Mock keeps clone/eval/CI keyless.

### `buildSystemPrompt({ workspaceId, role })`

**Decision:** Replace the static system prompt with role and workspace-aware text
in `src/agent/provider.ts`.

**Why:** A single prompt said “never expose PII,” so the model refused contacts
even for admin/recruiter when tools returned PII. The caller’s role must be explicit.
We also added a **TOOL CATALOG** and **KNOWN LIMITATIONS** so the model does not
misuse `applicationsOverTime` for “last month” (no date filters yet) — honest
limits until the query layer grows (see `docs/roadmap.md`).

### Loop: `streamText` + `stepCountIs(6)`

**Decision:** Standard AI SDK loop; tools from `buildTools(ctx)`; workspace/role
from headers via tRPC/chat transport.

**Why:** Matches the scaffold; six steps enough for tool call + reply. Tool errors
surface as `output-error` in the UI.

---

## Generative UI & chat UX

### Dependency-light charts

**Decision:** CSS horizontal bars + inline SVG line chart (axis, grid, hover values).
No Recharts/Victory.

**Why:** Time box and bundle size. Seed data shapes are simple counts and a short
time series; SVG was enough for a credible demo.

### Role-aware presentation (UI + prompt together)

| Situation | Choice | Why |
| --- | --- | --- |
| Admin/recruiter **table** answers | Table only, hide duplicate prose | Table is the deliverable; prose repeated rows and looked broken (numbered lists). |
| Analyst **listCandidates** | Static permission notice, no table | No PII columns to show; listing source/date looked like a candidate list but wasn’t. |
| Analyst **bar/line** answers | Chart only | Same duplication issue as tables. |
| Tool names in chat | Hidden | User-facing product, not a dev console. |

**Why:** Generative UI carries the data; the model adds prose only where it adds
value. Analyst UX must not impersonate access the role does not have.

### Seed data per workspace

**Decision:** Distinct names, `@brightwave.example.com` / `@meridian.example.com`
emails, separate phone ranges.

**Why:** Scoping was correct but identical PII made demos look like a tenant leak.
Distinct fixtures make isolation visible without changing query logic.

---

## Benchmarks

**Decision:** Evalite (`evals/copilot.eval.ts`, 11 cases): tenant isolation (no
foreign `workspaceId` or entity ids in tool rows) and analyst PII (no name/email/phone
columns or seed contact strings in rows). Scorers inspect **tool rows**, not prose.

**Why:** Security properties must be deterministic in CI. Model wording changes;
row shape should not if scoping/permissions hold. LLM-as-judge quality evals deferred
(see trade-offs).

---

## Trade-offs & what we’d do next

| Cut | Why |
| --- | --- |
| No charting library | Scope; roadmap allows upgrade later |
| No date-range / `listApplications` tools yet | Time box; prompt honesty + `docs/roadmap.md` until queries exist |
| tRPC mirrors only two analytics endpoints | Agent is primary consumer |
| No LLM-as-judge evals | Security evals prioritized |
| Chat resets on workspace/role switch | `useChat` id includes tenant+role — correct for isolation, poor for UX |
| No typed structured answer artifact | `display` hints + UI sufficed for demo |

**Next:** See `docs/roadmap.md` — date filters, row-level applications, job-by-title
lookup, chat persistence, design system.

---

## Working with the agent

**Delegated:** Query/tool boilerplate, Evalite scorers, chart markup, seed fixtures, test stubs.

**Caught wrong (we overrode):**

- Static “never PII” prompt without role → fixed with `buildSystemPrompt(role)`.
- Required tool params → broke mock; made inputs optional.
- Case-sensitive source filter → empty Meridian lists; `normalizeSource`.
- Identical seed PII → looked like cross-tenant leak; per-workspace fixtures.
- Model listing analyst “candidates” by source/date → permission notice in UI.
- Wrong tool for unsupported questions → TOOL CATALOG + KNOWN LIMITATIONS in prompt.

**Never delegated:** `scopeWhere` / `candidateColumns` contract, PII definition,
eval assertions, what counts as a security regression.

Agent config for day-to-day work: **`.cursorrules`** (Cursor) and **`CLAUDE.md`**
(Claude Code / general orientation).

---

## Hours

Roughly **4 focused hours** across Phases 1–4 (security, tools, evals + real
model, generative UI + this write-up).
