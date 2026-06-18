import { afterEach, describe, expect, test, vi } from "vitest";

describe("getModel provider config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("throws when anthropic is selected without an API key", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { getModel } = await import("../provider");
    expect(() => getModel()).toThrow(/ANTHROPIC_API_KEY/);
  });

  test("returns mock model when AI_PROVIDER=mock", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { getModel, isMockProvider } = await import("../provider");
    const model = getModel();
    expect(isMockProvider()).toBe(true);
    expect(model).toHaveProperty("modelId", "ats-copilot-mock");
  });
});
