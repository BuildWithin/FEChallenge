import { beforeAll, describe, expect, test } from "vitest";

import { buildTools } from "@/agent/tools";
import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

describe("tool PII redaction", () => {
  test("candidatesInStage tool strips PII from results for analysts", async () => {
    const tools = buildTools({ workspaceId: "brightwave", role: "analyst" });
    const out = await tools.candidatesInStage.execute!(
      { stage: "interview" },
      { toolCallId: "test", messages: [] },
    );
    const rows = (out as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("name");
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("phone");
    }
    const display = (out as { display: { kind: string; columns?: string[] } })
      .display;
    if (display.kind === "table" && display.columns) {
      expect(display.columns).not.toContain("name");
      expect(display.columns).not.toContain("email");
      expect(display.columns).not.toContain("phone");
    }
  });

  test("candidatesInStage tool preserves PII for admin", async () => {
    const tools = buildTools({ workspaceId: "brightwave", role: "admin" });
    const out = await tools.candidatesInStage.execute!(
      { stage: "interview" },
      { toolCallId: "test", messages: [] },
    );
    const rows = (out as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("name");
  });
});
