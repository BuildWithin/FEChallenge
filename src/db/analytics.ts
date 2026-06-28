import { and, count, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import { canReadPII, type Role } from "./permissions";
import { applications, candidates, jobs } from "./schema";

/**
 * Scoped analytics data layer for the copilot.
 *
 * Two hard requirements hold for everything in this file, and both are enforced
 * by construction rather than by remembering to check:
 *
 *  1. TENANT SCOPING — every query AND-s in the workspace filter through the one
 *     `scopeWhere` helper. `ctx` is the FIRST argument of every query, so a
 *     query can't even be expressed without its tenant scope.
 *  2. PERMISSIONS — every candidate read goes through `candidateColumns(role)`,
 *     which only adds PII columns (name / email / phone) to the projection when
 *     the role permits. For an `analyst` the executed SQL never references PII,
 *     so a leak is unrepresentable, not filtered after the fact.
 *
 * The agent never writes SQL — it calls tools (src/agent/tools.ts) that call
 * these functions. Keep both invariants intact as the layer grows.
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
 * The one place candidate columns are chosen. PII columns are added to the
 * projection ONLY when the role permits — so an `analyst`'s query never selects
 * name / email / phone at all. Route every candidate read through this; there is
 * no other supported way to project a candidate, which is what makes a PII leak
 * unrepresentable instead of merely filtered.
 */
function candidateColumns(role: Role) {
  const safe = {
    id: candidates.id,
    source: candidates.source,
    createdAt: candidates.createdAt,
  };
  if (!canReadPII(role)) return safe;
  return {
    ...safe,
    name: candidates.name,
    email: candidates.email,
    phone: candidates.phone,
  };
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

/** Candidates grouped by acquisition source (referral, linkedin, …). No PII. */
export async function candidatesBySource(ctx: AnalyticsCtx) {
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}

/** Jobs in the workspace, optionally filtered by status (open / closed / draft). */
export async function listJobs(
  ctx: AnalyticsCtx,
  opts: { status?: string } = {},
) {
  const extra = opts.status ? [eq(jobs.status, opts.status)] : [];
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      department: jobs.department,
      location: jobs.location,
      status: jobs.status,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(scopeWhere(jobs, ctx, extra))
    .orderBy(desc(jobs.createdAt));
}

/**
 * Application volume bucketed over time (default by week), for trend lines.
 * Optionally scoped to one job.
 */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { jobId?: string; bucket?: "day" | "week" | "month" } = {},
) {
  // Whitelisted, then inlined as raw text (not a bind param) so the SELECT and
  // GROUP BY render the IDENTICAL expression — Postgres matches grouped columns
  // syntactically, and two differently-numbered binds would not match.
  const bucket = ({ day: "day", week: "week", month: "month" } as const)[
    opts.bucket ?? "week"
  ];
  const period = sql<string>`to_char(date_trunc('${sql.raw(bucket)}', ${applications.appliedAt}), 'YYYY-MM-DD')`;
  const extra = opts.jobId ? [eq(applications.jobId, opts.jobId)] : [];
  return db
    .select({ period, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(period)
    .orderBy(period);
}

/**
 * Average days from application to last update among HIRED applications — a
 * proxy for time-to-hire. Optionally scoped to one job.
 */
export async function timeToHire(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
) {
  const extra = [
    eq(applications.stage, "hired"),
    ...(opts.jobId ? [eq(applications.jobId, opts.jobId)] : []),
  ];
  return db
    .select({
      avgDaysToHire: sql<number>`round(avg(extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400)::numeric, 1)`,
      hires: count(),
    })
    .from(applications)
    .where(scopeWhere(applications, ctx, extra));
}

/**
 * Individual candidates in the workspace, newest first. PII-GATED: the selected
 * columns depend on `ctx.role` via `candidateColumns`, so an `analyst` gets only
 * id / source / createdAt — never name / email / phone. Optionally filtered by
 * source.
 */
export async function listCandidates(
  ctx: AnalyticsCtx,
  opts: { source?: string; limit?: number } = {},
) {
  const extra = opts.source ? [eq(candidates.source, opts.source)] : [];
  return db
    .select(candidateColumns(ctx.role))
    .from(candidates)
    .where(scopeWhere(candidates, ctx, extra))
    .orderBy(desc(candidates.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}
