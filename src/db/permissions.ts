/**
 * Role + column-permission model for the analytics copilot.
 *
 * The copilot serves users with different roles. Some columns are PII and must
 * not be readable by every role.
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

/** Roles allowed to read candidate PII (name/email/phone). */
export function canSeePII(role: Role): boolean {
  return role !== "analyst";
}

/** Whether `role` may read `table.column`. */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const isPII = PII_COLUMNS[table]?.includes(column) ?? false;
  return isPII ? canSeePII(role) : true;
}
