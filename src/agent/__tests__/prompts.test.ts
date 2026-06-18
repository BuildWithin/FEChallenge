import { describe, expect, test } from "vitest";

import { buildSystemPrompt } from "../prompts";

describe("buildSystemPrompt", () => {
  test("includes multi-step guidance for all roles", () => {
    const prompt = buildSystemPrompt("admin");
    expect(prompt).toContain("listJobs");
    expect(prompt).toContain("Multi-step");
    expect(prompt).toContain("Never reference or infer another workspace");
    expect(prompt).toContain("jobId, source, dateFrom, dateTo, department");
  });

  test("analyst prompt forbids PII", () => {
    const prompt = buildSystemPrompt("analyst");
    expect(prompt).toContain("NEVER available");
    expect(prompt).toContain("candidateId");
  });

  test("recruiter prompt allows PII when returned by tools", () => {
    const prompt = buildSystemPrompt("recruiter");
    expect(prompt).toContain("may discuss candidate name");
  });
});
