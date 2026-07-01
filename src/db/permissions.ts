/**
 * Role + column-permission model for the analytics copilot.
 *
 * The copilot serves users with different roles. Some columns are PII and must
 * not be readable by every role.
 *
 * Enforcement strategy: PII is gated by ROLE at the QUERY LAYER, by construction.
 * Instead of fetching PII and stripping it afterwards, the query builds its
 * candidate column set from the caller's role via `candidateColumns(role)`, so
 * PII columns are never even SELECTed for an `analyst` — a leak is
 * unrepresentable, not merely rejected. `canReadColumn` / `assertCanReadPII`
 * back this with a runtime guard for any read that builds a column set by hand.
 */

import { candidates } from "./schema";

export const ROLES = ["admin", "recruiter", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Default role when none is supplied on the request. */
export const DEFAULT_ROLE: Role = "admin";

/** Columns considered PII, keyed by table. Reading these requires a non-analyst role. */
export const PII_COLUMNS: Record<string, readonly string[]> = {
  candidates: ["name", "email", "phone"],
};

/**
 * Whether `role` may read `table.column`. Only `analyst` is restricted, and only
 * for columns declared PII in `PII_COLUMNS` — so adding a new PII column/table
 * there extends enforcement with no change here.
 */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const pii = PII_COLUMNS[table];
  if (pii?.includes(column) && role === "analyst") return false;
  return true;
}

/** Throw if `role` is asked to read PII columns it may not see. Defense in depth. */
export function assertCanReadPII(role: Role, table: string, columns: string[]): void {
  const denied = columns.filter((c) => !canReadColumn(role, table, c));
  if (denied.length > 0) {
    throw new Error(
      `Role "${role}" may not read PII columns on ${table}: ${denied.join(", ")}`,
    );
  }
}

/** Non-PII candidate columns every role may read. */
const CANDIDATE_PUBLIC_COLUMNS = {
  id: candidates.id,
  workspaceId: candidates.workspaceId,
  source: candidates.source,
  createdAt: candidates.createdAt,
} as const;

/** PII candidate columns — only readable by recruiter/admin. */
const CANDIDATE_PII_COLUMNS = {
  name: candidates.name,
  email: candidates.email,
  phone: candidates.phone,
} as const;

/**
 * The candidate column set a role may select. `analyst` gets public columns only;
 * `recruiter`/`admin` also get PII. Feed the return value straight into
 * `db.select(candidateColumns(role))` so PII is never selected for an analyst.
 *
 * Callers should treat PII fields as optional (`row.name?`) — by design they may
 * be absent depending on role.
 */
export function candidateColumns(role: Role) {
  return role === "analyst"
    ? CANDIDATE_PUBLIC_COLUMNS
    : { ...CANDIDATE_PUBLIC_COLUMNS, ...CANDIDATE_PII_COLUMNS };
}
