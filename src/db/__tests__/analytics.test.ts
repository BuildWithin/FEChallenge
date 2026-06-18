import { beforeAll, describe, expect, test } from "vitest";

import { db, ensureSchema } from "../client";
import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  candidatesInStage,
  jobPerformance,
  listJobs,
  stageConversionRates,
  timeToHire,
} from "../analytics";
import { workspaces } from "../schema";
import { seed } from "../seed";

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("analytics queries", () => {
  const brightwave = { workspaceId: "brightwave", role: "admin" as const };
  const meridian = { workspaceId: "meridian", role: "admin" as const };

  test("applicationCountByStage returns workspace-scoped rows", async () => {
    const rows = await applicationCountByStage(brightwave);
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    expect(total).toBe(24); // 18 candidates + 6 with second applications
  });

  test("candidatesBySource returns only current workspace data", async () => {
    const bw = await candidatesBySource(brightwave);
    const mer = await candidatesBySource(meridian);
    const bwTotal = bw.reduce((s, r) => s + Number(r.count), 0);
    const merTotal = mer.reduce((s, r) => s + Number(r.count), 0);
    expect(bwTotal).toBe(18);
    expect(merTotal).toBe(14);
  });

  test("applicationsOverTime returns time buckets", async () => {
    const rows = await applicationsOverTime(brightwave);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.period).toBeTruthy();
      expect(Number(row.count)).toBeGreaterThan(0);
    }
  });

  test("timeToHire returns metrics for hired applications", async () => {
    const rows = await timeToHire(brightwave);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].hiredCount)).toBeGreaterThan(0);
    expect(Number(rows[0].avgDays)).toBeGreaterThan(0);
  });

  test("stageConversionRates returns ordered funnel rows", async () => {
    const rows = await stageConversionRates(brightwave);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].stage).toBe("applied");
    expect(rows[0].pctOfTotal).toBeGreaterThan(0);
  });

  test("jobPerformance returns jobs with application counts", async () => {
    const rows = await jobPerformance(brightwave);
    expect(rows.length).toBe(5);
    expect(rows.some((r) => Number(r.applicationCount) > 0)).toBe(true);
  });

  test("listJobs filters by status", async () => {
    const open = await listJobs(brightwave, { status: "open" });
    expect(open.every((j) => j.status === "open")).toBe(true);
    expect(open.length).toBe(3);
  });

  test("candidatesInStage returns candidates for a stage", async () => {
    const rows = await candidatesInStage(brightwave, { stage: "interview" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.stage === "interview")).toBe(true);
    expect(rows[0]).toHaveProperty("name");
  });

  test("candidatesInStage hides PII for analyst role", async () => {
    const analyst = { workspaceId: "brightwave", role: "analyst" as const };
    const rows = await candidatesInStage(analyst, { stage: "interview" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveProperty("candidateId");
      expect(row).not.toHaveProperty("name");
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("phone");
    }
  });

  test("candidatesInStage still returns PII for recruiter role", async () => {
    const recruiter = { workspaceId: "brightwave", role: "recruiter" as const };
    const rows = await candidatesInStage(recruiter, { stage: "interview" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("name");
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).toHaveProperty("phone");
  });

  test("cross-workspace isolation: meridian totals differ from brightwave", async () => {
    const bwStages = await applicationCountByStage(brightwave);
    const merStages = await applicationCountByStage(meridian);
    const bwTotal = bwStages.reduce((s, r) => s + Number(r.count), 0);
    const merTotal = merStages.reduce((s, r) => s + Number(r.count), 0);
    expect(bwTotal).not.toBe(merTotal);
    expect(merTotal).toBe(19); // 14 candidates + 5 with second applications
  });

  test("no analytics query leaks foreign workspace job IDs", async () => {
    const rows = await jobPerformance(meridian);
    expect(rows.every((r) => r.jobId.startsWith("mer-"))).toBe(true);
    expect(rows.some((r) => r.jobId.startsWith("bw-"))).toBe(false);
  });

  test("candidatesInStage scoped to meridian excludes brightwave candidates", async () => {
    const rows = await candidatesInStage(meridian, { stage: "applied" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => String(r.candidateId).startsWith("mer-"))).toBe(true);
  });
});
