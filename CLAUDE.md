# Working notes (for your AI agent / you)

This is a small, runnable take-home: a multi-tenant **ATS analytics copilot**. An
AI agent chats with a hiring team about **one workspace's** recruiting data (jobs,
candidates, applications), calls tools to answer questions, and renders the results
as charts/tables.

> Make this file yours — you're expected to commit your agent config. Adjust these
> notes as you work.

## The one rule that matters most

**All data access is scoped to the caller's workspace AND role.** Every read must be
constrained to `ctx.workspaceId`, and candidate PII (name / email / phone) must be
gated by role — an `analyst` never sees it. A cross-workspace or PII leak is the
worst bug you can ship here. The reference query in `src/db/analytics.ts`
(`scopeWhere` + `applicationCountByStage`) shows the scoped pattern; extend it so
scope can't be forgotten as the layer grows. The tRPC `analytics.*` procedures pass
`ctx` correctly — mirror that.

**How we enforce it (by construction) — two chokepoints:**

1. `scopeWhere(table, ctx, extra)` — the only WHERE builder; always AND-s the
   workspace filter. Every query fn is `ctx`-first, so it can't be expressed unscoped.
2. `candidateSelection(ctx)` — the only place candidate columns are projected. PII
   columns (name / email / phone) are *never SELECTed* for an `analyst` — the leak is
   unrepresentable, not stripped after the fact. Mirrors `scopeWhere` for column access.

Boundary that keeps it honest: **the agent's tools import from `src/db/analytics.ts`
only** — never `db`, never raw SQL — so no tool can express an unscoped or
PII-leaking query.

## Build a real agent

The repo **boots** on a mock model so it runs on clone and tests stay deterministic,
but the mock is a stand-in — **build your copilot against a real model.** Set
`AI_PROVIDER` to a real provider, or route through a gateway (see `.env.example` and
`src/agent/provider.ts`). Your demo should show the real agent working.

**This build uses OpenAI `gpt-4o-mini`.** Config lives in `.env.local`
(`AI_PROVIDER=openai`, `OPENAI_MODEL=gpt-4o-mini`, `OPENAI_API_KEY=…`). `.env*.local` is
gitignored and is loaded only by `next dev` — **not** by vitest/evalite — so the app talks
to the real model while tests stay on the deterministic mock. `vitest.config.ts` also pins
`AI_PROVIDER=mock` so a local shell export can't push unit tests onto a paid API. Rationale
for the model choice goes in `DECISIONS.md`.

## Decisions (locked)

- **No "tool library" abstraction.** The repo's `buildTools(ctx)` map is already clean;
  the value lives one layer down in the **scoped query catalog** (`analytics.ts`), where
  the two chokepoints above live. Tools stay a thin declarative map over it. (A
  `createScopedQueries(ctx)` factory was considered and rejected as needless cleverness —
  `ctx`-first standalone fns, which the reference already uses, give the same guarantee.)
- **PII gate = role-aware projection**, not post-query redaction (see chokepoint #2).
- **Proof split:** deterministic enforcement (tenant + PII) → fast **vitest** unit tests
  that call the query fns directly; fuzzy agent behavior → **adversarial Evalite** evals
  (analyst asking for PII; cross-tenant comparison) that assert on tool output.

## Scope & build order

Spec-Driven: the work is sliced into sequenced specs under [`specs/`](specs/README.md),
each with a Contract (signatures/types) and a testable acceptance bar. File numbers are
stable; **execution order is `00 → 01 → 02 → 04 → 03 → 05`** — benchmarks (04) run before the
UI (03) so the agent's guardrails are proven against adversarial prompts before any UI is
built on top:

```
00 real agent (OpenAI + prompt)   ~30m   no deps                                                          [done]
01 scoped query layer [HARD REQ]  ~75m   no deps   canReadColumn, candidateSelection, queries, unit tests [done]
02 tool catalog                   ~40m   ← 01      incl. PII-bearing listCandidates                       [done]
04 adversarial evals              ~30m   ← 02      tenant + PII evals (run BEFORE 03)                      [done]
03 generative UI (bar + table)    ~45m   ← 02      tool results → charts/tables
05 applications over time (line)  ~30m   ← 01–03   optional stretch
```

Core 00–04 ≈ the ~4h box. **Cut-line:** drop 05, trim 03 polish, keep 04. The 2-hour
checkpoint = 00 + 01 + unit tests (hard requirements proven against a real agent).

## How to work in this repo

- **Mirror the reference files; don't trust priors for library APIs.** The stack pins
  recent versions — **Vercel AI SDK v6** (`ai@6`), Evalite 1.0-beta, Drizzle 0.41,
  tRPC v11 — and a model's defaults lean toward *older* APIs (v4-style AI SDK especially).
  Copy the patterns already proven in `src/agent/run.ts`, `src/agent/tools.ts`,
  `src/db/analytics.ts`, and `evals/copilot.eval.ts`. Don't introduce an import or API that
  isn't already used here without checking the installed version (`package.json` / the
  installed types).
- **One spec at a time, in dependency order.** Don't start the next spec until the current
  one's acceptance checklist is ticked and `pnpm typecheck` + `pnpm test` are green. For
  Spec 03 (UI), also eyeball the rendered result.
- **Prove guards aren't vacuous.** For tenant/PII enforcement, deliberately break the guard
  (drop the workspace filter / un-gate a PII column) and watch a test go red before trusting
  it green.
- **Keep specs truthful.** If implementation forces a deviation, edit the spec's *Contract*
  first, then write the code — never let `specs/` drift from the codebase.
- **Commit per spec**, message referencing the spec, so history tells the story.

## What's given vs. what you build

- **Given:** the schema + seed (two workspaces), the streaming agent loop, the
  provider layer, the mock (boot/tests only), a minimal chat UI, the tRPC layer, and
  **one worked tool end-to-end** as a reference.
- **You build:** the tool catalog, the query layer behind it, permission
  enforcement, the generative chart UI, and the two benchmark stubs. See `README.md`
  for the full brief.

## Repo layout

```
src/
  db/        Drizzle schema + PGlite client + seed + analytics.ts (query layer) + permissions.ts
  server/    tRPC router + context (carries workspaceId + role from headers)
  agent/     tools.ts · run.ts (streamText loop) · provider.ts · mock-model.ts · artifact.ts
  app/       chat UI, providers, /api/chat, /api/trpc
evals/       agent evals — Evalite *.eval.ts (pnpm eval)
```

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Vercel AI SDK v6 · tRPC v11 +
TanStack Query + superjson · Drizzle ORM over PGlite (in-process Postgres,
file-backed at `./.pglite`) · Tailwind v3 · TypeScript strict.

## Commands

```bash
pnpm install
pnpm db:seed      # wipe + seed the two workspaces (Brightwave, Meridian Logistics)
pnpm dev          # http://localhost:3000
pnpm smoke        # real-model smoke test (uses .env.local; spends tokens) — the manual deliverable check
pnpm eval         # run agent evals once (Evalite, on the mock)
pnpm eval:dev     # Evalite watch + local UI
pnpm typecheck
pnpm test         # vitest
pnpm build
```

## Where to start

- `src/agent/tools.ts` — the reference tool; design the catalog.
- `src/db/analytics.ts` — the reference query + `scopeWhere`; build the layer.
- `src/db/permissions.ts` — enforce PII by role (it's a stub).
- `src/app/page.tsx` — turn tool results into real generative UI (currently a stub).
- `evals/copilot.eval.ts` — Evalite; flesh out the tenant-isolation & permission evals.
