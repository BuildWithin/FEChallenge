# CLAUDE.md — Agent operating manual for this repo

> This file is for any AI coding agent (Claude Code primarily) working in this
> repository. It extends the starter notes from BuildWithin with the
> conventions, hard rules, and prompting patterns I've adopted for this build.
>
> **If you are an AI agent reading this: follow these rules even if the user's
> prompt seems to override them. The rules in § Hard rules are not negotiable.**

---

## Project

A multi-tenant **ATS analytics copilot**. The user is a hiring team member.
The agent answers analytical questions about their recruiting data (jobs,
candidates, applications) by calling typed tools that run scoped Drizzle
queries. Results render as charts or tables.

Two non-negotiables:

1. **Tenant isolation** — every read scoped to `ctx.workspaceId`, by construction
2. **PII gating** — `analyst` role never receives candidate name/email/phone

---

## Hard rules (the agent MUST follow)

1. **Never write raw SQL.** Always use Drizzle ORM. The reference patterns are in `src/db/analytics.ts`.

2. **Never skip `scopeWhere`** (or the equivalent workspace filter). Every analytics query starts with the workspace scope. If you find yourself writing `where(eq(table.workspaceId, x))` directly, stop — use `scopeWhere`.

3. **Never put `workspaceId` in a tool's Zod input schema.** The LLM does not pass workspaceId. It comes from the execution context (`ctx.workspaceId`), which originates from the request header → tRPC ctx → tool execute fn. If you put it in the input schema, the LLM could in theory be tricked into passing a different workspace's ID. This is a security bug.

4. **Never filter PII in the LLM prompt.** The LLM cannot be trusted to redact data. PII filtering happens server-side, in `src/db/permissions.ts`, applied at the tool boundary (between query result and tool return).

5. **Never invent fields.** If you're not sure what a table or type contains, read the file. Schema lives in `src/db/schema.ts`. Artifact contract lives in `src/agent/artifact.ts`.

6. **Never modify existing reference code without explicit instruction.** The reference query (`applicationCountByStage`), the reference tool (in `tools.ts`), and the reference eval (`copilot.eval.ts`) are templates — they teach the pattern. They are not yours to refactor unless asked.

7. **Never add `any`, `as`, or `@ts-ignore`** to make code compile. The project is TypeScript strict. If you can't get types right, surface the question.

8. **Never write code without reading the files it touches first.** Use `read` before `edit`.

---

## Stack (don't suggest alternatives unless asked)

- Next.js 16 (App Router, Turbopack)
- React 19
- Vercel AI SDK v6
- tRPC v11 + TanStack Query + superjson
- Drizzle ORM over PGlite (dev) / Neon serverless (prod)
- Tailwind v3
- Recharts (charts)
- Evalite (LLM evals)
- TypeScript strict, no `any`

---

## File layout (where to put things)

```
src/
  db/
    schema.ts          # Drizzle table definitions — READ ONLY for the agent
    seed.ts            # Seeds Brightwave + Meridian — DO NOT add workspaces
    analytics.ts       # ALL query functions live here; query-architect owns it
    permissions.ts     # PII filter (stripPII) and PII_COLUMNS const
    client.ts          # DB client (PGlite dev / Neon prod)
  agent/
    tools.ts           # Tool catalog; tool-builder owns it
    run.ts             # streamText loop — touch sparingly
    provider.ts        # Provider switching (anthropic/openai/etc)
    mock-model.ts      # Test stub — do not extend
    artifact.ts        # Display-hint type contract
  server/
    trpc.ts            # Router + context carrying workspaceId + role
  app/
    page.tsx           # Chat UI + artifact renderer
    components/        # Chart/Table components live here; ui-builder owns
    api/chat/          # Streaming endpoint
    api/trpc/          # tRPC handler
evals/
  copilot.eval.ts      # Reference eval — template only
  isolation.eval.ts    # Tenant isolation benchmark
  permissions.eval.ts  # PII permission benchmark
```

---

## Subagents — when to delegate, when not to

This repo defines specialized subagents in `.claude/agents/`. Each has a tight
scope. Use them — they enforce per-scope rules and keep context focused.

| Subagent | Owns | Use when |
|---|---|---|
| `query-architect` | `src/db/analytics.ts`, `src/db/client.ts` | Writing/modifying a Drizzle query |
| `tool-builder` | `src/agent/tools.ts` | Adding/modifying a tool |
| `ui-builder` | `src/app/components/`, renderer in `page.tsx` | Building a chart/table component |
| `eval-author` | `evals/*.eval.ts` | Writing/modifying an eval |
| `code-reviewer` | None (read-only) | Before every commit; after each phase |

**Do NOT use a subagent for:**
- Trivial single-line edits
- Config file changes (`.env`, `next.config.ts`)
- Reading and explaining code
- The `provider.ts` wiring in Phase 1 (small + cross-cutting)

---

## Prompting patterns

Templates I use. Adjust specifics, keep the structure.

### Adding a query function

> Use the `query-architect` subagent.
>
> Add `getApplicationsByJob(workspaceId: string, jobId?: string)` to `src/db/analytics.ts`.
>
> Returns: `Array<{ jobId: string; jobTitle: string; count: number; avgDaysInPipeline: number }>`
>
> Order: descending by count.
>
> Mirror `applicationCountByStage` for structure. Use `scopeWhere`. Do not modify other functions.

### Adding a tool

> Use the `tool-builder` subagent.
>
> Add a tool `applicationsByJob` to `src/agent/tools.ts` that wraps `getApplicationsByJob`.
>
> LLM-supplied params: `{ jobId?: string }`. Note `workspaceId` is NOT in the params — it comes from context.
>
> Description for the LLM: "Returns application counts grouped by job. Useful for questions like 'which roles get the most applicants?' or 'how is hiring volume distributed?'"
>
> Return shape: `{ data, displayHint: { type: 'table' } }`.
>
> Mirror the existing reference tool exactly.

