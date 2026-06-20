import { and, count, desc, eq, gte, inArray, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import { canSeePII, type Role } from "./permissions";
import { applications, candidates, jobs, type ApplicationStage, type CandidateSource, type JobStatus, type TimeGranularity } from "./schema";

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

type TenantTable = { workspaceId: AnyColumn };

/**
 * The one place tenant scoping lives. Scopes EVERY tenant-owned table the query
 * touches (the driving table and every joined table), so a join cannot be
 * written with one side unscoped. Pass a single table or the full list.
 *
 * `ctx` is first to match every analytics function: a query can't even be
 * expressed without the tenant scope, so it can't be forgotten.
 */
export function scopeWhere(
  ctx: AnalyticsCtx,
  tables: TenantTable | TenantTable[],
  extra: Array<SQL | undefined> = [],
): SQL {
  const list = Array.isArray(tables) ? tables : [tables];
  const scopes = list.map((t) => eq(t.workspaceId, ctx.workspaceId));
  const parts = [...scopes, ...extra].filter((p): p is SQL => p !== undefined);
  // Always has at least one workspace predicate, so it's never undefined.
  return and(...parts)!;
}

// The PII split for candidates. PII keys MUST match PII_COLUMNS.candidates
// (a test enforces this so they can't drift).
const candidatePublicCols = {
  id: candidates.id,
  source: candidates.source,
  createdAt: candidates.createdAt,
};
export const candidatePiiCols = {
  name: candidates.name,
  email: candidates.email,
  phone: candidates.phone,
};

/**
 * Candidates for this workspace, projected by role: an analyst gets the public
 * columns only (no name/email/phone are even SELECTed), recruiter/admin get PII too.
 * The return type is the union of the two shapes, so a caller cannot read PII without
 * narrowing to the full shape, and analyst rows never satisfy that narrowing.
 */
export async function listCandidates(
  ctx: AnalyticsCtx,
  opts: {
    stage?: ApplicationStage;
    source?: CandidateSource;
    jobId?: string;
    limit?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 20, 100);

  const filters: Array<SQL | undefined> = [];
  if (opts.source) filters.push(eq(candidates.source, opts.source));

  // stage/jobId live on applications -> "candidate has >=1 matching application",
  // expressed as a SCOPED subquery (applications scoped via scopeWhere).
  const appPreds: SQL[] = [];
  if (opts.stage) appPreds.push(eq(applications.stage, opts.stage));
  if (opts.jobId) appPreds.push(eq(applications.jobId, opts.jobId));
  if (appPreds.length > 0) {
    filters.push(
      inArray(
        candidates.id,
        db
          .select({ id: applications.candidateId })
          .from(applications)
          .where(scopeWhere(ctx, applications, appPreds)),
      ),
    );
  }

  const where = scopeWhere(ctx, candidates, filters);

  if (canSeePII(ctx.role)) {
    return db
      .select({ ...candidatePublicCols, ...candidatePiiCols })
      .from(candidates)
      .where(where)
      .limit(limit);
  }
  return db.select(candidatePublicCols).from(candidates).where(where).limit(limit);
}

/**
 * Application volume over time, scoped to the caller's workspace. Buckets
 * applications by day/week/month on appliedAt and counts each bucket. Buckets
 * with no applications are simply absent (we don't fill gaps); the line in the
 * UI connects the buckets that have data. Single table, so scopeWhere covers it.
 */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { granularity?: TimeGranularity; from?: string; to?: string; jobId?: string } = {},
) {
  const granularity = opts.granularity ?? "week";
  // granularity is a closed enum, bound as a parameter (no SQL injection).
  const bucket = sql<string>`to_char(date_trunc(${granularity}, ${applications.appliedAt}), 'YYYY-MM-DD')`;

  const extra: Array<SQL | undefined> = [];
  if (opts.jobId) {
    extra.push(eq(applications.jobId, opts.jobId));
  }
  if (opts.from) {
    extra.push(gte(applications.appliedAt, new Date(opts.from)));
  }
  if (opts.to) {
    extra.push(lte(applications.appliedAt, new Date(opts.to)));
  }

  // Group/order by the first select column's ordinal so the bucket expression
  // (and its bound granularity param) is emitted only once. Repeating the SQL
  // object rebinds the param each time, and Postgres then fails to match the
  // GROUP BY to the SELECT.
  return db
    .select({ bucket, count: count() })
    .from(applications)
    .where(scopeWhere(ctx, applications, extra))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

/**
 * Jobs in this workspace with their application counts pivoted by stage, plus a
 * total. Surfaces each job's id and title so the model can turn a job title into
 * a jobId for the other tools. A LEFT JOIN keeps jobs that have no applications
 * (they come back as zeros). Both tenant tables are scoped through scopeWhere:
 * jobs in the WHERE, applications in the JOIN's ON so the LEFT JOIN is preserved.
 */
export async function jobsOverview(
  ctx: AnalyticsCtx,
  opts: { status?: JobStatus } = {},
) {
  // count(applications.id) is null-safe: a job with no applications has a single
  // left-joined NULL row, which neither the FILTER counts nor the total counts.
  const stageCount = (stage: ApplicationStage) =>
    sql<number>`count(${applications.id}) filter (where ${applications.stage} = ${stage})`.mapWith(Number);

  const statusExtra = opts.status ? [eq(jobs.status, opts.status)] : [];

  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      applied: stageCount("applied"),
      screen: stageCount("screen"),
      interview: stageCount("interview"),
      offer: stageCount("offer"),
      hired: stageCount("hired"),
      rejected: stageCount("rejected"),
      total: sql<number>`count(${applications.id})`.mapWith(Number),
    })
    .from(jobs)
    .leftJoin(
      applications,
      and(eq(applications.jobId, jobs.id), scopeWhere(ctx, applications)),
    )
    .where(scopeWhere(ctx, jobs, statusExtra))
    .groupBy(jobs.id, jobs.title, jobs.status)
    .orderBy(jobs.createdAt);
}

/**
 * Applications grouped by the candidate's source (referral, linkedin, ...), scoped
 * to the caller's workspace. source lives on candidates, so this joins applications
 * -> candidates; both tenant tables are scoped together via the array form of
 * scopeWhere. Sources with no applications simply do not appear.
 */
export async function applicationsBySource(
  ctx: AnalyticsCtx,
  opts: { from?: string; to?: string; jobId?: string } = {},
) {
  const extra: Array<SQL | undefined> = [];
  if (opts.jobId) {
    extra.push(eq(applications.jobId, opts.jobId));
  }
  if (opts.from) {
    extra.push(gte(applications.appliedAt, new Date(opts.from)));
  }
  if (opts.to) {
    extra.push(lte(applications.appliedAt, new Date(opts.to)));
  }

  return db
    .select({ source: candidates.source, count: count() })
    .from(applications)
    .innerJoin(candidates, eq(applications.candidateId, candidates.id))
    .where(scopeWhere(ctx, [applications, candidates], extra))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
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
    .where(scopeWhere(ctx, applications, extra))
    .groupBy(applications.stage)
    .orderBy(desc(count()));
}
