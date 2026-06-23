import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_ID, tenantFromHeaders } from "./context";

/**
 * `tenantFromHeaders` is the single chokepoint that turns request headers into the
 * `{ workspaceId, role }` every scoped query runs under. Two things must hold:
 *  - sensible defaults when headers are absent, and
 *  - `isRole` rejecting a bogus role so a header can't inject a privileged one.
 *
 * To see this isn't vacuous: drop the `isRole` guard (trust the raw header) and the
 * "rejects an unknown role" case goes red.
 */

const req = (headers: Record<string, string>) =>
  new Request("http://localhost", { headers });

describe("tenantFromHeaders", () => {
  it("defaults to brightwave + admin when headers are absent", () => {
    expect(tenantFromHeaders(req({}))).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "admin",
    });
  });

  it("honors a valid workspace + role, trimming whitespace", () => {
    expect(
      tenantFromHeaders(req({ "x-workspace": " meridian ", "x-role": " analyst " })),
    ).toEqual({ workspaceId: "meridian", role: "analyst" });
  });

  it("rejects an unknown role and falls back to the default (no header-injected privilege)", () => {
    expect(tenantFromHeaders(req({ "x-role": "superuser" })).role).toBe("admin");
    expect(tenantFromHeaders(req({ "x-role": "" })).role).toBe("admin");
  });
});
