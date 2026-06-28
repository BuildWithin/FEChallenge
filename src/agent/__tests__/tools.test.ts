import { beforeAll, describe, expect, test } from "vitest";
import type { ToolCallOptions } from "ai";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { buildTools } from "@/agent/tools";
import type { CellValue, ToolResult } from "@/agent/artifact";
import type { Role } from "@/db/permissions";

/**
 * Uniform shape of a tool's `execute`. Each tool's input schema differs, so the
 * keyed-access type collapses the param to `never`; this precise function type
 * lets the helper call any of them with scalar args and get a typed ToolResult.
 */
type ToolExecute = (
  input: Record<string, CellValue>,
  opts: ToolCallOptions,
) => Promise<ToolResult>;

const PII_KEYS = ["name", "email", "phone"] as const;

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

/** Invoke a tool's execute with empty args, like the agent loop does. */
async function run(
  workspaceId: string,
  role: Role,
  name: keyof ReturnType<typeof buildTools>,
  input: Record<string, CellValue> = {},
) {
  const tools = buildTools({ workspaceId, role });
  const execute = tools[name].execute as ToolExecute | undefined;
  if (!execute) throw new Error(`tool ${name} has no execute`);
  // The AI SDK passes a typed call-options object; a minimal stub is enough here.
  const opts: ToolCallOptions = { toolCallId: "test", messages: [] };
  return execute(input, opts);
}

describe("tool catalog", () => {
  test("every tool returns rows + a valid display, drivable with empty args", async () => {
    const names = [
      "applicationCountByStage",
      "candidatesBySource",
      "listJobs",
      "applicationsOverTime",
      "timeToHire",
      "listCandidates",
    ] as const;

    for (const name of names) {
      const out = await run("brightwave", "admin", name);
      expect(Array.isArray(out.rows)).toBe(true);
      expect(["bar", "line", "table"]).toContain(out.display.kind);
    }
  });

  test("listCandidates leaks no PII to an analyst through the tool boundary", async () => {
    const out = await run("brightwave", "analyst", "listCandidates");
    expect(out.rows.length).toBeGreaterThan(0);
    for (const row of out.rows) {
      for (const key of PII_KEYS) expect(row).not.toHaveProperty(key);
    }
  });

  test("listCandidates returns PII for a recruiter", async () => {
    const out = await run("brightwave", "recruiter", "listCandidates", { limit: 3 });
    expect(out.rows.length).toBeGreaterThan(0);
    for (const key of PII_KEYS) expect(out.rows[0]).toHaveProperty(key);
  });

  test("tools stay scoped to the caller's workspace", async () => {
    const out = await run("meridian", "admin", "listJobs");
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows.every((r) => String(r.id ?? "").startsWith("mer-"))).toBe(true);
  });
});
