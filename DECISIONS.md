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
- Created TASKLIST.md, CLAUDE.md (extends starter), and .claude/agents/*.md
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

| Tool | Question answered | Display |
|---|---|---|
| `applicationCountByStage` | Pipeline shape by stage | `bar_chart` |
| `applicationsByJob` | Volume per role | `table` |
| `candidateSourceBreakdown` | Where candidates come from | `bar_chart` |
| `timeToHireByJob` | Speed per role | `table` |
| `jobList` | What's open | `table` |
| `candidateList` | Candidates for a job (PII-gated) | `table` |

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

## Overview

What you built and the state it's in. If something is half-done on purpose, say so —
that's a good answer, not a gap.

## Architecture & key decisions

- **Tool catalog** — which tools you added, their granularity, and how you shaped
  their inputs for a model to drive.
- **Query layer** — how it's structured and composed.
- **Tenant scoping** — how you made it impossible to forget as the layer grows.
- **Permissions** — how you enforce the PII rule by role.
- **Generative UI** — how tool results become streaming components.

## Model & agent

Which provider or gateway you wired (Vercel AI Gateway / Cloudflare AI Gateway /
direct keys / Bedrock), and **why**. Anything notable about the loop — multi-step
control, tool-error handling, stop strategy, structured output.

## Benchmarks

What your tenant-isolation and permission checks actually assert, and how you know
they catch the real thing.

## Trade-offs & cuts

What you deliberately left out and why. What you'd do with another day.

## Working with the agent

Using AI tools is encouraged. Briefly:

- What you delegated.
- Where the agent was wrong and you caught it.
- What you'd never let it decide on its own.

## Hours

Roughly how long you spent.
