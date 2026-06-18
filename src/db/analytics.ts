import {
  and,
  avg,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "./client";
import { canReadColumn } from "./permissions";
import {
  createScope,
  type AnalyticsCtx,
  type DateRangeFilter,
} from "./scoped";
import { applications, candidates, jobs } from "./schema";

/**
 * Scoped analytics data layer for the copilot.
 *
 * Every exported query takes `ctx` first and calls `createScope(ctx)` before
 * touching the database. All reads go through scoped helpers — never raw
 * `eq(table.workspaceId, …)` outside src/db/scoped.ts.
 */

export type { AnalyticsCtx, TenantCtx } from "./scoped";

export type ApplicationFilters = DateRangeFilter & {
  jobId?: string;
  source?: string;
  stage?: string;
};

export type JobFilters = {
  status?: string;
  department?: string;
};

export type { DateRangeFilter } from "./scoped";

const STAGE_ORDER = [
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function applicationDateFilters(
  filters: DateRangeFilter = {},
): Array<SQL | undefined> {
  const from = parseDate(filters.dateFrom);
  const to = parseDate(filters.dateTo);
  return [
    from ? gte(applications.appliedAt, from) : undefined,
    to ? lte(applications.appliedAt, to) : undefined,
  ];
}

function applicationWhere(
  scope: ReturnType<typeof createScope>,
  filters: ApplicationFilters = {},
) {
  return scope.applicationsWhere(
    filters.jobId ? eq(applications.jobId, filters.jobId) : undefined,
    filters.stage ? eq(applications.stage, filters.stage) : undefined,
    ...applicationDateFilters(filters),
  );
}

function jobWhere(scope: ReturnType<typeof createScope>, filters: JobFilters = {}) {
  return scope.jobsWhere(
    filters.status ? eq(jobs.status, filters.status) : undefined,
    filters.department ? eq(jobs.department, filters.department) : undefined,
  );
}

function candidateDateFilters(
  filters: DateRangeFilter = {},
): Array<SQL | undefined> {
  const from = parseDate(filters.dateFrom);
  const to = parseDate(filters.dateTo);
  return [
    from ? gte(candidates.createdAt, from) : undefined,
    to ? lte(candidates.createdAt, to) : undefined,
  ];
}

/** Applications grouped by pipeline stage, scoped to the caller's workspace. */
export async function applicationCountByStage(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  return db
    .select({ stage: applications.stage, count: count() })
    .from(applications)
    .where(applicationWhere(scope, opts))
    .groupBy(applications.stage)
    .orderBy(desc(count()));
}

/** Candidate counts grouped by acquisition source. */
export async function candidatesBySource(
  ctx: AnalyticsCtx,
  opts: DateRangeFilter = {},
) {
  const scope = createScope(ctx);
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scope.candidatesWhere(...candidateDateFilters(opts)))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}

/** Application volume over time (monthly buckets by default). */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters & { granularity?: "month" | "week" } = {},
) {
  const scope = createScope(ctx);
  const granularity = opts.granularity ?? "month";
  const bucket =
    granularity === "week"
      ? sql`date_trunc('week', ${applications.appliedAt})`
      : sql`date_trunc('month', ${applications.appliedAt})`;
  const period = sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`;

  return db
    .select({ period, count: count() })
    .from(applications)
    .where(applicationWhere(scope, opts))
    .groupBy(bucket)
    .orderBy(bucket);
}

/** Average days from application to hire for hired candidates. */
export async function timeToHire(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters & { department?: string } = {},
) {
  const scope = createScope(ctx);
  const daysToHire = sql<number>`extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400`;
  const baseWhere = applicationWhere(scope, { ...opts, stage: "hired" });

  if (opts.department) {
    return db
      .select({
        avgDays: avg(daysToHire),
        hiredCount: count(),
      })
      .from(applications)
      .innerJoin(jobs, scope.joinApplicationsToJobs())
      .where(
        and(baseWhere, eq(jobs.department, opts.department)),
      );
  }

  return db
    .select({
      avgDays: avg(daysToHire),
      hiredCount: count(),
    })
    .from(applications)
    .where(baseWhere);
}

/** Pipeline funnel: count and share of total applications per stage. */
export async function stageConversionRates(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  const rows = await db
    .select({ stage: applications.stage, count: count() })
    .from(applications)
    .where(applicationWhere(scope, opts))
    .groupBy(applications.stage);

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
  const countByStage = new Map(rows.map((r) => [r.stage, Number(r.count)]));

  return STAGE_ORDER.filter((stage) => countByStage.has(stage)).map(
    (stage, index) => {
      const stageCount = countByStage.get(stage) ?? 0;
      const prevStage = index > 0 ? STAGE_ORDER[index - 1] : null;
      const prevCount = prevStage ? (countByStage.get(prevStage) ?? 0) : null;

      return {
        stage,
        count: stageCount,
        pctOfTotal: total > 0 ? Math.round((stageCount / total) * 1000) / 10 : 0,
        conversionFromPrevious:
          prevCount && prevCount > 0
            ? Math.round((stageCount / prevCount) * 1000) / 10
            : null,
      };
    },
  );
}

/** Application counts per job with job metadata. */
export async function jobPerformance(
  ctx: AnalyticsCtx,
  opts: JobFilters & DateRangeFilter = {},
) {
  const scope = createScope(ctx);

  return db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      department: jobs.department,
      status: jobs.status,
      applicationCount: count(applications.id),
    })
    .from(jobs)
    .leftJoin(
      applications,
      scope.leftJoinApplicationsOn(applicationDateFilters(opts)),
    )
    .where(jobWhere(scope, opts))
    .groupBy(jobs.id, jobs.title, jobs.department, jobs.status)
    .orderBy(desc(count(applications.id)));
}

/** Candidates currently in a given pipeline stage (PII gated by role). */
export async function candidatesInStage(
  ctx: AnalyticsCtx,
  opts: { stage: string; jobId?: string; source?: string },
) {
  const scope = createScope(ctx);
  const showPii = canReadColumn(ctx.role, "candidates", "name");

  const rows = await db
    .select({
      candidateId: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      source: candidates.source,
      stage: applications.stage,
      jobId: applications.jobId,
      appliedAt: applications.appliedAt,
    })
    .from(applications)
    .innerJoin(candidates, scope.joinApplicationsToCandidates())
    .where(
      scope.applicationsWhere(
        eq(applications.stage, opts.stage),
        opts.jobId ? eq(applications.jobId, opts.jobId) : undefined,
        opts.source ? eq(candidates.source, opts.source) : undefined,
      ),
    )
    .orderBy(desc(applications.appliedAt));

  return rows.map((row) => {
    if (showPii) return row;
    return {
      candidateId: row.candidateId,
      source: row.source,
      stage: row.stage,
      jobId: row.jobId,
      appliedAt: row.appliedAt,
    };
  });
}

/** List jobs in the workspace with optional status/department filters. */
export async function listJobs(ctx: AnalyticsCtx, opts: JobFilters = {}) {
  const scope = createScope(ctx);
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
    .where(jobWhere(scope, opts))
    .orderBy(desc(jobs.createdAt));
}
