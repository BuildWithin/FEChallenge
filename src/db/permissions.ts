/**
 * Role + column-permission model for the analytics copilot.
 *
 * PII columns are defined here and enforced in the query layer
 * (src/db/analytics.ts) and tool results (src/agent/tools.ts). Analysts
 * never receive candidate name, email, or phone — recruiter/admin may.
 */

export const ROLES = ["admin", "recruiter", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Default role when none is supplied on the request. */
export const DEFAULT_ROLE: Role = "admin";

/** Columns considered PII, keyed by table. */
export const PII_COLUMNS: Record<string, readonly string[]> = {
  candidates: ["name", "email", "phone"],
};

/** Flat set of PII field names for row-level redaction. */
export const PII_FIELD_KEYS = new Set(
  Object.values(PII_COLUMNS).flatMap((cols) => cols),
);

/** Whether this role has candidate PII hidden by policy. */
export function isPiiRestrictedRole(role: Role): boolean {
  return role === "analyst";
}

/** Whether `role` may read `table.column`. */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const restricted = PII_COLUMNS[table];
  if (restricted?.includes(column)) {
    return !isPiiRestrictedRole(role);
  }
  return true;
}

/** Whether `role` may read any candidate PII field. */
export function canReadPii(role: Role): boolean {
  return !isPiiRestrictedRole(role);
}

/** Whether a result field name is a known PII key. */
export function isPiiField(field: string): boolean {
  return PII_FIELD_KEYS.has(field);
}

/** Drop PII keys from rows when the role may not read them. */
export function redactRowsForRole(
  role: Role,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (canReadPii(role)) return rows;
  return rows.map((row) => redactRowForRole(role, row));
}

/** Drop PII keys from a single row when the role may not read them. */
export function redactRowForRole(
  role: Role,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (canReadPii(role)) return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !isPiiField(key)),
  );
}

/** Filter table display columns to those visible for the role. */
export function redactDisplayColumns(
  role: Role,
  columns: string[],
): string[] {
  if (canReadPii(role)) return columns;
  return columns.filter((col) => !isPiiField(col));
}
