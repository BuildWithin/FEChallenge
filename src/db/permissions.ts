/**
 * Role + column-permission model for the analytics copilot.
 *
 * The copilot serves users with different roles. Some columns are PII and must
 * not be readable by every role.
 *
 * TODO(candidate): PII permissions are DEFINED here but NOT yet ENFORCED.
 * An `analyst` should never be able to read PII columns (candidate
 * name/email/phone); `recruiter` and `admin` may. Wire enforcement into the
 * query layer (src/db/analytics.ts) so it cannot be skipped — ideally make a
 * PII-leaking query for the wrong role *unrepresentable*, not merely rejected
 * after the fact. Then prove it with an eval.
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
 * Whether `role` may read `table.column`.
 *
 * `false` iff `column` is PII for `table` AND `role === "analyst"`; `true`
 * otherwise. This is the single source of truth for column-level access — the
 * query layer (`candidateSelection` in src/db/analytics.ts) routes every
 * candidate-column projection through it, so a PII column is *never SELECTed*
 * for an analyst rather than stripped after the fact.
 */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const isPii = PII_COLUMNS[table]?.includes(column) ?? false;
  return !(isPii && role === "analyst");
}
