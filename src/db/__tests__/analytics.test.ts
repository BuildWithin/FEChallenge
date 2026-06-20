import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, ensureSchema } from "@/db/client";
import { applications, candidates, workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { scopeWhere, listCandidates, candidatePiiCols } from "@/db/analytics";
import { PII_COLUMNS } from "@/db/permissions";

const ctx = { workspaceId: "brightwave", role: "admin" as const };

beforeAll(async () => {
  await ensureSchema();
  if ((await db.select().from(workspaces)).length === 0) await seed();
});

describe("listCandidates PII projection", () => {
  const PII = ["name", "email", "phone"];

  it("analyst rows contain NO PII columns", async () => {
    const rows = await listCandidates({ workspaceId: "brightwave", role: "analyst" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of PII) expect(key in row).toBe(false);
    }
  });

  it("recruiter rows DO contain PII columns", async () => {
    const rows = await listCandidates({ workspaceId: "brightwave", role: "recruiter" });
    expect(rows.length).toBeGreaterThan(0);
    for (const key of PII) expect(key in rows[0]).toBe(true);
  });

  it("the PII projection can't drift from the policy", () => {
    expect(Object.keys(candidatePiiCols).sort()).toEqual([...PII_COLUMNS.candidates].sort());
  });
});

describe("scopeWhere", () => {
  it("scopes a single table", () => {
    const { sql, params } = db
      .select()
      .from(applications)
      .where(scopeWhere(ctx, applications))
      .toSQL();
    expect(sql).toContain('"applications"."workspace_id"');
    expect(params).toContain("brightwave");
  });

  it("scopes EVERY tenant table in a join (no side left unscoped)", () => {
    const { sql, params } = db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(scopeWhere(ctx, [applications, candidates]))
      .toSQL();
    expect(sql).toContain('"applications"."workspace_id"');
    expect(sql).toContain('"candidates"."workspace_id"');
    expect(params.filter((p) => p === "brightwave")).toHaveLength(2);
  });
});
