import { describe, expect, test } from "vitest";

import { deriveInsights } from "../insights";

describe("deriveInsights", () => {
  test("flags steepest funnel drop-off", () => {
    const lines = deriveInsights("stageConversionRates", [
      { stage: "applied", count: 10, conversionFromPrevious: null },
      { stage: "screen", count: 8, conversionFromPrevious: 80 },
      { stage: "interview", count: 2, conversionFromPrevious: 25 },
    ]);
    expect(lines[0]).toMatch(/screen→interview conversion is 25%/);
  });

  test("summarizes time-to-hire", () => {
    const lines = deriveInsights("timeToHire", [
      { avgDays: 12.4, hiredCount: 5 },
    ]);
    expect(lines[0]).toContain("12.4 days");
    expect(lines[0]).toContain("5 hires");
  });

  test("handles empty rows with guidance", () => {
    const lines = deriveInsights("pipelineVelocity", []);
    expect(lines[0]).toMatch(/No rows matched/);
  });
});
