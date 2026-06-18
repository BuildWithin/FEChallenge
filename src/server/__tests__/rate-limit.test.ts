import { describe, expect, test } from "vitest";

import { checkRateLimit } from "../rate-limit";

describe("checkRateLimit", () => {
  test("allows requests under the cap", () => {
    expect(checkRateLimit("test-workspace:admin").allowed).toBe(true);
  });
});
