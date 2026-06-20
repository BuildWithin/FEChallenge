import { and, count, desc, eq, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import type { Role } from "./permissions";
import { applications } from "./schema";

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
