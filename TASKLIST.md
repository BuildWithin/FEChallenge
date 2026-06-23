# TASKLIST — BuildWithin Product Engineer Build Exercise

> **Working document.** Check off as you go.
> **Quality over speed.** No hard time cap. Estimates are guidance, not a stopwatch.
> **Read this top-to-bottom once** before starting Phase 0.

---

## Mission (one paragraph)

Build a multi-tenant **ATS analytics copilot**: a chat UI where a hiring team
asks natural-language questions about their recruiting data, and a real LLM
agent answers by calling typed tools that run scoped Drizzle queries against
an in-process Postgres (PGlite) — rendering results as charts and tables.
**Tenant isolation and PII gating are non-negotiable and must be right by
construction**, not by convention.

---

## Deliverables (verbatim from README)

The brief asks for exactly three things. Treat these as the acceptance bar:

1. **A pull request** with commits that tell a story
2. **`DECISIONS.md`** — trade-offs, what you cut and why, what you'd do with another day, "Working with the agent" note
3. **A ≤5-min Loom** — architecture + live demo

We will also deploy live (stretch). The brief says a written plan in
DECISIONS.md counts as much as code for stretches — but live deployment is a
concrete signal of production thinking, so we do both.

## How they evaluate (verbatim from README)

Every task in this list maps to at least one evaluation axis. Keep these
visible while you work:

- **Agent integration** — provider/gateway choice, loop control, tool errors
- **Tool & query architecture** — well-designed for a model to drive, scoped by construction
- **Tenant + permission correctness** — right, AND right by construction
- **Benchmarks** — do they catch what they claim?
- **UI / product taste** — a copilot you'd actually want to use
- **Communication** — write-up makes trade-offs legible

---

## The Subagent Roster ✓ ALL 5 FILES CREATED

We'll define 5 Claude Code subagents in `.claude/agents/`. Each has tight
scope, hard rules, and a clear invocation trigger. The files are provided
alongside this TASKLIST.

| Subagent            | Owns                                         | Invoke when…                                             |
| ------------------- | -------------------------------------------- | -------------------------------------------------------- |
| **query-architect** | `src/db/analytics.ts` query functions        | Adding/modifying a Drizzle query                         |
| **tool-builder**    | `src/agent/tools.ts` tool definitions        | Adding/modifying a tool the LLM can call                 |
| **ui-builder**      | `src/app/` chart/table components + renderer | Building generative UI components or wiring the renderer |
| **eval-author**     | `evals/*.eval.ts` benchmarks                 | Writing or modifying an Evalite eval                     |
| **code-reviewer**   | Independent review pass                      | Before every commit, after each phase                    |

**Why subagents and not a single prompt?** Each subagent has different
non-negotiables. The query-architect must never skip `scopeWhere`. The
tool-builder must never put `workspaceId` in tool params. The eval-author
must never write a trivially-passing eval. Splitting them keeps the rules
sharp and the context tight — Claude Code stays focused inside each scope.

---

## Phase 0 — Orient (no Claude Code, no code edits) ✓ COMPLETE

You must own the mental model before delegating. **This phase is non-negotiable.**

### 0.1 — Run the repo and click everything ✓

```bash
pnpm install
pnpm db:seed
pnpm dev
```

- Open http://localhost:3000
- Send a few messages
- Switch workspace (Brightwave ↔ Meridian Logistics) — watch network tab
- Switch role (analyst ↔ recruiter ↔ admin)
- Observe how `workspaceId` and `role` arrive (request headers)

**Done when:** you can describe out loud what the mock model returns for each role/workspace combo.

### 0.2 — Read these files in this order, nothing else ✓

