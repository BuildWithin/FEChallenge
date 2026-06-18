import { and, eq, type AnyColumn, type SQL } from "drizzle-orm";

import type { Role } from "./permissions";
import { applications, candidates, jobs } from "./schema";

/**
 * Tenant-scoped data access — the only way analytics queries may filter rows.
 *
 * Call `createScope(ctx)` at the start of every query. The returned helpers
 * always AND-in `workspaceId`, so an unscoped read is hard to express by
 * accident. Join helpers enforce the same workspace on both sides of a join.
 */

export type TenantCtx = { workspaceId: string; role: Role };

/** @deprecated Use TenantCtx — kept for existing imports. */
export type AnalyticsCtx = TenantCtx;

export type DateRangeFilter = {
  dateFrom?: string;
  dateTo?: string;
};

/** Opaque handle proving a query went through createScope(). */
export type ScopedAccess = { readonly __brand: "ScopedAccess"; ctx: TenantCtx };

type TableWithWorkspace = { workspaceId: AnyColumn };

/**
 * AND-s the workspace filter into a WHERE clause. Only accepts a ScopedAccess
 * handle so callers cannot omit tenant context.
 */
export function scopeWhere(
  table: TableWithWorkspace,
  scope: ScopedAccess,
  extra: Array<SQL | undefined> = [],
): SQL {
  const parts = [
    eq(table.workspaceId, scope.ctx.workspaceId),
    ...extra,
  ].filter((p): p is SQL => p !== undefined);
  return and(...parts)!;
}

/** Entry point for tenant-scoped analytics reads. */
export function createScope(ctx: TenantCtx) {
  const access: ScopedAccess = { __brand: "ScopedAccess", ctx };

  return {
    ctx,
    access,

    applicationsWhere(...extra: Array<SQL | undefined>) {
      return scopeWhere(applications, access, extra);
    },

    candidatesWhere(...extra: Array<SQL | undefined>) {
      return scopeWhere(candidates, access, extra);
    },

    jobsWhere(...extra: Array<SQL | undefined>) {
      return scopeWhere(jobs, access, extra);
    },

    /** Join applications → jobs; both sides pinned to ctx.workspaceId. */
    joinApplicationsToJobs() {
      return and(
        eq(applications.jobId, jobs.id),
        eq(applications.workspaceId, ctx.workspaceId),
        eq(jobs.workspaceId, ctx.workspaceId),
      )!;
    },

    /** Join applications → candidates; both sides pinned to ctx.workspaceId. */
    joinApplicationsToCandidates() {
      return and(
        eq(applications.candidateId, candidates.id),
        eq(applications.workspaceId, ctx.workspaceId),
        eq(candidates.workspaceId, ctx.workspaceId),
      )!;
    },

    /**
     * LEFT JOIN applications onto jobs with workspace-safe ON conditions.
     * Extra ON filters (e.g. date range) are AND-ed after the scope guards.
     */
    leftJoinApplicationsOn(extraOn: Array<SQL | undefined> = []) {
      return and(
        eq(applications.jobId, jobs.id),
        eq(applications.workspaceId, ctx.workspaceId),
        ...extraOn,
      )!;
    },
  };
}

export type Scope = ReturnType<typeof createScope>;
