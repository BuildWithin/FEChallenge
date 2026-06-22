import { and, count, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
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

export async function getApplicationsByJob(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
): Promise<
  Array<{ jobId: string; jobTitle: string; count: number; avgDaysInPipeline: number }>
> {
  const extra = [
    eq(jobs.workspaceId, ctx.workspaceId),
    ...(opts.jobId ? [eq(applications.jobId, opts.jobId)] : []),
  ];

  const rows = await db
    .select({
      jobId: applications.jobId,
      jobTitle: jobs.title,
      count: count(),
      avgDaysInPipeline: sql<number>`
        round(
          avg(
            extract(epoch from (${applications.updatedAt} - ${applications.appliedAt}))
            / 86400.0
          ),
          1
        )
      `,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(applications.jobId, jobs.title)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    jobId: r.jobId,
    jobTitle: r.jobTitle,
    count: r.count,
    avgDaysInPipeline: Number(r.avgDaysInPipeline),
  }));
}

export async function getCandidateSourceBreakdown(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
): Promise<Array<{ source: string; count: number; percentage: number }>> {
  const extra = [
    eq(candidates.workspaceId, ctx.workspaceId),
    ...(opts.jobId ? [eq(applications.jobId, opts.jobId)] : []),
  ];

  const rows = await db
    .select({
      source: candidates.source,
      count: count(),
    })
    .from(applications)
    .innerJoin(candidates, eq(applications.candidateId, candidates.id))
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(candidates.source)
    .orderBy(desc(count()));

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return rows.map((r) => ({
    source: r.source,
    count: r.count,
    percentage: total === 0 ? 0 : Math.round((r.count / total) * 1000) / 10,
  }));
}

export async function getTimeToHireByJob(
  ctx: AnalyticsCtx,
): Promise<Array<{ jobTitle: string; medianDays: number; hiredCount: number }>> {
  const hiredFilter = eq(applications.stage, "hired");

  const rows = await db
    .select({
      jobTitle: jobs.title,
      hiredCount: count(),
      medianDays: sql<number>`
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY
            extract(epoch from (${applications.updatedAt} - ${applications.appliedAt}))
            / 86400.0
        )
      `,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(scopeWhere(applications, ctx, [hiredFilter]))
    .groupBy(jobs.title)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    jobTitle: r.jobTitle,
    hiredCount: r.hiredCount,
    medianDays: Number(r.medianDays),
  }));
}

export async function getJobList(
  ctx: AnalyticsCtx,
  opts: { status?: string } = {},
): Promise<Array<{ id: string; title: string; status: string; daysOpen: number }>> {
  const extra = opts.status ? [eq(jobs.status, opts.status)] : [];

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      daysOpen: sql<number>`
        floor(
          extract(epoch from (now() - ${jobs.createdAt})) / 86400
        )
      `,
    })
    .from(jobs)
    .where(scopeWhere(jobs, ctx, extra))
    .orderBy(desc(sql`floor(extract(epoch from (now() - ${jobs.createdAt})) / 86400)`));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    daysOpen: Number(r.daysOpen),
  }));
}

export async function getCandidatesForJob(
  ctx: AnalyticsCtx,
  jobId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    stage: string;
    source: string;
    daysSinceApplied: number;
  }>
> {
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      stage: applications.stage,
      source: candidates.source,
      daysSinceApplied: sql<number>`
        floor(
          extract(epoch from (now() - ${applications.appliedAt})) / 86400
        )
      `,
    })
    .from(applications)
    .innerJoin(candidates, eq(applications.candidateId, candidates.id))
    .where(scopeWhere(applications, ctx, [eq(applications.jobId, jobId), eq(candidates.workspaceId, ctx.workspaceId)]))
    .orderBy(desc(applications.appliedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    stage: r.stage,
    source: r.source,
    daysSinceApplied: Number(r.daysSinceApplied),
  }));
}
