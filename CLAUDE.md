# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is a small, runnable take-home: a multi-tenant **ATS analytics copilot**. An
AI agent chats with a hiring team about **one workspace's** recruiting data (jobs,
candidates, applications), calls tools to answer questions, and renders the results
as charts/tables. See `README.md` for the full brief and `DECISIONS.md` for the
running write-up of trade-offs.

## The one rule that matters most

**All data access is scoped to the caller's workspace AND role.** Every read must be
constrained to `ctx.workspaceId`, and candidate PII (name / email / phone) must be
gated by role — an `analyst` never sees it. A cross-workspace or PII leak is the
worst bug you can ship here. The reference query in `src/db/analytics.ts`
(`scopeWhere` + `applicationCountByStage`) shows the scoped pattern; extend it so
scope can't be forgotten as the layer grows. PII enforcement is currently a **stub**
— `canReadColumn` in `src/db/permissions.ts` returns `true` for everything; closing
that gap (ideally making a PII leak *unrepresentable*, not rejected after the fact)
is part of the exercise.

## Build a real agent

The repo **boots** on a mock model so it runs on clone and tests stay deterministic,
but the mock is a stand-in — **build your copilot against a real model.** Set
`AI_PROVIDER` to a real provider (`anthropic`/`openai`/`bedrock`), or route through a
gateway via `AI_GATEWAY_BASE_URL` (see `.env.example` and `src/agent/provider.ts`).
Your demo should show the real agent working.

## Architecture

Two data paths both derive the tenant `ctx` (`{ workspaceId, role }`) the **same
way** — from the `x-workspace` / `x-role` request headers via
`tenantFromHeaders` in `src/server/context.ts`. Auth is mocked (headers set by UI
switchers); *authorization* off that ctx is real and is what you're building.

1. **Agent path (chat):** `src/app/page.tsx` (`useChat`) → `POST /api/chat`
   (`route.ts`) → `streamCopilot` (`src/agent/run.ts`) → `streamText` loop with
   `buildTools(ctx)` → tools call into the `src/db/analytics.ts` query layer. The
   loop is capped at 6 steps (`stepCountIs(6)`). `run.ts` returns the raw
   `streamText` result so the route can stream it and evals/tests can `await
   result.text` / `result.steps`.
2. **tRPC path (direct UI reads):** `src/server/routers/app.ts` procedures take
   `ctx` and call the same analytics layer. The page uses this for the side-panel
   pipeline read. Mirror the `analytics.applicationsByStage` pattern for new reads.

**ctx threading is the safety mechanism.** `analytics.ts` functions take
`AnalyticsCtx` as their *first* argument and route the workspace filter through the
single `scopeWhere` helper, so a query can't even be expressed without tenant scope.
Keep that property as you add queries.

**Generative-UI contract** (`src/agent/artifact.ts`): every tool returns
`{ rows, display }` where `display` is a `table` | `bar` | `line` hint. `page.tsx`
renders a component per tool result from that hint (currently a bare table stub —
turning it into real streaming charts/tables is part of the exercise).

**Mock model** (`src/agent/mock-model.ts`): generic and deterministic. It picks the
tool whose name/description best overlaps the user's question, calls it with **empty
args**, then summarizes. Two implications: (a) give every tool **sensible optional
params** or the mock breaks, and (b) tests/evals run against it offline by default,
so name/describe tools so the right one is picked for a given question.

**Schema:** Drizzle schema lives in `src/db/schema.ts`, but tables are created from
raw DDL in `src/db/migrate.ts` (no drizzle-kit, for zero-setup boot). If you change
the schema, update the DDL in `migrate.ts` to match column-for-column. PGlite is
file-backed at `./.pglite` and shared between the `db:seed` and `dev` processes via
a `globalThis` handle. The seed creates two workspaces: `brightwave`, `meridian`.

## Commands

```bash
pnpm install
pnpm db:seed      # wipe + seed the two workspaces (Brightwave, Meridian Logistics)
pnpm dev          # http://localhost:3000
pnpm eval         # run agent evals once (Evalite)
pnpm eval:dev     # Evalite watch + local UI (per-test-case traces)
pnpm typecheck    # next typegen && tsc --noEmit
pnpm test         # vitest run
pnpm build

# Run a single vitest file or by name:
pnpm exec vitest run src/agent/__tests__/agent.test.ts
pnpm exec vitest run -t "mock model drives real"
```

## Where to start

- `src/agent/tools.ts` — the reference tool; design the catalog.
- `src/db/analytics.ts` — the reference query + `scopeWhere`; build the layer.
- `src/db/permissions.ts` — enforce PII by role (it's a stub).
- `src/app/page.tsx` — turn tool results into real generative UI (currently a stub).
- `evals/copilot.eval.ts` — Evalite; flesh out the tenant-isolation & permission evals.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Vercel AI SDK v6 · tRPC v11 +
TanStack Query + superjson · Drizzle ORM over PGlite (in-process Postgres) · Evalite
(evals) · Tailwind v3 · TypeScript strict.
