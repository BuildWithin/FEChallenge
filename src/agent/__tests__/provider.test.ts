import { describe, expect, test } from "vitest";

import { buildSystemPrompt } from "@/agent/provider";

describe("buildSystemPrompt", () => {
  test("includes workspace and admin PII permission", () => {
    const prompt = buildSystemPrompt({ workspaceId: "brightwave", role: "admin" });
    expect(prompt).toContain('workspace "brightwave"');
    expect(prompt).toContain("role is admin");
    expect(prompt).toContain("include them in your answer");
  });

  test("analyst prompt forbids sharing contact details", () => {
    const prompt = buildSystemPrompt({ workspaceId: "meridian", role: "analyst" });
    expect(prompt).toContain("role is analyst");
    expect(prompt).toContain("will NOT include candidate name, email, or phone");
  });

  test("instructs model to answer in plain prose, not markdown tables", () => {
    const prompt = buildSystemPrompt({ workspaceId: "brightwave", role: "recruiter" });
    expect(prompt).toContain("conversational text");
    expect(prompt).toContain("Do not use markdown tables");
    expect(prompt).toContain("The chat UI does not show raw");
  });
});
