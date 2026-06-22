import { beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { optional } from "@/agent/schema";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { streamCopilot } from "@/agent/run";
import type { UIMessage } from "ai";

function userMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

test("optional(): null normalizes to undefined, schema stays narrow", () => {
  const schema = z.object({ jobId: optional(z.string()) });
  expect(schema.parse({ jobId: null }).jobId).toBeUndefined();
  expect(schema.parse({}).jobId).toBeUndefined();
  expect(schema.parse({ jobId: "abc" }).jobId).toBe("abc");
});

beforeAll(async () => {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
});

test("mock model drives real, multi-step tool calls through streamText", async () => {
  const result = await streamCopilot({
    workspaceId: "brightwave",
    role: "admin",
    messages: [userMessage("How does my pipeline look by stage?")],
  });

  const [text, steps] = await Promise.all([result.text, result.steps]);

  // The loop ends on a tool-free closing message, so `result.toolCalls`
  // (last-step-only) is empty. Count tool calls across all steps instead.
  const totalToolCalls = steps.reduce(
    (sum, step) => sum + step.toolCalls.length,
    0,
  );

  expect(totalToolCalls).toBeGreaterThan(0);
  expect(text.trim().length).toBeGreaterThan(0);
});
