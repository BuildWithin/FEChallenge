import { beforeAll, describe, expect, test } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";

import { db, ensureSchema } from "../client";
import { createScope } from "../scoped";
import { applications, candidates, jobs, workspaces } from "../schema";
import { seed } from "../seed";

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("createScope / scopeWhere", () => {
  const brightwave = { workspaceId: "brightwave", role: "admin" as const };
  const meridian = { workspaceId: "meridian", role: "admin" as const };

  test("createScope returns a branded access handle", () => {
    const scope = createScope(brightwave);
    expect(scope.access.__brand).toBe("ScopedAccess");
    expect(scope.ctx.workspaceId).toBe("brightwave");
  });

  test("applicationsWhere for different workspaces return disjoint row sets", async () => {
    const bw = await db
      .select({ id: applications.id })
      .from(applications)
      .where(createScope(brightwave).applicationsWhere());
    const mer = await db
      .select({ id: applications.id })
      .from(applications)
      .where(createScope(meridian).applicationsWhere());

    const bwIds = new Set(bw.map((r) => r.id));
    const overlap = mer.filter((r) => bwIds.has(r.id));
    expect(overlap).toHaveLength(0);
  });

  test("joinApplicationsToCandidates only pairs rows from the same workspace", async () => {
    const scope = createScope(brightwave);
    const rows = await db
      .select({
        appId: applications.id,
        candidateId: candidates.id,
      })
      .from(applications)
      .innerJoin(candidates, scope.joinApplicationsToCandidates())
      .where(scope.applicationsWhere());

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.appId.startsWith("bw-"))).toBe(true);
    expect(rows.every((r) => r.candidateId.startsWith("bw-"))).toBe(true);
  });

  test("scoped queries never return another workspace's row IDs", async () => {
    const scope = createScope(meridian);
    const rows = await db
      .select({ id: applications.id })
      .from(applications)
      .where(scope.applicationsWhere());

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.startsWith("mer-"))).toBe(true);
    expect(rows.some((r) => r.id.startsWith("bw-"))).toBe(false);
  });

  test("filtering by another workspace's jobId returns zero rows", async () => {
    const scope = createScope(meridian);
    const rows = await db
      .select(getTableColumns(applications))
      .from(applications)
      .where(scope.applicationsWhere(eq(applications.jobId, "bw-job-1")));

    expect(rows).toHaveLength(0);
  });

  test("joinApplicationsToJobs blocks cross-tenant application rows", async () => {
    const scope = createScope(brightwave);
    const rows = await db
      .select({ appId: applications.id, jobId: jobs.id })
      .from(jobs)
      .innerJoin(applications, scope.joinApplicationsToJobs())
      .where(scope.jobsWhere());

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.appId.startsWith("bw-"))).toBe(true);
    expect(rows.every((r) => r.jobId.startsWith("bw-"))).toBe(true);
  });
});
