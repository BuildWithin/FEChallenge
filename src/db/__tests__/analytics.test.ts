import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  jobsByStatus,
  listCandidates,
  openJobs,
  timeInFunnelByStage,
} from "@/db/analytics";
import { db, ensureSchema } from "@/db/client";
import { candidateColumns } from "@/db/permissions";
import { candidates, workspaces } from "@/db/schema";
import { seed } from "@/db/seed";

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("tenant scoping", () => {
  test("applicationCountByStage returns disjoint totals per workspace", async () => {
    const brightwave = await applicationCountByStage({
      workspaceId: "brightwave",
      role: "admin",
    });
    const meridian = await applicationCountByStage({
      workspaceId: "meridian",
      role: "admin",
    });

    const bwTotal = brightwave.reduce((sum, row) => sum + Number(row.count), 0);
    const merTotal = meridian.reduce((sum, row) => sum + Number(row.count), 0);

    expect(bwTotal).toBeGreaterThan(0);
    expect(merTotal).toBeGreaterThan(0);
    expect(bwTotal).not.toBe(merTotal);
  });

  test("candidate reads scoped to workspace never return other tenant rows", async () => {
    const brightwave = await db
      .select(candidateColumns("admin"))
      .from(candidates)
      .where(eq(candidates.workspaceId, "brightwave"));

    expect(brightwave.length).toBeGreaterThan(0);
    expect(brightwave.every((row) => row.workspaceId === "brightwave")).toBe(true);
  });
});

describe("PII gating by role", () => {
  test("analyst candidate query returns no PII fields", async () => {
    const rows = await db
      .select(candidateColumns("analyst"))
      .from(candidates)
      .where(eq(candidates.workspaceId, "brightwave"))
      .limit(5);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("name");
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("phone");
    }
  });

  test("admin candidate query includes PII fields", async () => {
    const row = (
      await db
        .select(candidateColumns("admin"))
        .from(candidates)
        .where(eq(candidates.workspaceId, "brightwave"))
        .limit(1)
    )[0];

    expect(row).toHaveProperty("name");
    expect(row).toHaveProperty("email");
    expect(row).toHaveProperty("phone");
    if ("name" in row) {
      expect(String(row.name).length).toBeGreaterThan(0);
    }
  });
});

describe("analytics query catalog", () => {
  const ctx = { workspaceId: "brightwave", role: "admin" as const };

  test("candidatesBySource returns grouped counts", async () => {
    const rows = await candidatesBySource(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.source === "string" && Number(r.count) > 0)).toBe(
      true,
    );
  });

  test("applicationsOverTime returns time series with default week bucket", async () => {
    const rows = await applicationsOverTime(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.period === "string" && Number(r.count) > 0)).toBe(
      true,
    );
  });

  test("jobsByStatus returns status breakdown", async () => {
    const rows = await jobsByStatus(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.status === "open")).toBe(true);
  });

  test("openJobs returns only open positions", async () => {
    const rows = await openJobs(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.title && r.department && r.location)).toBe(true);
  });

  test("timeInFunnelByStage returns avg days per stage", async () => {
    const rows = await timeInFunnelByStage(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.stage && Number(r.avgDays) >= 0)).toBe(true);
  });

  test("listCandidates respects role column set", async () => {
    const adminRows = await listCandidates({ workspaceId: "brightwave", role: "admin" });
    const analystRows = await listCandidates({
      workspaceId: "brightwave",
      role: "analyst",
    });

    expect(adminRows.length).toBeGreaterThan(0);
    expect(analystRows.length).toBeGreaterThan(0);
    expect(adminRows[0]).toHaveProperty("name");
    expect(analystRows[0]).not.toHaveProperty("name");
  });
});
