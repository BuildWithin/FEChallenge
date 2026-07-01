# Phase 2 — Tool catalog + query layer

> Build guide for the copilot's actual capabilities. On top of the Phase 1
> security core, we add the scoped query functions and the tools that expose them
> to the agent. The agent picks tools and passes high-level params — **it never
> writes SQL**.

**Where it fits:** Phase 2 of [docs/implementationPlan.md](implementationPlan.md).
Depends on Phase 1 (`scopeWhere`, `candidateColumns`, invariants) — merge
[`feature/security-tenant`](implementationPlan.md#git-workflow-one-branch--one-pr-per-phase) before starting.

## Git workflow

| Item | Value |
| --- | --- |
| **Branch** | `feature/tool-catalog` |
| **Focus** | AI tool catalog + scoped analytics query layer |
| **Base** | `main` (after Phase 1 PR is merged) |
| **PR target** | `main` |
| **Opens after** | `feature/security-tenant` merged |

**Workflow:** `git checkout main && git pull`, then `git checkout -b feature/tool-catalog`.

**Acceptance:**
- 3-4 robust analytical tools beyond the reference, all with **optional** inputs.
- Every query goes through `scopeWhere`; every candidate read uses
  `candidateColumns(ctx.role)`.
- `pnpm typecheck` + `pnpm test` green; each tool is callable with `{}` (mock model
  calls tools with empty args).

---

## Files touched

| File | Change |
| --- | --- |
| [src/db/analytics.ts](../src/db/analytics.ts) | Add scoped query fns: `candidatesBySource`, `applicationsOverTime`, `jobsByStatus`, `timeInFunnelByStage`, `listCandidates` (PII-gated). |
| [src/agent/tools.ts](../src/agent/tools.ts) | Register the tools in `buildTools(ctx)` with optional Zod inputs + `display` hints. |
| [src/server/routers/app.ts](../src/server/routers/app.ts) | *(Optional)* mirror read-only queries as tRPC procedures for the side panel/typed client. |

---

## The critical constraint: mock model calls tools with empty args

From [src/agent/mock-model.ts](../src/agent/mock-model.ts) (lines 19-23): the mock
"calls tools with EMPTY args, so give your tools sensible OPTIONAL params." Every
tool `inputSchema` field **must be `.optional()`** or the app breaks offline. Query
fns must therefore have working defaults when params are absent.

---

## Design decisions (why)

1. **Tool granularity = one analytical question each.** Each tool maps to a chart
   the UI can render, so the model picks a tool and the answer is groundable. Avoid
   a single mega-tool with a `mode` param — it's harder for the model to drive and
   harder to render.
2. **Inputs are high-level and optional.** `jobId?`, `status?`, `bucket?` — never
   raw SQL fragments. Optional keeps mock compatibility and lets the model omit
   what it doesn't know.
3. **`display` hint chosen per tool** so the generative UI (Phase 4) needs no
   per-tool code: `bar` for categorical counts, `line` for time series, `table`
   for lists.
4. **PII is the query layer's job.** `listCandidates` returns different columns by
   role via `candidateColumns` — it is the deliberate surface that proves
   enforcement (tested in Phase 3).

---

## Step 1 — Query functions in `src/db/analytics.ts`

All follow the invariants from Phase 1: `ctx` first, `scopeWhere` in the `where`,
`candidateColumns(ctx.role)` for candidate reads.

### 1a. `candidatesBySource` (bar)

```ts
import { candidates, jobs } from "./schema";

/** Count candidates grouped by acquisition source, scoped to the workspace. */
export async function candidatesBySource(ctx: AnalyticsCtx) {
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}
```

Non-PII (only `source` + count), so no `candidateColumns` needed — but still
scoped.

### 1b. `applicationsOverTime` (line)

Bucket applications by week using `appliedAt`. PGlite is Postgres, so
`date_trunc` works via `sql`.

```ts
import { sql } from "drizzle-orm";
import { applications } from "./schema";

/** Applications over time, bucketed by week (default) or month. */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { bucket?: "week" | "month" } = {},
) {
  const bucket = opts.bucket ?? "week";
  const period = sql<string>`to_char(date_trunc(${bucket}, ${applications.appliedAt}), 'YYYY-MM-DD')`;
  return db
    .select({ period, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx))
    .groupBy(period)
    .orderBy(period);
}
```

### 1c. `jobsByStatus` (bar) + open-jobs convenience

```ts
/** Count jobs grouped by status (open/closed/draft), scoped. */
export async function jobsByStatus(ctx: AnalyticsCtx) {
  return db
    .select({ status: jobs.status, count: count() })
    .from(jobs)
    .where(scopeWhere(jobs, ctx))
    .groupBy(jobs.status)
    .orderBy(desc(count()));
}

/** List open jobs (title/department/location), scoped. */
export async function openJobs(ctx: AnalyticsCtx) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      department: jobs.department,
      location: jobs.location,
    })
    .from(jobs)
    .where(scopeWhere(jobs, ctx, [eq(jobs.status, "open")]))
    .orderBy(jobs.title);
}
```

### 1d. `timeInFunnelByStage` (bar)

Average days between `appliedAt` and `updatedAt` per stage — a proxy for
time-in-stage given the seed shape.

```ts
import { avg } from "drizzle-orm";

/** Avg days from applied → last update, grouped by current stage. */
export async function timeInFunnelByStage(ctx: AnalyticsCtx) {
  const avgDays = sql<number>`avg(extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400)`;
  return db
    .select({ stage: applications.stage, avgDays })
    .from(applications)
    .where(scopeWhere(applications, ctx))
    .groupBy(applications.stage)
    .orderBy(desc(avgDays));
}
```

### 1e. `listCandidates` (table) — PII-gated

The showcase for construction-time enforcement. Columns come from
`candidateColumns(ctx.role)`, so an analyst's result has no PII keys at all.

```ts
import { candidateColumns } from "./permissions";

/** List candidates, scoped. Columns depend on role (analyst omits PII). */
export async function listCandidates(
  ctx: AnalyticsCtx,
  opts: { source?: string; limit?: number } = {},
) {
  const extra = opts.source ? [eq(candidates.source, opts.source)] : [];
  return db
    .select(candidateColumns(ctx.role))
    .from(candidates)
    .where(scopeWhere(candidates, ctx, extra))
    .orderBy(candidates.createdAt)
    .limit(opts.limit ?? 25);
}
```

---

## Step 2 — Register tools in `src/agent/tools.ts`

Extend `buildTools(ctx)` (see [src/agent/tools.ts](../src/agent/tools.ts)). Keep
the `result(rows, display)` helper. All inputs optional. Crisp descriptions so the
model routes correctly.

```ts
import { z } from "zod";
import {
  applicationCountByStage,
  candidatesBySource,
  applicationsOverTime,
  jobsByStatus,
  openJobs,
  timeInFunnelByStage,
  listCandidates,
  type AnalyticsCtx,
} from "@/db/analytics";

// inside buildTools(ctx), alongside the reference tool:

candidatesBySource: tool({
  description:
    "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site).",
  inputSchema: z.object({}),
  async execute() {
    const rows = await candidatesBySource(ctx);
    return result(rows, { kind: "bar", x: "source", y: "count", title: "Candidates by source" });
  },
}),

applicationsOverTime: tool({
  description:
    "Application volume over time, bucketed by week (default) or month. Use for trends.",
  inputSchema: z.object({ bucket: z.enum(["week", "month"]).optional() }),
  async execute({ bucket }) {
    const rows = await applicationsOverTime(ctx, { bucket });
    return result(rows, { kind: "line", x: "period", y: "count", title: "Applications over time" });
  },
}),

jobsByStatus: tool({
  description: "Count jobs grouped by status (open, closed, draft).",
  inputSchema: z.object({}),
  async execute() {
    const rows = await jobsByStatus(ctx);
    return result(rows, { kind: "bar", x: "status", y: "count", title: "Jobs by status" });
  },
}),

openJobs: tool({
  description: "List currently open jobs (title, department, location).",
  inputSchema: z.object({}),
  async execute() {
    const rows = await openJobs(ctx);
    return result(rows, { kind: "table", columns: ["title", "department", "location"] });
  },
}),

timeInFunnel: tool({
  description: "Average days spent in the funnel per pipeline stage (proxy for time-to-stage).",
  inputSchema: z.object({}),
  async execute() {
    const rows = await timeInFunnelByStage(ctx);
    return result(rows, { kind: "bar", x: "stage", y: "avgDays", title: "Avg days in funnel by stage" });
  },
}),

listCandidates: tool({
  description:
    "List candidates in this workspace. Contact details (name/email/phone) are only returned for roles permitted to see them; analysts get anonymized rows.",
  inputSchema: z.object({
    source: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  async execute({ source, limit }) {
    const rows = await listCandidates(ctx, { source, limit });
    const columns = Object.keys(rows[0] ?? { id: null });
    return result(rows, { kind: "table", columns });
  },
}),
```

> `listCandidates` builds its `columns` from the actual returned keys, so the table
> header automatically reflects the role-safe column set (no PII header for analyst).

---

## Step 3 (optional) — mirror read-only queries via tRPC

If time allows, expose the categorical reads through tRPC so the side panel can
show more than pipeline-by-stage. Mirror the existing pattern in
[src/server/routers/app.ts](../src/server/routers/app.ts):

```ts
analytics: router({
  applicationsByStage: publicProcedure /* ...existing... */,
  candidatesBySource: publicProcedure.query(({ ctx }) => candidatesBySource(ctx)),
  jobsByStatus: publicProcedure.query(({ ctx }) => jobsByStatus(ctx)),
}),
```

`ctx` already carries `{ workspaceId, role }`, so these stay scoped for free.
Skip if the time box is tight — the tools are the priority.

---

## Verification

```bash
pnpm db:seed
pnpm typecheck
pnpm test
```

What to assert:
- `pnpm typecheck` passes with the new fns and tools.
- The existing agent test still passes (mock drives a tool call).
- Manually in `pnpm dev`: ask "Where are candidates coming from?", "Show
  application trend", "What jobs are open?" — the mock routes to a plausible tool
  and rows come back.
- Switch role to `analyst`, ask "list candidates" → returned rows have no
  name/email/phone.

> Because the mock calls tools with `{}`, confirm every tool returns sensible data
> with no args (defaults applied).

---

## Definition of done

- [ ] `candidatesBySource`, `applicationsOverTime`, `jobsByStatus`, `openJobs`, `timeInFunnelByStage`, `listCandidates` added, all scoped via `scopeWhere`.
- [ ] `listCandidates` selects via `candidateColumns(ctx.role)` (no PII for analyst).
- [ ] Tools registered in `buildTools`, all inputs optional, correct `display` hints.
- [ ] (Optional) tRPC procedures mirrored.
- [ ] `pnpm typecheck` + `pnpm test` green; every tool works with empty args.

---

## Phase commit message

```
feat(tools): add scoped analytics query layer + tool catalog
```

**PR title (suggested):** `feat(tools): analytics query layer + AI tool catalog`

**Branch:** `feature/tool-catalog` → `main`