- [x] `README.md` — full re-read
- [x] `CLAUDE.md` — the starter agent notes (you'll extend this)
- [x] `DECISIONS.md` — see what's there (likely empty)
- [x] `src/db/schema.ts` — tables: workspaces, jobs, candidates, applications
- [x] `src/db/seed.ts` (or wherever seed lives) — what data exists for each workspace
- [x] `src/db/analytics.ts` — **the `scopeWhere` helper + `applicationCountByStage` reference**
- [x] `src/db/permissions.ts` — the stub you'll implement
- [x] `src/agent/artifact.ts` — the display-hint contract
- [x] `src/agent/tools.ts` — the one reference tool
- [x] `src/agent/run.ts` — the streaming loop (`streamText`)
- [x] `src/agent/provider.ts` + `src/agent/mock-model.ts` — provider switching
- [x] `src/server/` — tRPC context, how `ctx.workspaceId` + `ctx.role` flow
- [x] `src/app/page.tsx` — the stub renderer for tool results
- [x] `evals/copilot.eval.ts` — the reference eval

### 0.3 — Answer these on paper before moving on ✓

If you can't answer one, re-read the file. Do not move forward.

- Where exactly is `workspaceId` injected into a Drizzle query? (Hint: `scopeWhere`)
- What does a tool's `execute` function receive — params, context, both?
- What is the shape of an "artifact" / display hint? Where is the type defined?
- Where does the chat UI read the display hint and decide chart vs table?
- How does `role` travel from request header → tRPC ctx → tool execution?
- Where is the boundary between LLM-supplied params and server-supplied context?

---

## Phase 1 — Wire the real model ✓ COMPLETE

### 1.1 — Acquire an API key ✓

- **Anthropic** (recommended — they explicitly use Claude Code internally; aligning your model with their stack is a small but real signal)
  - Free credits at console.anthropic.com
- Add to `.env.local`:
  ```
  AI_PROVIDER=anthropic
  ANTHROPIC_API_KEY=sk-ant-...
  ```

### 1.2 — Wire the provider ✓

**Delegate to:** No subagent — this is a small, surgical change. Do it directly with Claude Code main.

**Prompt template:**

> Read `src/agent/provider.ts` and `.env.example`. When `AI_PROVIDER=anthropic`, the provider factory should return an Anthropic provider configured with `claude-sonnet-4-6` (or current equivalent — check the Anthropic SDK docs if unsure). Mirror the existing structure. Do not modify anything else.

### 1.3 — Smoke test ✓

- [ ] Restart `pnpm dev`
- [ ] Ask: _"How does my pipeline look by stage?"_
- [ ] **Done when:** real Claude responds, the existing `applicationCountByStage` tool fires, the response includes the stage data

### 1.4 — Commit ✓

```
git commit -m "feat(agent): wire anthropic provider with claude-sonnet-4-6"
```

> **Do not move to Phase 2 until 1.3 works end-to-end with the real model.**

---

## Phase 2 — Design the tool catalog (on paper) ✓ COMPLETE

This is the core architectural decision. Claude Code cannot make it for you,
and the interviewers WILL ask about it.

### 2.1 — Brainstorm the questions ✓

What does a recruiter actually ask?

- "How does my pipeline look by stage?"
- "Which roles have the most applicants?"
- "Where are candidates coming from? (source breakdown)"
- "How long does hiring take per role? (time to hire)"
- "What jobs are open right now?"
- "Show me candidates for [job X]"
- "Which sources convert best?" (advanced — only if schema supports it)

### 2.2 — Define the catalog ✓

Aim for **5–7 tools**, not more. Too many = the LLM gets confused choosing.
Too few = each is too broad to drive well.

**Recommended starting set** (validate against actual schema):

| Tool name                  | Question answered          | Input params  | Output shape                                               | Display hint | Has PII? |
| -------------------------- | -------------------------- | ------------- | ---------------------------------------------------------- | ------------ | -------- |
| `applicationCountByStage`  | Pipeline shape             | `{ jobId? }`  | `{ stage, count }[]`                                       | `bar_chart`  | No       |
| `applicationsByJob`        | Volume per role            | `{}`          | `{ jobId, jobTitle, count, avgDaysInPipeline }[]`          | `table`      | No       |
| `candidateSourceBreakdown` | Where candidates come from | `{ jobId? }`  | `{ source, count, percentage }[]`                          | `bar_chart`  | No       |
| `timeToHireByJob`          | Speed per role             | `{}`          | `{ jobTitle, medianDays, hiredCount }[]`                   | `table`      | No       |
| `jobList`                  | What's open                | `{ status? }` | `{ id, title, status, openings, daysOpen }[]`              | `table`      | No       |
| `candidateList`            | Show candidates for a job  | `{ jobId }`   | `{ id, name?, email?, stage, source, daysSinceApplied }[]` | `table`      | **YES**  |

### 2.3 — Document the catalog ✓

Commit a comment block at the top of `tools.ts` OR a `docs/tools.md` describing the catalog. This is **a deliverable in disguise** — it shows your thinking to the reviewer.

### 2.4 — Sanity check the design ✓

- [ ] Does each tool answer ONE clear question?
- [ ] Are parameter names self-explanatory to an LLM? (`jobId` not `id`)
- [ ] Are tools small enough to compose? (E.g. LLM can call `jobList` then `candidateList(jobId)`)
- [ ] Is exactly one tool flagged PII? (Concentrating PII in one place is good — fewer places to leak)

---

## Phase 3 — Build the query layer ✓ COMPLETE

**Delegate to:** `query-architect` subagent (see `.claude/agents/query-architect.md`)

For each query function, invoke the subagent with a focused prompt. The
subagent's system prompt enforces the rules; your prompt only needs to
specify the function shape.

### Tasks

- [x] **3.1** `getApplicationsByJob(workspaceId, jobId?)` → table data
- [x] **3.2** `getCandidateSourceBreakdown(workspaceId, jobId?)` → with percentages
- [x] **3.3** `getTimeToHireByJob(workspaceId)` → median-based; handle no-hires case
- [x] **3.4** `getJobList(workspaceId, status?)`
- [x] **3.5** `getCandidatesForJob(workspaceId, jobId)` — **returns PII; PII gate applied in tool layer downstream, NOT here**

### Per-function self-verify (don't skip)

After each function:

- [x] Every query uses `scopeWhere` (or equivalent) — never a bare `where(eq(workspaceId, ...))`
- [x] Run a quick test:
  - With Brightwave's workspaceId → get rows
  - With Meridian's workspaceId → get DIFFERENT rows
  - With Brightwave's workspaceId but a Meridian `jobId` → ZERO rows, not an error
- [x] Types are tight (no `any`, no `as`)

### 3.6 — Code review pass ✓

Invoke `code-reviewer` subagent: _"Review `src/db/analytics.ts` against the rules in your system prompt. Check every new function uses scopeWhere and types are clean."_

### 3.7 — Commit ✓

```
git commit -m "feat(db): expand analytics query layer with scoped functions"
```

---

## Phase 4 — Build the tools (the agent's tool catalog) ✓ COMPLETE

**Delegate to:** `tool-builder` subagent

This phase is the **security-critical layer**. The subagent enforces:

- `workspaceId` comes from `ctx`/`context`, never from LLM params
- Every tool returns `{ data, displayHint: { type, ... } }`
- Tool descriptions are precise and would help the LLM pick correctly

### Tasks

For each query function from Phase 3, build the matching tool:

- [x] **4.1** `applicationsByJob` tool → wraps `getApplicationsByJob`
- [x] **4.2** `candidateSourceBreakdown` tool
- [x] **4.3** `timeToHireByJob` tool
- [x] **4.4** `jobList` tool
- [x] **4.5** `candidateList` tool — **PII gate goes here** (Phase 5)

### Per-tool self-verify

- [x] Tool's Zod input schema does NOT include `workspaceId`
- [x] `execute` reads workspaceId from context, passes it to the query function
- [x] Description reads naturally — would the LLM pick this for the right question?
- [x] Display hint type matches what the UI will render

### 4.6 — Code review pass ✓

Invoke `code-reviewer`: _"Review `src/agent/tools.ts`. Look specifically for workspaceId leaking into tool input schemas. Look for tools that bypass the query layer and write SQL directly."_

### 4.7 — Commit ✓

```
git commit -m "feat(agent): expand tool catalog with scoped tools"
```

---

## Phase 5 — Permissions (PII gate) ✓ COMPLETE

**Delegate to:** Main Claude Code (small, surgical) + `code-reviewer` at the end.

### 5.1 — Implement `src/db/permissions.ts` ✓

Replace the stub with a typed function:

```ts
export type Role = "analyst" | "recruiter" | "admin";

// PII fields, centralized so they can't be forgotten
export const PII_COLUMNS = ["name", "email", "phone"] as const;

export function stripPII<T extends Record<string, unknown>>(
  records: T[],
  role: Role,
): Array<Omit<T, (typeof PII_COLUMNS)[number]> | T> {
  if (role === "recruiter" || role === "admin") return records;
  // analyst: strip PII
  return records.map((r) => {
    const cleaned = { ...r };
    for (const f of PII_COLUMNS) delete (cleaned as Record<string, unknown>)[f];
    return cleaned;
  });
}
```

(The subagent can refine this — the point is: ONE place, typed, role-driven.)

### 5.2 — Apply it in the `candidateList` tool

After the query returns, before returning from `execute`:

```ts
const rows = await getCandidatesForJob(ctx.workspaceId, input.jobId);
const safe = stripPII(rows, ctx.role);
return { data: safe, displayHint: { type: "table" } };
```

### 5.3 — Manual verification

- [x] Switch to **analyst** role in the UI
- [x] Ask: _"Show me candidates for [a job from the seed]"_
- [x] Confirm: **no names, emails, or phones** appear in the UI
- [x] **Critical:** open browser DevTools → Network tab → inspect the chat response payload. PII must not be in the wire format. (If it's stripped only in the UI but present on the wire, that's a fail.)
- [x] Switch to **recruiter** role, same question → PII fields ARE present

### 5.4 — Code review pass ✓

Invoke `code-reviewer`: _"Review `src/db/permissions.ts` and the `candidateList` tool. Confirm PII stripping happens server-side, before serialization. Confirm `PII_COLUMNS` is the single source of truth."_

### 5.5 — Commit ✓

```
git commit -m "feat(db): enforce PII permissions by role at tool boundary"
```

---

## Phase 6 — Generative UI ✓ COMPLETE

**Delegate to:** `ui-builder` subagent

The current renderer is a stub. The reviewer wants to see "a copilot you'd
actually want to use" — this is where product taste shows.

### 6.1 — Build the components ✓

- [x] **`src/app/components/BarChart.tsx`** — Recharts horizontal bar chart
  - Props: `data: { label: string; value: number }[]`
  - Clean, minimal, Tailwind-styled
- [x] **`src/app/components/DataTable.tsx`** — Tailwind table
  - Props: `data: Record<string, unknown>[]`
  - Auto-infers columns from first row keys
  - Header row, hover, right-aligned numbers
- [x] **`src/app/components/LineChart.tsx`** — added for `display.kind === "line"`
- StatCard not built — cut, no tool returns a single number

### 6.2 — Wire the renderer in `src/app/page.tsx` ✓

### 6.3 — Polish pass ✓

- [x] Charts have decent default colors (not Recharts defaults)
- [x] Tables don't break on long strings (truncate with title attribute)
- [x] Loading state while a tool is mid-call
- [x] Empty-state message when a tool returns zero rows
- [x] Errors render gracefully (don't blow up the whole page)

### 6.4 — Manual UAT — both workspaces, all tools ✓

| Question                                | Expected tool              | Expected render     |
| --------------------------------------- | -------------------------- | ------------------- |
| "How does my pipeline look?"            | `applicationCountByStage`  | Bar chart           |
| "Which jobs have the most applicants?"  | `applicationsByJob`        | Table               |
| "Where are candidates coming from?"     | `candidateSourceBreakdown` | Bar chart           |
| "How long does hiring take?"            | `timeToHireByJob`          | Table               |
| "What jobs are open?"                   | `jobList`                  | Table               |
| "Show candidates for [job]" (recruiter) | `candidateList`            | Table with names    |
| "Show candidates for [job]" (analyst)   | `candidateList`            | Table WITHOUT names |

### 6.5 — Code review pass ✓

### 6.6 — Commit ✓

---

## Phase 7 — Evals (the benchmark suite) ✓ COMPLETE

**Delegate to:** `eval-author` subagent

Evals are **explicitly evaluated** ("do they catch what they claim?"). A
trivially-passing eval is worse than no eval. The subagent's prompt enforces
this — but verify yourself by breaking the rule and confirming the eval fails.

### Tasks

- [x] **7.1** `evals/isolation.eval.ts` — tenant isolation (100%)
  - 4 checks per workspace: getJobList, getApplicationsByJob, getCandidatesForJob, getCandidateSourceBreakdown
  - Row ID prefix assertions; fails structurally if `scopeWhere` is removed
- [x] **7.2** `evals/permissions.eval.ts` — PII gate (100%)
  - Calls getCandidatesForJob + stripPII directly, no LLM
  - analyst: no name/email/phone; recruiter: name present
- [x] **7.3** `evals/quality.eval.ts` — answer quality (~77-82% stochastic)
  - usedCorrectTool (deterministic, 100%); llmJudge (LLM-as-judge, ~55%)
  - Score ceiling is structural — see DECISIONS.md Phase 7

### 7.4 — Commit ✓

---

## Phase 8 — Stretch trade-off analysis + winner

**The brief allows ONE stretch from the list of four technical options.**
Plus deployment (Phase 9) as a separate stretch.

Analyze all four in DECISIONS.md, then implement the winner.

### The four options

| Option                      | What it is                                                         | Demo value                            | Complexity                                                      | Production value                          | Fit for THIS app     |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- | -------------------- |
| **Typed structured answer** | Agent emits a Zod-validated final structure alongside the artifact | Low (invisible)                       | Low-Med                                                         | Medium (downstream type safety)           | Medium               |
| **Resumable streams**       | Reconnect mid-stream after disconnect                              | Low (need a flaky connection to demo) | High                                                            | High (for long answers, mobile)           | Low — overkill       |
| **Response caching**        | Cache tool results by `(workspaceId, tool, params)`                | **High** (visible "instant" re-asks)  | Med (must include workspaceId in key — extends isolation story) | **High** (LLM and DB calls are expensive) | **HIGH**             |
| **Rate limiting**           | Throttle per workspace/user                                        | Low (no visible demo)                 | Low                                                             | High (production reality)                 | Low for a 5-min demo |

### Recommendation: **Response caching**

**Why:**

1. **Reinforces the isolation story** — cache key MUST include `workspaceId`. Forgetting it is the cache-equivalent of forgetting `scopeWhere`. You can talk about this in the Loom and DECISIONS.md.
2. **Demoable** — ask the same question twice, second is instant. Visually obvious.
3. **Real perf win** — LLM tokens cost money; same question shouldn't pay twice.
4. **Composes with PII** — cache the _pre-permission-filter_ data and apply `stripPII` after retrieval, so analyst-cached results don't leak to recruiter (and vice versa, role belongs in the cache key OR the filter is post-cache).

### If you implement caching

- [ ] Cache layer: in-memory `Map` is fine (PGlite is in-memory too)
- [ ] Key: `${workspaceId}::${toolName}::${JSON.stringify(params)}`
- [ ] TTL: 60 seconds (configurable)
- [ ] Cache MISS → run tool, store result, return
- [ ] Cache HIT → return immediately
- [ ] **The PII filter still runs on retrieval** — cache stores unfiltered, filter is per-request based on `ctx.role`
- [ ] Add a hit/miss counter visible in dev (small UI badge or console log) for the Loom

### 8.1 — Write the trade-off analysis in DECISIONS.md ✓

(Documented in DECISIONS.md Phase 0 and expanded in Overview section)

### 8.2 — Implement caching ✓

- [x] Cache layer: module-level `Map<string, { data: unknown; expiresAt: number }>`
- [x] Key: `${workspaceId}::${toolName}::${JSON.stringify(params)}`
- [x] TTL: 60 seconds
- [x] Cache MISS → run tool, store result, return; Cache HIT → return immediately
- [x] **The PII filter still runs on retrieval** — cache stores raw, stripPII per-request
- [x] `[cache HIT]` / `[cache MISS]` console.log for the Loom
- Applied to: applicationsByJob, candidateSourceBreakdown, timeToHireByJob, candidateList
- Excluded: jobList (listings change), applicationCountByStage (reference tool — not touched)

### 8.3 — Eval for caching ✓

- [x] `evals/caching.eval.ts` — 100%
- [x] `resultsAreIdentical`: deep-compare rows1 vs rows2, non-empty guard (no trivial [] === [])
- [x] `secondCallIsFaster`: elapsed2 < elapsed1, relative only (no fixed threshold)

### 8.4 — Commit ✓

```
feat(agent): response caching with workspace-scoped keys
```

- `src/agent/tools.ts`: module-level `toolCache` Map, TTL 60s, applied to 4 tools
- `evals/caching.eval.ts`: `resultsAreIdentical` + `secondCallIsFaster` scorers
- Code-reviewed twice — APPROVED

## Phase 8 — COMPLETE

---

## Phase 9 — Deploy live ✓ COMPLETE

### 9.2 — Swap the DB driver ✓
- [x] `@neondatabase/serverless` installed
- [x] `src/db/client.ts` — `buildDb()` branches on `DATABASE_URL`: Neon (prod) or PGlite (dev/test)
- [x] `src/env.ts` — `DATABASE_URL?: string` added
- [x] Neon seeded: `DATABASE_URL=... pnpm db:seed` (Brightwave + Meridian)

### 9.3 — Configure Vercel ✓
- [x] Repo connected to Vercel, production branch: `ats-analytics-copilot`
- [x] Env vars set: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o`, `DATABASE_URL`
- [x] Deployed — tested prod: both workspaces, roles, tools working

### 9.4 — Document in DECISIONS.md ✓

### 9.5 — Commit

```
feat(db): add Neon serverless driver, deploy to Vercel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### 9.6 — Add the live URL to the PR description

---

## Phase 10 — DECISIONS.md + Loom

**The write-up is judged as heavily as the code.** Do not shortchange this.

### 10.1 — Fill in DECISIONS.md

Required sections (in this order):

1. **Summary** (one paragraph) — what you built, what's live, what's deferred

2. **Provider choice** — why Anthropic + claude-sonnet-4-6, alternatives considered, cost/latency trade-off

3. **Tool catalog design**
   - The list of tools and what each answers
   - Why this granularity (not 2, not 15)
   - How descriptions are tuned for LLM selection

4. **Tenant isolation** — the `scopeWhere` pattern, why it's right by construction, what would break if you forgot

5. **Permissions** — where the gate lives (server-side, post-query, pre-serialization), centralization of `PII_COLUMNS`, why the LLM is not trusted to filter

6. **UI / generative rendering** — the display-hint contract, why the LLM picks the data shape, not the visual

7. **Stretch trade-off analysis** — all four options compared, why caching won, what you'd do next

8. **Deployment** — Vercel + Neon, what changed, trade-offs

9. **What I cut and why** — be honest; cuts signal judgment
   - Example: _"Skipped resumable streams — would have taken 2h and added little demo value for the local-network scenarios the reviewer will use"_
   - Example: _"Skipped admin-specific tools — kept the catalog tight; admin and recruiter have the same data access by spec"_

10. **What I'd do with another day** — shows product thinking
    - Cite-the-rows affordance (every chart bar clickable to inspect the rows behind it)
    - Multi-tool orchestration (LLM chains `jobList` → `candidatesForJob` from a single question)
    - Per-question latency budget + tool-level timeout

11. **Working with the agent** (REQUIRED — brief explicitly asks for this)
    - **What I delegated** — query writing, tool wrapping, component scaffolding, eval bodies
    - **Where it was wrong and I caught it** — be specific, e.g.:
      - _"Claude Code initially put `workspaceId` in the tool's Zod input schema — caught in code review, moved to context"_
      - _"Eval initially asserted on `length > 0` which would pass even with leaked data — rewrote to check `workspaceId` on every row"_
      - _"Permission filter was applied in the UI only — caught in network tab review, moved server-side"_
    - **What I'd never let it decide** — tool catalog shape, scoping pattern, permission boundary location, eval semantics

### 10.2 — Record the Loom (≤5 min)

Script (rehearse once):

- **0:00–0:45 — Architecture** (slide or screen-share of file tree)
  - "The spine: tRPC routes carry workspaceId + role from request headers into context. The agent loop reads context and passes it to tools. Tools never accept workspaceId from the LLM."
- **0:45–3:30 — Live demo**
  - Open the live URL
  - Workspace: Brightwave. Recruiter. Ask three questions — show chart, table, candidate list (with names)
  - Switch role to analyst. Ask for candidates again — names are gone.
  - Switch workspace to Meridian. Ask the same pipeline question. Different data.
  - (If caching shipped) ask a question, then re-ask the same — show the instant return.
- **3:30–5:00 — Trade-offs**
  - "I picked caching as the stretch because it reinforces the isolation story — the cache key must include workspaceId."
  - "I cut resumable streams — high effort, low demo value for this scope."
  - "With another day: per-row drill-down so the user can verify the chart against the underlying rows."
  - One thing you learned.

### 10.3 — Open the PR

- Title: `Product Engineer build exercise — <your name>`
- Description includes:
  - Live URL
  - Loom link
  - Link to each DECISIONS.md section
  - Commit list with one-line summaries
- **Squash if commits are messy** — the brief says "commits that tell a story"

---

## Subagent invocation cheat sheet

Copy-paste templates. Adjust the specifics, keep the structure.

### Query architect

> Use the **query-architect** subagent. Add a function `getXxx(workspaceId: string, ...params)` to `src/db/analytics.ts`. It should:
>
> - Accept these parameters: ...
> - Return this shape: ...
> - Use `scopeWhere` for the workspace filter
> - Mirror the existing `applicationCountByStage` pattern
>   Do not add other functions. Do not modify existing functions.

### Tool builder

> Use the **tool-builder** subagent. Add a tool `xxx` to `src/agent/tools.ts` that wraps the `getXxx` query function. It should:
>
> - Accept these LLM-supplied params: ... (workspaceId is NOT one of them)
> - Read `workspaceId` from execution context
> - Description: "..."
> - Return `{ data, displayHint: { type: 'bar_chart' | 'table' | ... } }`
>   Mirror the existing reference tool's structure exactly.

### UI builder

> Use the **ui-builder** subagent. Create `src/app/components/Xxx.tsx`. Props: `{ data: ... }`. Use Recharts (already in stack) and Tailwind. Match the visual style of any existing component. Component must be dumb — no data fetching, no side effects.

### Eval author

> Use the **eval-author** subagent. Add `evals/xxx.eval.ts` with these cases: ... Each case must include the negative test — i.e. the assertion must fail if the security rule is broken. Follow the pattern in `copilot.eval.ts`.

### Code reviewer

> Use the **code-reviewer** subagent. Review `<file>` against your checklist. Report any issues. Do not modify code — only report.

---

## Final pre-submission checklist

### Code health

- [ ] `pnpm typecheck` — clean
- [ ] `pnpm test` — green
- [ ] `pnpm eval` — green
- [ ] `pnpm build` — succeeds
- [ ] No `any`, no `as`, no `// @ts-ignore` in your changes
- [ ] No `console.log` debugging leftovers

### Security (the two hard requirements)

- [ ] Both workspaces switchable, both return distinct data
- [ ] Each isolation eval fails when `scopeWhere` is removed (proven by you)
- [ ] Analyst role hides PII in the UI AND in the network payload (verified in DevTools)
- [ ] Each permission eval fails when `stripPII` is bypassed (proven by you)
- [ ] No tool's Zod input schema contains `workspaceId`

### Deliverables

- [ ] PR open, title clean, description has live URL + Loom + commit summary
- [ ] CLAUDE.md committed (your version, extending the starter)
- [ ] `.claude/agents/*.md` committed
- [ ] DECISIONS.md has all 11 sections including "Working with the agent"
- [ ] Loom is ≤5 min, demos the live URL, shows isolation + PII + tools
- [ ] Commits tell a story (one per phase, or squashed semantically)

### Sanity

- [ ] You can explain every line of code in the diff without referring to Claude Code
- [ ] You can answer: "what would you do differently if you had a week?"
- [ ] You can answer: "where do you think this would break first under load?"
- [ ] You can answer: "how would a malicious tenant try to break out, and what stops them?"

---

## Anti-goals — explicitly NOT worth your time

- Building real auth (mocked via headers — leave it)
- Adding more seed data (the two workspaces are enough)
- Designing a fancy chat shell (chrome doesn't matter — content does)
- More than 7 tools
- More than 3 component variants (bar + table + optional stat card)
- Refactoring code you didn't have to touch
- Streaming chart rendering (token-by-token chart rebuild — pretty but expensive complexity)
- Multiple stretch options (the brief says at most one)
