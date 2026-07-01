import { beforeAll, describe, expect, test } from "vitest";

import type { ToolResult } from "@/agent/artifact";
import { buildTools } from "@/agent/tools";
import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";

const ctx = { workspaceId: "brightwave", role: "admin" as const };

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

async function runToolExecute(
  execute: NonNullable<
    ReturnType<typeof buildTools>[keyof ReturnType<typeof buildTools>]["execute"]
  >,
): Promise<ToolResult> {
  const out = await execute({}, { toolCallId: "test", messages: [] });
  return out as ToolResult;
}

describe("buildTools", () => {
  test("every tool executes with empty args and returns rows + display", async () => {
    const tools = buildTools(ctx);

    for (const [name, t] of Object.entries(tools)) {
      expect(t.execute, `${name} missing execute`).toBeDefined();
      const out = await runToolExecute(t.execute!);

      expect(out.rows.length, `${name} returned no rows`).toBeGreaterThan(0);
      expect(out.display).toBeDefined();
      expect(["table", "bar", "line"]).toContain(out.display.kind);
    }
  });

  test("listCandidates tool omits PII columns for analyst", async () => {
    const tools = buildTools({ workspaceId: "brightwave", role: "analyst" });
    expect(tools.listCandidates.execute).toBeDefined();

    const out = await runToolExecute(tools.listCandidates.execute!);

    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.display.kind).toBe("table");
    if (out.display.kind === "table") {
      expect(out.display.columns).toEqual([]);
    }
    expect(out.rows[0]).not.toHaveProperty("name");
  });

  test("listCandidates table columns are name, email, phone for admin", async () => {
    const tools = buildTools({ workspaceId: "brightwave", role: "admin" });
    const out = await runToolExecute(tools.listCandidates.execute!);
    if (out.display.kind === "table") {
      expect(out.display.columns).toEqual(["name", "email", "phone"]);
    }
    expect(out.rows[0]).toHaveProperty("name");
  });
});
