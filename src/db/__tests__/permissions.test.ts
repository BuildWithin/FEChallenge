import { describe, expect, test } from "vitest";

import {
  canReadColumn,
  canReadPii,
  isPiiField,
  isPiiRestrictedRole,
  redactDisplayColumns,
  redactRowForRole,
  redactRowsForRole,
} from "../permissions";

describe("permissions", () => {
  test("analyst cannot read candidate PII columns", () => {
    expect(canReadColumn("analyst", "candidates", "name")).toBe(false);
    expect(canReadColumn("analyst", "candidates", "email")).toBe(false);
    expect(canReadColumn("analyst", "candidates", "phone")).toBe(false);
    expect(canReadPii("analyst")).toBe(false);
    expect(isPiiRestrictedRole("analyst")).toBe(true);
  });

  test("recruiter and admin can read candidate PII columns", () => {
    for (const role of ["admin", "recruiter"] as const) {
      expect(canReadColumn(role, "candidates", "name")).toBe(true);
      expect(canReadColumn(role, "candidates", "email")).toBe(true);
      expect(canReadColumn(role, "candidates", "phone")).toBe(true);
      expect(canReadPii(role)).toBe(true);
      expect(isPiiRestrictedRole(role)).toBe(false);
    }
  });

  test("non-PII columns are readable by all roles", () => {
    expect(canReadColumn("analyst", "candidates", "source")).toBe(true);
    expect(canReadColumn("analyst", "applications", "stage")).toBe(true);
  });

  test("redactRowForRole strips name, email, phone for analysts", () => {
    const row = {
      candidateId: "bw-cand-1",
      name: "Robin Vega",
      email: "robin@example.com",
      phone: "+1-555-1000",
      source: "linkedin",
      stage: "interview",
    };
    const redacted = redactRowForRole("analyst", row);
    expect(redacted).toEqual({
      candidateId: "bw-cand-1",
      source: "linkedin",
      stage: "interview",
    });
    expect(redacted).not.toHaveProperty("name");
    expect(redacted).not.toHaveProperty("email");
    expect(redacted).not.toHaveProperty("phone");
  });

  test("redactRowsForRole leaves admin rows unchanged", () => {
    const rows = [{ name: "Robin Vega", email: "robin@example.com" }];
    expect(redactRowsForRole("admin", rows)).toEqual(rows);
  });

  test("redactDisplayColumns removes PII column names for analysts", () => {
    const cols = redactDisplayColumns("analyst", [
      "candidateId",
      "name",
      "email",
      "phone",
      "source",
    ]);
    expect(cols).toEqual(["candidateId", "source"]);
  });

  test("isPiiField identifies known PII keys", () => {
    expect(isPiiField("name")).toBe(true);
    expect(isPiiField("email")).toBe(true);
    expect(isPiiField("source")).toBe(false);
  });
});
