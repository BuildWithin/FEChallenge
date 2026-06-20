import { beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidateSelection,
  candidatesBySource,
  jobsOverview,
  listCandidates,
  type AnalyticsCtx,
} from "./analytics";
import { db, ensureSchema } from "./client";
import { canReadColumn } from "./permissions";
import { seed } from "./seed";
import { applications, workspaces } from "./schema";

/**
 * Acceptance for Spec 01 — proven by calling the query fns directly (no model).
 *
 * Two guarantees, enforced by construction in the query layer:
 *  1. TENANT — a fn scoped to one workspace never returns another's rows.
 *  2. PII — an `analyst` can't read candidate name/email/phone, because those
 *     columns are never SELECTed for that role (not stripped afterward).
 *
 * To see these aren't vacuous: drop the workspace filter in `scopeWhere` and the
 * tenant tests go red; re-add the PII columns unconditionally in
 * `candidateSelection` and the "PII hidden" test goes red.
 */

const BW = { workspaceId: "brightwave", role: "admin" } satisfies AnalyticsCtx;
const MER = { workspaceId: "meridian", role: "admin" } satisfies AnalyticsCtx;

// Seeded ground truth (src/db/seed.ts).
const BW_CANDIDATES = 18;
const MER_CANDIDATES = 14;
const BW_JOBS = 5;
const MER_JOBS = 4;

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("canReadColumn", () => {
  it("blocks an analyst from candidate PII", () => {
    for (const column of ["name", "email", "phone"]) {
      expect(canReadColumn("analyst", "candidates", column)).toBe(false);
    }
  });

  it("lets an analyst read non-PII candidate columns", () => {
    for (const column of ["id", "source", "createdAt"]) {
      expect(canReadColumn("analyst", "candidates", column)).toBe(true);
    }
  });

  it("lets recruiter and admin read PII", () => {
    for (const role of ["recruiter", "admin"] as const) {
      for (const column of ["name", "email", "phone"]) {
        expect(canReadColumn(role, "candidates", column)).toBe(true);
      }
    }
  });
});

describe("candidateSelection", () => {
  it("omits PII columns for an analyst, keeps the non-PII ones", () => {
    const keys = Object.keys(candidateSelection({ ...BW, role: "analyst" }));
    expect(keys).toEqual(expect.arrayContaining(["id", "source", "createdAt"]));
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("phone");
  });

  it("includes PII columns for recruiter and admin", () => {
    for (const role of ["recruiter", "admin"] as const) {
      const keys = Object.keys(candidateSelection({ ...BW, role }));
      expect(keys).toEqual(
        expect.arrayContaining(["id", "source", "createdAt", "name", "email", "phone"]),
      );
    }
  });
});

describe("tenant scoping", () => {
  it("listCandidates returns only the caller's workspace", async () => {
    const bw = await listCandidates(BW);
    expect(bw).toHaveLength(BW_CANDIDATES);
    expect(bw.every((r) => String(r.id).startsWith("bw-"))).toBe(true);
    expect(bw.some((r) => String(r.id).startsWith("mer-"))).toBe(false);

    const mer = await listCandidates(MER);
    expect(mer).toHaveLength(MER_CANDIDATES);
    expect(mer.every((r) => String(r.id).startsWith("mer-"))).toBe(true);
    expect(mer.some((r) => String(r.id).startsWith("bw-"))).toBe(false);
  });

  it("jobsOverview returns only the caller's workspace", async () => {
    const bw = await jobsOverview(BW);
    expect(bw).toHaveLength(BW_JOBS);
    expect(bw.every((j) => j.id.startsWith("bw-"))).toBe(true);

    const mer = await jobsOverview(MER);
    expect(mer).toHaveLength(MER_JOBS);
    expect(mer.every((j) => j.id.startsWith("mer-"))).toBe(true);
  });

  it("jobsOverview counts only same-workspace applications (the join is scoped)", async () => {
    // A Meridian application that points at a Brightwave job id. The job-id FK is
    // satisfiable across workspaces, so without the workspace filter on the join
    // this would inflate Brightwave's count — the regression we're guarding.
    const POISON = "poison-app-cross-tenant";
    const jobId = "bw-job-1";
    const before = (await jobsOverview(BW)).find((j) => j.id === jobId)!.applications;

    await db.insert(applications).values({
      id: POISON,
      workspaceId: "meridian",
      candidateId: "mer-cand-1",
      jobId,
      stage: "applied",
      appliedAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      const after = (await jobsOverview(BW)).find((j) => j.id === jobId)!.applications;
      expect(after).toBe(before); // the foreign application is not counted
    } finally {
      await db.delete(applications).where(eq(applications.id, POISON));
    }
  });

  it("candidatesBySource counts only the caller's workspace", async () => {
    const total = (rows: { count: number }[]) =>
      rows.reduce((sum, r) => sum + Number(r.count), 0);

    expect(total(await candidatesBySource(BW))).toBe(BW_CANDIDATES);
    expect(total(await candidatesBySource(MER))).toBe(MER_CANDIDATES);
  });

  it("applicationsOverTime counts only the caller's workspace", async () => {
    const total = (rows: { count: number }[]) =>
      rows.reduce((sum, row) => sum + Number(row.count), 0);
    const applicationTotal = async (ctx: AnalyticsCtx) =>
      total(await applicationCountByStage(ctx));

    expect(total(await applicationsOverTime(BW))).toBe(await applicationTotal(BW));
    expect(total(await applicationsOverTime(MER))).toBe(await applicationTotal(MER));
  });
});

describe("applicationsOverTime", () => {
  it("returns chronological ISO-week buckets", async () => {
    const rows = await applicationsOverTime(BW);
    const weeks = rows.map((row) => row.week);

    expect(rows.length).toBeGreaterThan(1);
    expect(weeks.every((week) => /^\d{4}-W\d{2}$/.test(week))).toBe(true);
    expect(weeks).toEqual([...weeks].sort());
  });

  it("optionally filters to one job", async () => {
    const jobId = "bw-job-1";
    const rows = await applicationsOverTime(BW, { jobId });
    const stageRows = await applicationCountByStage(BW, { jobId });
    const total = (values: { count: number }[]) =>
      values.reduce((sum, row) => sum + Number(row.count), 0);

    expect(total(rows)).toBe(total(stageRows));
  });
});

describe("listCandidates — PII gating", () => {
  it("an analyst's rows carry NO name/email/phone keys", async () => {
    const rows = await listCandidates({ workspaceId: "brightwave", role: "analyst" });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty("name");
      expect(r).not.toHaveProperty("email");
      expect(r).not.toHaveProperty("phone");
      // non-PII is still there to act on
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("source");
    }
  });

  it("recruiter and admin rows carry name/email/phone", async () => {
    for (const role of ["recruiter", "admin"] as const) {
      const rows = await listCandidates({ workspaceId: "brightwave", role });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r).toHaveProperty("name");
        expect(r).toHaveProperty("email");
        expect(r).toHaveProperty("phone");
      }
    }
  });
});

describe("listCandidates — composable filters (still scoped)", () => {
  it("filters by source", async () => {
    const rows = await listCandidates(BW, { source: "referral" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "referral")).toBe(true);
    expect(rows.every((r) => String(r.id).startsWith("bw-"))).toBe(true);
  });

  it("respects limit", async () => {
    const rows = await listCandidates(BW, { limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it("filters by stage via applications, staying in-workspace", async () => {
    const rows = await listCandidates(BW, { stage: "hired" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => String(r.id).startsWith("bw-"))).toBe(true);
  });
});
