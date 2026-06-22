/**
 * Role + column-permission model for the analytics copilot.
 *
 * PII enforcement is implemented via `stripPII`, applied at the tool boundary
 * in `src/agent/tools.ts` — before results are serialized, never in the UI or
 * LLM prompt. `analyst` role never receives candidate name/email/phone.
 * `recruiter` and `admin` receive the full record.
 */

export const ROLES = ["admin", "recruiter", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Default role when none is supplied on the request. */
export const DEFAULT_ROLE: Role = "admin";

/** Columns considered PII, keyed by table. Reading these requires a non-analyst role. */
export const PII_COLUMNS = {
  candidates: ["name", "email", "phone"] as const,
};

type CandidatePIIKey = (typeof PII_COLUMNS.candidates)[number];

/**
 * Strip PII fields from candidate records for analyst-role callers.
 * Recruiters and admins receive the full record. Applied at the tool boundary,
 * before the result is serialized — never in the UI or LLM prompt.
 */
export function stripPII<T extends Record<string, unknown>>(
  records: T[],
  role: Role,
): Array<Omit<T, CandidatePIIKey>> {
  // Recruiter/admin: records are returned unmodified. The cast is intentional —
  // T is structurally assignable to Omit<T, CandidatePIIKey> (superset satisfies subset),
  // and these roles are authorised to read PII, so the full record is the correct return.
  if (role === "recruiter" || role === "admin") return records as Array<Omit<T, CandidatePIIKey>>;
  return records.map((r) => {
    const cleaned = { ...r };
    for (const field of PII_COLUMNS.candidates) {
      delete (cleaned as Record<string, unknown>)[field];
    }
    return cleaned as Omit<T, CandidatePIIKey>;
  });
}

/**
 * Whether `role` may read `table.column`.
 * Retained for potential column-level checks; enforcement is via stripPII.
 */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  if (table in PII_COLUMNS && PII_COLUMNS[table as keyof typeof PII_COLUMNS].includes(column as CandidatePIIKey)) {
    return role === "recruiter" || role === "admin";
  }
  return true;
}
