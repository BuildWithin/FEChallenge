import { describe, expect, test } from "vitest";

import { buildSystemPrompt } from "@/agent/provider";

describe("buildSystemPrompt", () => {
  test("includes workspace and admin PII permission", () => {
    const prompt = buildSystemPrompt({ workspaceId: "brightwave", role: "admin" });
    expect(prompt).toContain('workspace "brightwave"');
    expect(prompt).toContain("role is admin");
    expect(prompt).toContain("do not repeat rows in prose");
  });

  test("analyst prompt forbids sharing contact details", () => {
    const prompt = buildSystemPrompt({ workspaceId: "meridian", role: "analyst" });
    expect(prompt).toContain("role is analyst");
    expect(prompt).toContain("will NOT include candidate name, email, or phone");
    expect(prompt).toContain("permission notice");
    expect(prompt).toContain("chart is the full answer");
  });

  test("instructs model to answer in plain prose, not markdown tables", () => {
    const prompt = buildSystemPrompt({ workspaceId: "brightwave", role: "recruiter" });
    expect(prompt).toContain("conversational text");
    expect(prompt).toContain("Do not use markdown tables");
    expect(prompt).toContain("charts or tables");
    expect(prompt).toContain("KNOWN LIMITATIONS");
    expect(prompt).toContain("No date-range filters");
  });

  test("lists tool catalog and honest limits for unsupported questions", () => {
    const prompt = buildSystemPrompt({ workspaceId: "brightwave", role: "admin" });
    expect(prompt).toContain("TOOL CATALOG");
    expect(prompt).toContain("applicationsOverTime");
    expect(prompt).toContain("do NOT call a partial tool");
  });
});
