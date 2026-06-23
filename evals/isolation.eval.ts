/**
 * Rule tested: Tenant isolation — every analytics query must only return rows
 * belonging to the queried workspace. No cross-tenant data leakage.
 *
 * Functions under test (called directly — no LLM):
 *   getJobList, getApplicationsByJob, getCandidatesForJob, getCandidateSourceBreakdown
 *
 * How to manually verify this eval bites:
 *   1. In src/db/analytics.ts, remove the .where(scopeWhere(...)) call from
 *      getJobList (drop the where clause entirely). Rerun — Case A will fail:
 *      rows with prefix "mer-" will appear in the brightwave result.
 *   2. Same for getApplicationsByJob: remove .where(scopeWhere(applications, ctx, extra)).
 *      Rows with jobId prefixed "mer-job-" will appear in the brightwave case.
 *   3. For getCandidatesForJob: remove the scopeWhere from the .where() call.
 *      Rows with id prefixed "mer-cand-" will appear.
 *   4. For getCandidateSourceBreakdown: remove scopeWhere. The total count will
 *      exceed 18 (brightwave) or 14 (meridian) — the inflated number catches it.
 */

import { createScorer, evalite } from "evalite";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import {
  getApplicationsByJob,
  getCandidateSourceBreakdown,
  getCandidatesForJob,
  getJobList,
  type AnalyticsCtx,
} from "@/db/analytics";

async function ensureSeeded() {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
}

type IsolationInput = {
  ctx: AnalyticsCtx;
  prefix: string;
  otherPrefix: string;
  // Total application count (not candidate count) — getCandidateSourceBreakdown
  // groups applications by candidate source. Brightwave: 18 base + 6 extra (every
  // 3rd candidate gets a 2nd application) = 24. Meridian: 14 + 5 = 19.
  expectedApplicationCount: number;
};

type IsolationOutput = {
  passed: boolean;
  violations: string[];
};

async function runIsolationChecks(input: IsolationInput): Promise<IsolationOutput> {
  const { ctx, prefix, otherPrefix, expectedApplicationCount } = input;
  const violations: string[] = [];

  // Check 1: getJobList — every returned job ID must belong to this workspace.
  // Fails if scopeWhere is removed from getJobList — leaked rows from the other
  // workspace would carry a different prefix (e.g. "mer-job-1" in brightwave result).
  const jobs = await getJobList(ctx);
  for (const row of jobs) {
    if (!row.id.startsWith(`${prefix}-`)) {
      violations.push(
        `getJobList: row.id "${row.id}" does not start with "${prefix}-" ` +
          `(cross-tenant leak; other workspace uses prefix "${otherPrefix}")`,
      );
    }
  }

  // Check 2: getApplicationsByJob — every jobId must belong to this workspace.
  // Fails if scopeWhere is removed — leaked rows carry the other-workspace job prefix.
  const appsByJob = await getApplicationsByJob(ctx);
  for (const row of appsByJob) {
    if (!row.jobId.startsWith(`${prefix}-`)) {
      violations.push(
        `getApplicationsByJob: row.jobId "${row.jobId}" does not start with "${prefix}-" ` +
          `(cross-tenant leak; other workspace uses prefix "${otherPrefix}")`,
      );
    }
  }

  // Check 3: getCandidatesForJob — every candidate ID must belong to this workspace.
  // Uses the first seeded job for this workspace (deterministic: "${prefix}-job-1").
  // Fails if scopeWhere is removed — leaked candidates carry the other-workspace prefix.
  const firstJobId = `${prefix}-job-1`;
  const candidates = await getCandidatesForJob(ctx, firstJobId);
  for (const row of candidates) {
    if (!row.id.startsWith(`${prefix}-`)) {
      violations.push(
        `getCandidatesForJob(${firstJobId}): row.id "${row.id}" does not start with "${prefix}-" ` +
          `(cross-tenant leak; other workspace uses prefix "${otherPrefix}")`,
      );
    }
  }

  // Check 4: getCandidateSourceBreakdown — aggregate total must equal the exact
  // seeded application count (ground truth from seed.ts). Note: this function
  // counts applications joined to candidates, not unique candidates. Each workspace
  // has extra applications (every 3rd candidate applies to 2 jobs).
  // Fails if scopeWhere is removed — leaked rows from the other workspace inflate
  // the total (brightwave+meridian combined = 43, vs expected 24 or 19).
  const sourceRows = await getCandidateSourceBreakdown(ctx);
  const totalApplications = sourceRows.reduce((sum, r) => sum + r.count, 0);
  if (totalApplications !== expectedApplicationCount) {
    violations.push(
      `getCandidateSourceBreakdown: total count is ${totalApplications}, ` +
        `expected exactly ${expectedApplicationCount} ` +
        `(cross-tenant leak inflates the count beyond the seeded workspace total)`,
    );
  }

  return { passed: violations.length === 0, violations };
}

// --- Scorer -------------------------------------------------------------------

const allRowsScoped = createScorer<IsolationInput, IsolationOutput, undefined>({
  name: "allRowsScoped",
  description: "Every returned row belongs to the queried workspace.",
  scorer: ({ output }) => (output.passed ? 1 : 0),
});

// --- Eval ---------------------------------------------------------------------

evalite<IsolationInput, IsolationOutput>(
  "Tenant isolation — direct analytics function calls",
  {
    data: async () => {
      await ensureSeeded();
      return [
        {
          // Case A: Brightwave. All row IDs must carry "bw-" prefix.
          // Application count: 18 base + 6 extra (every 3rd of 18 candidates) = 24.
          input: {
            ctx: { workspaceId: "brightwave", role: "admin" as const },
            prefix: "bw",
            otherPrefix: "mer-",
            expectedApplicationCount: 24,
          },
        },
        {
          // Case B: Meridian. All row IDs must carry "mer-" prefix.
          // Application count: 14 base + 5 extra (every 3rd of 14 candidates) = 19.
          input: {
            ctx: { workspaceId: "meridian", role: "admin" as const },
            prefix: "mer",
            otherPrefix: "bw-",
            expectedApplicationCount: 19,
          },
        },
      ];
    },
    task: (input) => runIsolationChecks(input),
    scorers: [allRowsScoped],
  },
);
