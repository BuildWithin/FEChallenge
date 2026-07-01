import { and, count, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import { candidateColumns } from "./permissions";
import type { Role } from "./permissions";
import { applications, candidates, jobs } from "./schema";

/**
 * Scoped analytics data layer for the copilot.
 *
 * This ships with ONE worked example — `applicationCountByStage` — as a
 * reference pattern. Designing the rest of the query layer the copilot needs is
 * part of the exercise (e.g. applications over time, candidates by source,
 * time-to-hire, per-job breakdowns, individual candidates, …).
 *
 * Two hard requirements for everything you add here:
 *  1. TENANT SCOPING — every query is constrained to `ctx.workspaceId`. A query
 *     must never read another workspace's rows. (Route scoping through one
 *     place — see `scopeWhere` — so it can't be forgotten as you add queries.)
 *  2. PERMISSIONS — candidate PII (name / email / phone) must be gated by role;
 *     an `analyst` may not read it (see `src/db/permissions.ts`).
 *
 * The benchmark in `evals/run.ts` verifies both against whatever tools you build.
 */

/**
 * INVARIANTS for every function in this file (keep the layer safe as it grows):
 *  1. `ctx: AnalyticsCtx` is the FIRST parameter — a query can't be written
 *     without its tenant scope.
 *  2. The `.where(...)` clause goes through `scopeWhere(table, ctx, extra)` — the
 *     one place the workspace filter is applied, so it can't be forgotten.
 *  3. Any candidate read selects columns via `candidateColumns(ctx.role)` so PII
 *     is gated by construction (see src/db/permissions.ts).
 */

export type AnalyticsCtx = { workspaceId: string; role: Role };

/** The one place tenant scoping lives: AND-s the workspace filter into a query. */
function scopeWhere(
  table: { workspaceId: AnyColumn },
  ctx: AnalyticsCtx,
  extra: Array<SQL | undefined> = [],
): SQL {
  const parts = [eq(table.workspaceId, ctx.workspaceId), ...extra].filter(
    (p): p is SQL => p !== undefined,
  );
  // Always has at least the workspace filter, so it's never undefined.
  return and(...parts)!;
}

/**
 * REFERENCE QUERY: applications grouped by pipeline stage, scoped to the
 * caller's workspace. Use it as the template for the rest of the layer.
 *
 * `ctx` comes first on purpose: a query can't even be expressed without the
 * tenant scope, so it can't be forgotten.
 */
export async function applicationCountByStage(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
) {
  const extra = opts.jobId ? [eq(applications.jobId, opts.jobId)] : [];
  return db
    .select({ stage: applications.stage, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(applications.stage)
    .orderBy(desc(count()));
}

/** Count candidates grouped by acquisition source, scoped to the workspace. */
export async function candidatesBySource(ctx: AnalyticsCtx) {
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}

/** Applications over time, bucketed by week (default) or month. */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { bucket?: "week" | "month" } = {},
) {
  const bucket = opts.bucket ?? "week";
  const period =
    bucket === "month"
      ? sql<string>`to_char(date_trunc('month', ${applications.appliedAt}), 'YYYY-MM-DD')`
      : sql<string>`to_char(date_trunc('week', ${applications.appliedAt}), 'YYYY-MM-DD')`;
  return db
    .select({ period, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx))
    .groupBy(period)
    .orderBy(period);
}

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
