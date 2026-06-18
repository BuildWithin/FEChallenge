import {
  and,
  avg,
  count,
  desc,
  eq,
  exists,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "./client";
import type { ApplicationFilters } from "./filters";
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
export type {
  AnalyticsFilters,
  ApplicationFilters,
  ApplicationSource,
} from "./filters";
export { APPLICATION_SOURCES, ANALYTICS_FILTER_DOCS } from "./filters";

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

/** Active hiring funnel — excludes terminal rejected stage. */
const FUNNEL_STAGES = [
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
] as const;

export type StageConversionOptions = ApplicationFilters & {
  /** When true, funnel metrics cover applied → hired only (excludes rejected). */
  funnelOnly?: boolean;
};

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function applicationDateFilters(
  filters: Pick<ApplicationFilters, "dateFrom" | "dateTo"> = {},
): Array<SQL | undefined> {
  const from = parseDate(filters.dateFrom);
  const to = parseDate(filters.dateTo);
  return [
    from ? gte(applications.appliedAt, from) : undefined,
    to ? lte(applications.appliedAt, to) : undefined,
  ];
}

function sourceExistsFilter(
  scope: ReturnType<typeof createScope>,
  source: ApplicationFilters["source"],
): SQL | undefined {
  if (!source) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(candidates)
      .where(
        and(
          eq(candidates.id, applications.candidateId),
          eq(candidates.workspaceId, scope.ctx.workspaceId),
          eq(candidates.source, source),
        ),
      ),
  );
}

function departmentExistsFilter(
  scope: ReturnType<typeof createScope>,
  department: ApplicationFilters["department"],
): SQL | undefined {
  if (!department) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, applications.jobId),
          eq(jobs.workspaceId, scope.ctx.workspaceId),
          eq(jobs.department, department),
        ),
      ),
  );
}

function applicationWhere(
  scope: ReturnType<typeof createScope>,
  filters: ApplicationFilters = {},
) {
  return scope.applicationsWhere(
    filters.jobId ? eq(applications.jobId, filters.jobId) : undefined,
    filters.stage ? eq(applications.stage, filters.stage) : undefined,
    ...applicationDateFilters(filters),
    sourceExistsFilter(scope, filters.source),
    departmentExistsFilter(scope, filters.department),
  );
}

/** ON clause for LEFT JOIN applications → jobs (jobPerformance). */
function applicationJoinOn(
  scope: ReturnType<typeof createScope>,
  filters: ApplicationFilters = {},
) {
  return and(
    scope.leftJoinApplicationsOn(applicationDateFilters(filters)),
    filters.jobId ? eq(applications.jobId, filters.jobId) : undefined,
    sourceExistsFilter(scope, filters.source),
  );
}

