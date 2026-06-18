import { describe, expect, test } from "vitest";

import { rowsToCsv } from "../export-csv";

describe("rowsToCsv", () => {
  test("builds header and rows", () => {
    const csv = rowsToCsv(
      ["stage", "count"],
      [
        { stage: "applied", count: 4 },
        { stage: "hired", count: 2 },
      ],
    );
    expect(csv).toBe("stage,count\napplied,4\nhired,2");
  });

  test("escapes commas and quotes", () => {
    const csv = rowsToCsv(["name"], [{ name: 'Ada "Admin", HR' }]);
    expect(csv).toBe('name\n"Ada ""Admin"", HR"');
  });
});
