import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { applications, candidates } from "@/db/schema";
import { scopeWhere } from "@/db/analytics";

const ctx = { workspaceId: "brightwave", role: "admin" as const };

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