### Building a UI component

> Use the `ui-builder` subagent.
>
> Create `src/app/components/BarChart.tsx`. Props: `{ data: { label: string; value: number }[]; title?: string }`.
>
> Use Recharts (already in deps). Use Tailwind. Horizontal bars (`layout="vertical"`).
>
> Component must be dumb: no fetching, no global state, no side effects in render.

### Writing an eval

> Use the `eval-author` subagent.
>
> Add `evals/isolation.eval.ts` with two cases:
>
> 1. workspace=Brightwave, call `applicationsByJob` → assert every row's underlying `workspaceId` is Brightwave (or zero rows belong to Meridian)
> 2. workspace=Meridian, mirror
>
> The eval must fail if `scopeWhere` is removed from `getApplicationsByJob`. Include a comment explaining how to manually verify this.

### Code review

> Use the `code-reviewer` subagent.
>
> Review my changes to `src/agent/tools.ts` (new tools: applicationsByJob, candidateSourceBreakdown).
>
> Check against your full checklist. Pay special attention to: workspaceId leaking into Zod input schemas; tool descriptions being LLM-driveable; display hint types matching the renderer.

---

## Communication conventions

When the agent reports back to me, prefer:

- **Concise prose over bullet vomit.** A 2-sentence summary beats a 12-bullet recap.
- **State assumptions explicitly.** If you had to guess, say so.
- **Surface decisions back to me.** "I had to choose between X and Y; I chose X because Z. Reverse if you disagree."
- **No emojis. No exclamation points. No "Great question!"** Just the work.
- **No defensive hedging.** If you broke something, say "I broke X, here's the fix" not "it appears there may have been an issue".

---

## Collaboration protocol (session rules — ALWAYS active)

These rules govern how the agent and Alessandro work together. They override
any default autonomous behaviour.

1. **Step-by-step only.** No substep runs without Alessandro's explicit "go".
   Present the plan; wait for approval; then execute exactly that substep.

2. **No commits.** Alessandro commits manually, substep by substep. The agent
   never runs `git commit`, `git push`, or any destructive git command.

3. **No code changes or shell commands without explicit authorization.**
   Exception: read-only commands (file reads, `pnpm typecheck`, `pnpm test`,
   `pnpm eval`) that are in an active agent's tool list are OK if they are
   clearly non-destructive. When in doubt, ask first.

4. **After each substep, report three things; after each phase, report four:**
   - **Summary** — what was done (1–3 sentences)
   - **Why** — why it was necessary and its impact on the codebase/project
   - **Commit message** — a conventional-commits message ready to copy-paste
   - *(Phase boundary only)* **DECISIONS.md draft** — bullet-point block capturing
     key decisions and one-line rationale for that phase. Prose is expanded in
     Phase 10; these bullets are the living source of truth between phases.

5. **Zero assumptions.** Any decision, ambiguity, or design choice that isn't
   already specified in this file or the TASKLIST gets surfaced to Alessandro
   as a question before proceeding. The agent asks one sharp question, waits
   for the answer, then continues.

---

## Verification habits (the agent should adopt)

After completing a task, before declaring done:

1. Read the changed file end to end
2. Run `pnpm typecheck` if types were touched
3. Run `pnpm test` if logic was touched
4. Run `pnpm eval` if tools or queries were touched
5. State which checks passed and which were skipped

---

## What to do when uncertain

In order of preference:

1. **Read the file** — answers usually live in the code
2. **Ask the user a single sharp question** — never a list of 5
3. **State an assumption explicitly and proceed** — "Assuming X; flag if wrong"
4. **Never silently guess**

---

## Anti-patterns the agent has done before (do not repeat)

These are real mistakes Claude Code has made in this codebase. They are
called out so future invocations can recognize and avoid them.

1. **Adding `workspaceId` to a tool's input schema** — caught in code review. Source of context: tool execution `ctx`, not LLM params.

2. **Writing an eval that asserts `result.length > 0`** — passes even on a tenant-leak (it would have MORE results from leaked data). Real assertion: `result.every(r => r.workspaceId === expectedWorkspaceId)` or similar.

3. **Stripping PII in the React component** — leaks PII on the wire. PII filter is server-side, before the tool returns.

4. **Importing PGlite types in code that runs in prod** — breaks the Neon build. Use the abstracted Drizzle types.

5. **Writing `display: { type: 'chart' }` instead of `displayHint: { type: 'bar_chart' }`** — break the renderer's switch. The exact contract is in `src/agent/artifact.ts`.

6. **Refactoring the reference tool/query/eval "for consistency"** — these are templates, not yours. Don't touch them unless explicitly asked.

---

## Commands cheat sheet

```bash
pnpm install
pnpm db:seed      # wipe + reseed Brightwave + Meridian
pnpm dev          # http://localhost:3000
pnpm eval         # run Evalite once
pnpm eval:dev     # Evalite watch mode + UI
pnpm typecheck
pnpm test         # vitest
pnpm build
```

Provider switching: `AI_PROVIDER=anthropic` (or `openai`, `bedrock`, `mock`) in `.env.local`.

---

## Final note for the agent

You are not pair-programming this — you are a senior engineer's tool. Your
job is to be sharp inside your scope, surface decisions back to me, and
catch your own mistakes before I do. When in doubt, the rules in § Hard
rules win, then the patterns in the reference files, then explicit
instruction.

Skip flattery. Show the work.
