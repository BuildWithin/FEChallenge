import { beforeAll, describe, expect, test } from "vitest";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  listCandidates,
  listJobs,
  timeToHire,
} from "@/db/analytics";
import { canReadColumn, canReadPII, type Role } from "@/db/permissions";

const BW = "brightwave";
const MER = "meridian";
const ctx = (workspaceId: string, role: Role) => ({ workspaceId, role });
const PII_KEYS = ["name", "email", "phone"] as const;

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("permissions policy", () => {
  test("only non-analyst roles may read PII", () => {
    expect(canReadPII("admin")).toBe(true);
    expect(canReadPII("recruiter")).toBe(true);
    expect(canReadPII("analyst")).toBe(false);
  });

  test("canReadColumn gates PII columns but allows non-PII", () => {
    expect(canReadColumn("analyst", "candidates", "name")).toBe(false);
    expect(canReadColumn("analyst", "candidates", "source")).toBe(true);
    expect(canReadColumn("recruiter", "candidates", "email")).toBe(true);
    expect(canReadColumn("analyst", "jobs", "title")).toBe(true);
  });
});

describe("tenant isolation", () => {
  test("candidate reads return only the caller's workspace rows", async () => {
    const bw = await listCandidates(ctx(BW, "admin"), { limit: 200 });
    const mer = await listCandidates(ctx(MER, "admin"), { limit: 200 });

    expect(bw.length).toBeGreaterThan(0);
    expect(mer.length).toBeGreaterThan(0);
    expect(bw.every((c) => c.id.startsWith("bw-"))).toBe(true);
    expect(mer.every((c) => c.id.startsWith("mer-"))).toBe(true);

    const bwIds = new Set(bw.map((c) => c.id));
    expect(mer.some((c) => bwIds.has(c.id))).toBe(false);
  });

  test("job reads are scoped to the caller's workspace", async () => {
    const bw = await listJobs(ctx(BW, "admin"));
    const mer = await listJobs(ctx(MER, "admin"));
    expect(bw.every((j) => j.id.startsWith("bw-"))).toBe(true);
    expect(mer.every((j) => j.id.startsWith("mer-"))).toBe(true);
  });

  test("aggregate counts are computed per workspace, not globally", async () => {
    const bwBySource = await candidatesBySource(ctx(BW, "admin"));
    const bwTotal = bwBySource.reduce((n, r) => n + Number(r.count), 0);
    const bwCandidates = await listCandidates(ctx(BW, "admin"), { limit: 200 });
    // The grouped total must equal the row-level count for the SAME workspace.
    expect(bwTotal).toBe(bwCandidates.length);
  });
});

describe("PII gating by role", () => {
  test.each(["admin", "recruiter"] as const)(
    "%s receives candidate PII",
    async (role) => {
      const rows = await listCandidates(ctx(BW, role), { limit: 5 });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        for (const key of PII_KEYS) expect(row).toHaveProperty(key);
      }
    },
  );

  test("analyst never receives candidate PII (columns are absent, not blanked)", async () => {
    const rows = await listCandidates(ctx(BW, "analyst"), { limit: 200 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of PII_KEYS) expect(row).not.toHaveProperty(key);
    }
  });
});

describe("query shapes & filters stay scoped", () => {
  test("status filter on jobs stays within the workspace", async () => {
    const open = await listJobs(ctx(BW, "admin"), { status: "open" });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((j) => j.status === "open" && j.id.startsWith("bw-"))).toBe(
      true,
    );
  });

  test("source filter on candidates stays within the workspace", async () => {
    const referrals = await listCandidates(ctx(BW, "admin"), {
      source: "referral",
    });
    expect(
      referrals.every((c) => c.source === "referral" && c.id.startsWith("bw-")),
    ).toBe(true);
  });

  test("applicationCountByStage returns known stages with positive counts", async () => {
    const known = ["applied", "screen", "interview", "offer", "hired", "rejected"];
    const rows = await applicationCountByStage(ctx(BW, "admin"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => known.includes(r.stage) && Number(r.count) > 0)).toBe(
      true,
    );
  });

  test("applicationsOverTime returns time buckets in ascending order", async () => {
    const rows = await applicationsOverTime(ctx(BW, "admin"), { bucket: "week" });
    expect(rows.length).toBeGreaterThan(0);
    const periods = rows.map((r) => r.period);
    expect([...periods].sort()).toEqual(periods);
  });

  test("timeToHire returns a single aggregate row", async () => {
    const rows = await timeToHire(ctx(BW, "admin"));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].hires)).toBeGreaterThanOrEqual(0);
  });
});
