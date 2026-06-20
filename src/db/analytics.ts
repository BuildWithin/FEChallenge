import {
  and,
  count,
  desc,
  eq,
  inArray,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "./client";
import { canReadColumn, type Role } from "./permissions";
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

/** Applications grouped into ISO weeks, oldest first, scoped to the workspace. */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
): Promise<{ week: string; count: number }[]> {
  const extra = opts.jobId ? [eq(applications.jobId, opts.jobId)] : [];
  const week = sql<string>`to_char(date_trunc('week', ${applications.appliedAt}), 'IYYY-"W"IW')`;

  return db
    .select({ week, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(week)
    .orderBy(week);
}

/** A candidate row as projected for the UI; PII keys may be absent (see below). */
export type CandidateRow = Record<string, unknown>;

/**
 * CHOKEPOINT #2 — the ONLY place candidate columns are projected.
 *
 * Non-PII columns (id / source / createdAt) are always selected. The PII
 * columns (name / email / phone) are selected ONLY when `canReadColumn` allows
 * them for `ctx.role`. Because an analyst's PII columns are never added to the
 * selection, they can't appear in any result row — the leak is unrepresentable,
 * not redacted after the query runs. Mirrors `scopeWhere` for column access.
 */
export function candidateSelection(ctx: AnalyticsCtx): Record<string, AnyColumn> {
  const selection: Record<string, AnyColumn> = {
    id: candidates.id,
    source: candidates.source,
    createdAt: candidates.createdAt,
  };
  const pii: Record<string, AnyColumn> = {
    name: candidates.name,
    email: candidates.email,
    phone: candidates.phone,
  };
  for (const [column, col] of Object.entries(pii)) {
    if (canReadColumn(ctx.role, "candidates", column)) selection[column] = col;
  }
  return selection;
}

/** Candidate intake grouped by acquisition source, scoped to the workspace. */
export async function candidatesBySource(
  ctx: AnalyticsCtx,
): Promise<{ source: string; count: number }[]> {
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}

/**
 * Per-job overview with its application volume, scoped to the workspace. Uses a
 * LEFT JOIN so jobs with zero applications still appear (count 0). The WHERE is
 * scoped through `scopeWhere(jobs, ...)`, and the join itself ANDs the workspace
 * filter onto `applications` — so the count never folds in another tenant's rows
 * even if a foreign application referenced one of this workspace's job ids.
 * (Defense in depth: it doesn't lean on job ids being globally unique.)
 */
export async function jobsOverview(ctx: AnalyticsCtx): Promise<
  { id: string; title: string; department: string; status: string; applications: number }[]
> {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      department: jobs.department,
      status: jobs.status,
      applications: count(applications.id),
    })
    .from(jobs)
    .leftJoin(
      applications,
      and(
        eq(applications.jobId, jobs.id),
        eq(applications.workspaceId, ctx.workspaceId),
      ),
    )
    .where(scopeWhere(jobs, ctx))
    .groupBy(jobs.id, jobs.title, jobs.department, jobs.status)
    .orderBy(desc(count(applications.id)));
}

/**
 * Individual candidates — PII-BEARING. Columns vary by role via
 * `candidateSelection` (analyst rows omit name/email/phone keys entirely).
 *
 * Filters are optional and composable through `scopeWhere` extras:
 *  - `source` filters candidates directly.
 *  - `stage` / `jobId` live on `applications`, so they match candidates that
 *    have an application satisfying them — via a subquery that is itself scoped
 *    through `scopeWhere(applications, ...)`, so tenant scope holds on both sides.
 */
export async function listCandidates(
  ctx: AnalyticsCtx,
  opts: { source?: string; stage?: string; jobId?: string; limit?: number } = {},
): Promise<CandidateRow[]> {
  const { source, stage, jobId, limit } = opts;

  const extra: Array<SQL | undefined> = [
    source ? eq(candidates.source, source) : undefined,
  ];

  if (stage || jobId) {
    const appConds = [
      stage ? eq(applications.stage, stage) : undefined,
      jobId ? eq(applications.jobId, jobId) : undefined,
    ];
    extra.push(
      inArray(
        candidates.id,
        db
          .select({ id: applications.candidateId })
          .from(applications)
          .where(scopeWhere(applications, ctx, appConds)),
      ),
    );
  }

  const query = db
    // The columns are PgColumns; the contract types the helper as the broader
    // AnyColumn, so narrow it back for drizzle's pg `select`.
    .select(candidateSelection(ctx) as Record<string, PgColumn>)
    .from(candidates)
    .where(scopeWhere(candidates, ctx, extra))
    .orderBy(desc(candidates.createdAt));

  const rows = limit !== undefined ? await query.limit(limit) : await query;
  return rows as CandidateRow[];
}
