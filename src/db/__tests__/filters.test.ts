import { describe, expect, test } from "vitest";

import {
  analyticsFilterFields,
  analyticsFilterSchema,
  APPLICATION_SOURCES,
} from "../filters";

describe("analytics filters", () => {
  test("schema accepts the shared filter shape", () => {
    const parsed = analyticsFilterSchema.parse({
      jobId: "bw-job-1",
      source: "linkedin",
      dateFrom: "2025-01-01",
      dateTo: "2025-03-31",
      department: "Engineering",
    });
    expect(parsed.source).toBe("linkedin");
  });

  test("schema rejects unknown sources", () => {
    expect(() =>
      analyticsFilterSchema.parse({ source: "twitter" }),
    ).toThrow();
  });

  test("documents all acquisition sources", () => {
    expect(APPLICATION_SOURCES).toContain("referral");
    expect(Object.keys(analyticsFilterFields)).toEqual(
      expect.arrayContaining([
        "jobId",
        "source",
        "dateFrom",
        "dateTo",
        "department",
      ]),
    );
  });
});
