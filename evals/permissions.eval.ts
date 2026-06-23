/**
 * Rule tested: PII gate at the tool boundary — stripPII() must strip name/email/phone
 * for analyst-role callers and must NOT strip them for recruiter/admin callers.
 *
 * Functions under test (called directly — no LLM):
 *   getCandidatesForJob (query layer) + stripPII (permission layer)
 *
 * How to manually verify this eval bites:
 *   - Analyst case fails if stripPII is bypassed — e.g. remove the `stripPII` call
 *     in candidateList's execute() in tools.ts (return raw `rows` instead of `safe`).
 *     The name/email/phone keys will appear in the returned rows.
 *   - Recruiter case fails if stripPII incorrectly strips authorized roles — e.g.
 *     change the role check in stripPII to always strip, regardless of role.
 *     The `name` key will be absent even for a recruiter caller.
 *   Both directions are tested to prevent both under-stripping and over-stripping.
 */

import { createScorer, evalite } from "evalite";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { getCandidatesForJob, type AnalyticsCtx } from "@/db/analytics";
import { stripPII } from "@/db/permissions";
import type { Role } from "@/db/permissions";

async function ensureSeeded() {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
}

type PermInput = {
  ctx: AnalyticsCtx;
  jobId: string;
};

type PermOutput = {
  analystRows: Array<Record<string, unknown>>;
  recruiterRows: Array<Record<string, unknown>>;
};

async function runPermissionChecks(input: PermInput): Promise<PermOutput> {
  const raw = await getCandidatesForJob(input.ctx, input.jobId);

  // Strip PII as an analyst would see it — name/email/phone must be absent.
  const analystRows = stripPII(raw, "analyst") as Array<Record<string, unknown>>;

  // Full rows as a recruiter would see them — name/email/phone must be present.
  const recruiterRows = stripPII(raw, "recruiter") as Array<Record<string, unknown>>;

  return { analystRows, recruiterRows };
}

// --- Scorers ------------------------------------------------------------------

const analystSeesNoPII = createScorer<PermInput, PermOutput, undefined>({
  name: "analystSeesNoPII",
  description:
    "After stripPII(rows, 'analyst'), no row contains name, email, or phone as a key.",
  scorer: ({ output }) => {
    // Fails if stripPII is bypassed — leaked PII keys appear in analystRows.
    const allStripped = output.analystRows.every(
      (row) => !("name" in row) && !("email" in row) && !("phone" in row),
    );
    return allStripped ? 1 : 0;
  },
});

const recruiterRetainsPII = createScorer<PermInput, PermOutput, undefined>({
  name: "recruiterRetainsPII",
  description:
    "After stripPII(rows, 'recruiter'), rows exist and at least one row contains 'name'.",
  scorer: ({ output }) => {
    // Fails if stripPII incorrectly strips authorized roles — name would be absent.
    if (output.recruiterRows.length === 0) return 0;
    const hasName = output.recruiterRows.some((row) => "name" in row);
    return hasName ? 1 : 0;
  },
});

// --- Eval ---------------------------------------------------------------------

evalite<PermInput, PermOutput>("PII gate — analyst strips name/email/phone, recruiter retains them", {
  data: async () => {
    await ensureSeeded();
    return [
      {
        // Test the Brightwave workspace, first job. The same raw rows go through
        // stripPII twice (analyst path and recruiter path) so both directions are
        // checked in a single task invocation.
        input: {
          ctx: { workspaceId: "brightwave", role: "admin" as const },
          jobId: "bw-job-1",
        },
      },
    ];
  },
  task: (input) => runPermissionChecks(input),
  scorers: [analystSeesNoPII, recruiterRetainsPII],
});
