/**
 * Role + column-permission model for the analytics copilot.
 *
 * The copilot serves users with different roles. Some columns are PII and must
 * not be readable by every role.
 *
 * Enforcement does NOT live here — it lives in the query layer
 * (`src/db/analytics.ts`), which routes every candidate read through a single
 * role-aware column selector. PII columns are added to the projection only when
 * the role permits, so for an `analyst` the executed SQL never references them.
 * This module supplies the policy those chokepoints consult.
 */

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
 * Whether `role` may read candidate PII (name / email / phone).
 *
 * The single source of truth for the PII rule. `admin` and `recruiter` may;
 * `analyst` may not. The query layer consults this when building candidate
 * projections — see `candidateColumns` in `src/db/analytics.ts`.
 */
export function canReadPII(role: Role): boolean {
  return role === "admin" || role === "recruiter";
}

/** Whether `role` may read `table.column`. PII columns defer to `canReadPII`. */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const pii = PII_COLUMNS[table];
  if (pii?.includes(column)) return canReadPII(role);
  return true;
}