function jobWhere(scope: ReturnType<typeof createScope>, filters: JobFilters = {}) {
  return scope.jobsWhere(
    filters.status ? eq(jobs.status, filters.status) : undefined,
    filters.department ? eq(jobs.department, filters.department) : undefined,
  );
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

/** Application counts grouped by candidate acquisition source. */
export async function candidatesBySource(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  return db
    .select({ source: candidates.source, count: count() })
    .from(applications)
    .innerJoin(candidates, scope.joinApplicationsToCandidates())
    .where(applicationWhere(scope, opts))
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
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  const daysToHire = sql<number>`extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400`;

  return db
    .select({
      avgDays: avg(daysToHire),
      hiredCount: count(),
    })
    .from(applications)
    .where(applicationWhere(scope, { ...opts, stage: "hired" }));
}

/** Pipeline funnel: count, share of total, and step-to-step conversion per stage. */
export async function stageConversionRates(
  ctx: AnalyticsCtx,
  opts: StageConversionOptions = {},
) {
  const scope = createScope(ctx);
  const rows = await db
    .select({ stage: applications.stage, count: count() })
    .from(applications)
    .where(applicationWhere(scope, opts))
    .groupBy(applications.stage);

  const countByStage = new Map(rows.map((r) => [r.stage, Number(r.count)]));
  const stageOrder = opts.funnelOnly ? FUNNEL_STAGES : STAGE_ORDER;
  const relevantRows = opts.funnelOnly
    ? rows.filter((r) =>
        (FUNNEL_STAGES as readonly string[]).includes(r.stage),
      )
    : rows;
  const total = relevantRows.reduce((sum, r) => sum + Number(r.count), 0);

  return stageOrder
    .filter((stage) => countByStage.has(stage))
    .map((stage, index) => {
      const stageCount = countByStage.get(stage) ?? 0;
      const prevStage = index > 0 ? stageOrder[index - 1] : null;
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
    });
}

/**
 * Source effectiveness: hires vs rejections (and in-progress) by acquisition channel.
 * Uses application terminal stage — no PII columns.
 */
export async function sourceEffectiveness(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  const hiredCount = sql<number>`count(*) filter (where ${applications.stage} = 'hired')`;
  const rejectedCount = sql<number>`count(*) filter (where ${applications.stage} = 'rejected')`;
  const inProgressCount = sql<number>`count(*) filter (where ${applications.stage} not in ('hired', 'rejected'))`;

  const rows = await db
    .select({
      source: candidates.source,
      totalApplications: count(),
      hiredCount,
      rejectedCount,
      inProgressCount,
    })
    .from(applications)
    .innerJoin(candidates, scope.joinApplicationsToCandidates())
    .where(applicationWhere(scope, opts))
    .groupBy(candidates.source)
    .orderBy(desc(hiredCount));

  return rows.map((row) => {
    const total = Number(row.totalApplications);
    const hired = Number(row.hiredCount);
    const rejected = Number(row.rejectedCount);
    const inProgress = Number(row.inProgressCount);

    return {
      source: row.source,
      totalApplications: total,
      hiredCount: hired,
      rejectedCount: rejected,
      inProgressCount: inProgress,
      hireRate: total > 0 ? Math.round((hired / total) * 1000) / 10 : 0,
      rejectionRate: total > 0 ? Math.round((rejected / total) * 1000) / 10 : 0,
    };
  });
}

/**
 * Pipeline velocity: average days applications spend at each stage.
 * Uses updatedAt − appliedAt as dwell time (current schema has no stage history).
 */
export async function pipelineVelocity(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters = {},
) {
  const scope = createScope(ctx);
  const daysInStage = sql<number>`extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400`;

  const rows = await db
    .select({
      stage: applications.stage,
      avgDays: avg(daysInStage),
      applicationCount: count(),
    })
    .from(applications)
    .where(applicationWhere(scope, opts))
    .groupBy(applications.stage);

  const byStage = new Map(
    rows.map((r) => [
      r.stage,
      {
        stage: r.stage,
        avgDays:
          r.avgDays != null
            ? Math.round(Number(r.avgDays) * 10) / 10
            : 0,
        applicationCount: Number(r.applicationCount),
      },
    ]),
  );

  return STAGE_ORDER.filter((stage) => byStage.has(stage)).map(
    (stage) => byStage.get(stage)!,
  );
}

/** Application counts per job with job metadata. */
export async function jobPerformance(
  ctx: AnalyticsCtx,
  opts: ApplicationFilters & { status?: string } = {},
) {
  const scope = createScope(ctx);
  const { status, ...filters } = opts;

  return db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      department: jobs.department,
      status: jobs.status,
      applicationCount: count(applications.id),
    })
    .from(jobs)
    .leftJoin(applications, applicationJoinOn(scope, filters))
    .where(jobWhere(scope, { status, department: filters.department }))
    .groupBy(jobs.id, jobs.title, jobs.department, jobs.status)
    .orderBy(desc(count(applications.id)));
}

export type CandidatesInStageOptions = ApplicationFilters & {
  stage: string;
};

/** Candidates currently in a given pipeline stage (PII gated by role). */
export async function candidatesInStage(
  ctx: AnalyticsCtx,
  opts: CandidatesInStageOptions,
) {
  const scope = createScope(ctx);
  const where = applicationWhere(scope, opts);

  if (canReadColumn(ctx.role, "candidates", "name")) {
    return db
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
      .where(where)
      .orderBy(desc(applications.appliedAt));
  }

  return db
    .select({
      candidateId: candidates.id,
      source: candidates.source,
      stage: applications.stage,
      jobId: applications.jobId,
      appliedAt: applications.appliedAt,
    })
    .from(applications)
    .innerJoin(candidates, scope.joinApplicationsToCandidates())
    .where(where)
    .orderBy(desc(applications.appliedAt));
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
