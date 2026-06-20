import { and, count, desc, eq, inArray, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import { canSeePII, type Role } from "./permissions";
import { applications, candidates, type ApplicationStage, type CandidateSource } from "./schema";

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
