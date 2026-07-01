import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { applicationCountByStage } from "@/db/analytics";
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
