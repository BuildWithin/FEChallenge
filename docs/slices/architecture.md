# Architecture slice

How a question becomes a scoped, role-safe, rendered answer. Read this before
touching the data layer, tools, or context.

## Repo layout

```
src/
  db/        Drizzle schema + PGlite client + seed + analytics.ts (query layer) + permissions.ts
  server/    tRPC router + context (carries workspaceId + role from headers)
  agent/     tools.ts · run.ts (streamText loop) · provider.ts · mock-model.ts · artifact.ts
  app/       chat UI, providers, /api/chat, /api/trpc
evals/       agent evals — Evalite *.eval.ts (pnpm eval), currently copilot.eval.ts
```

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Vercel AI SDK v6 · tRPC v11 +
TanStack Query + superjson · Drizzle ORM over PGlite (in-process Postgres,
file-backed at `./.pglite`) · Tailwind v3 · TypeScript strict.

## The worked-example chain

The repo ships one feature end to end — `applicationCountByStage` — as the template
for everything we add. The layers, in order:

1. **Context** ([src/server/context.ts](../../src/server/context.ts)) —
   `Context = { workspaceId, role }`. In this take-home it's derived from the
   `x-workspace` / `x-role` request headers (`tenantFromHeaders`), set by the UI
   switchers. Defaults: `workspaceId = "brightwave"`, `role = "admin"` (demo
   convenience; production would default to least privilege). Authentication is
   stubbed; **authorization is real** and identical regardless of where `ctx`
   comes from.

2. **Analytics / query layer** ([src/db/analytics.ts](../../src/db/analytics.ts)) —
   the ONLY place that touches the DB for the copilot. `AnalyticsCtx =
   { workspaceId, role }`. Every function takes `ctx` first. Tenant scoping lives
   in one helper, `scopeWhere` (see below). This layer owns both invariants:
   tenant scope and PII projection.

3. **Tools** ([src/agent/tools.ts](../../src/agent/tools.ts)) — `buildTools(ctx)`
   closes over `ctx` and returns the AI SDK tool catalog. Each tool validates its
   input with a Zod schema, calls an analytics function with `ctx`, and returns
   `{ rows, display }`. The agent fills params; it never writes SQL. `workspaceId`
   and `role` are NEVER tool inputs — they come from `ctx`.

4. **Artifact contract** ([src/agent/artifact.ts](../../src/agent/artifact.ts)) —
   `ToolResult = { rows: Row[]; display: Display }` where
   `Display = { kind: "table"; columns } | { kind: "bar"; x; y; title } |
   { kind: "line"; x; y; title }`. The shared contract between tools and UI.

5. **Agent loop** ([src/agent/run.ts](../../src/agent/run.ts)) — `streamCopilot`
   wraps `streamText` with the system prompt, the tools, and a step cap
   (`stopWhen: stepCountIs(6)`). Returns the `streamText` result so the chat route
   streams it and evals `await` `.text` / `.steps`. See the model slice for loop
   and error-handling decisions.

6. **UI** ([src/app/page.tsx](../../src/app/page.tsx)) — renders one component per
   tool result as the agent streams, keyed off `display.kind`. See the ui slice.

7. **Eval** ([evals/copilot.eval.ts](../../evals/copilot.eval.ts)) — Evalite runs
   each question through `streamCopilot` and scores deterministically. See the
   evals slice.

There is also a parallel tRPC path
([src/server/routers/app.ts](../../src/server/routers/app.ts)): `analytics.*`
procedures pass `ctx` to the same analytics functions (e.g.
`analytics.applicationsByStage`). Mirror that pattern — `ctx` in, scoped data out —
for any procedure or tool we add.

## The `scopeWhere` pattern (tenant isolation)

`scopeWhere(table, ctx, extra)` AND-s `eq(table.workspaceId, ctx.workspaceId)` into
every query and appends any extra filters. It always returns at least the workspace
predicate, so scope can never be dropped. Rules for the query layer:

- `ctx` is the **first argument** of every analytics function — a query can't be
  expressed without the tenant scope.
- Every `.where(...)` goes through `scopeWhere`. No raw `eq(...workspaceId...)`
  scattered around; one chokepoint.
- Joins must scope **every** tenant-owned table they touch (applications AND the
  candidates/jobs they join), not just the driving table.

## PII by construction (role-typed projection)

PII columns are defined in [src/db/permissions.ts](../../src/db/permissions.ts):
`PII_COLUMNS = { candidates: ["name", "email", "phone"] }`, roles
`admin | recruiter | analyst`. Today `canReadColumn` is a permissive stub — that's
the gap to close.

The approach: make the leak **unrepresentable**, not runtime-rejected. A query that
returns candidate rows should select PII columns only for a non-analyst role, and
its **return type** should reflect that — an `analyst` call yields a row type
without `name`/`email`/`phone`. The wrong-role projection therefore won't typecheck
its way into existence, and the PII eval (run as `analyst`) confirms no PII column
ever appears in tool output. Implementation detail (discriminated return type,
column-set helper, etc.) is decided in the implementation step; the rule is what
matters here.

## Where to start

- [src/db/analytics.ts](../../src/db/analytics.ts) — the reference query +
  `scopeWhere`; build the layer.
- [src/db/permissions.ts](../../src/db/permissions.ts) — enforce PII by role.
- [src/agent/tools.ts](../../src/agent/tools.ts) — the reference tool; design the
  catalog (see tools slice).
- [src/app/page.tsx](../../src/app/page.tsx) — turn tool results into generative UI
  (see ui slice).
- [evals/copilot.eval.ts](../../evals/copilot.eval.ts) — flesh out the
  tenant-isolation & permission evals (see evals slice).
