import { describe, expect, test } from "vitest";

import {
  assertCanReadPII,
  candidateColumns,
  canReadColumn,
} from "@/db/permissions";

describe("canReadColumn", () => {
  test("analyst cannot read candidate PII columns", () => {
    for (const column of ["name", "email", "phone"]) {
      expect(canReadColumn("analyst", "candidates", column)).toBe(false);
    }
  });

  test("analyst can read non-PII candidate columns", () => {
    for (const column of ["id", "workspaceId", "source", "createdAt"]) {
      expect(canReadColumn("analyst", "candidates", column)).toBe(true);
    }
  });

  test("recruiter and admin can read candidate PII", () => {
    for (const role of ["recruiter", "admin"] as const) {
      for (const column of ["name", "email", "phone"]) {
        expect(canReadColumn(role, "candidates", column)).toBe(true);
      }
    }
  });
});

describe("assertCanReadPII", () => {
  test("throws when analyst requests PII columns", () => {
    expect(() =>
      assertCanReadPII("analyst", "candidates", ["name", "email"]),
    ).toThrow(/may not read PII columns/);
  });

  test("passes when analyst requests only public columns", () => {
    expect(() =>
      assertCanReadPII("analyst", "candidates", ["id", "source"]),
    ).not.toThrow();
  });

  test("passes when admin requests PII columns", () => {
    expect(() =>
      assertCanReadPII("admin", "candidates", ["name", "email", "phone"]),
    ).not.toThrow();
  });
});

describe("candidateColumns", () => {
  test("analyst select map omits PII keys", () => {
    const cols = candidateColumns("analyst");
    expect(Object.keys(cols).sort()).toEqual(
      ["createdAt", "id", "source", "workspaceId"].sort(),
    );
  });

  test("admin select map includes PII keys", () => {
    const cols = candidateColumns("admin");
    expect(Object.keys(cols).sort()).toEqual(
      ["createdAt", "email", "id", "name", "phone", "source", "workspaceId"].sort(),
    );
  });

  test("recruiter select map matches admin", () => {
    expect(Object.keys(candidateColumns("recruiter")).sort()).toEqual(
      Object.keys(candidateColumns("admin")).sort(),
    );
  });
});
