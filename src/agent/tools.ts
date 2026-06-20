import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  candidateSelection,
  candidatesBySource,
  jobsOverview,
  listCandidates,
  type AnalyticsCtx,
} from "@/db/analytics";
import type { Display, ToolResult } from "./artifact";

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * Each tool is a THIN, declarative wrapper over one scoped query fn in
 * `@/db/analytics`. Boundary rule: this file imports from `@/db/analytics`
 * only — never `@/db/client` (`db`), never raw SQL — so no tool can express an
 * unscoped or PII-leaking query. Tenant scope and PII gating live one layer
 * down (`scopeWhere` + `candidateSelection`), enforced by construction.
 *
 * The agent picks tools and passes high-level params — it never writes SQL.
 * Inputs are OPTIONAL (the mock model calls with `{}`) and use `z.enum` so the
 * valid values are both documented for the model and validated. Each tool
 * returns `{ rows, display }` (see src/agent/artifact.ts), or `{ error }` if the
 * query throws — the model reads that and tells the user the data couldn't be
 * retrieved (per the system prompt's failure rule + run.ts `onError`).
 */

// Enum domains, named once so the inputSchema and the model-facing description
// stay in sync (they mirror the column comments in src/db/schema.ts).
const STAGES = [
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;
const SOURCES = [
  "referral",
  "linkedin",
  "job_board",
  "agency",
  "careers_site",
] as const;
const JOB_STATUSES = ["open", "closed", "draft"] as const;

// Preferred display order for the candidate roster; filtered down to whatever
// columns the role is actually allowed to project (PII drops out for analysts).
const CANDIDATE_COLUMN_ORDER = [
  "name",
  "email",
  "phone",
  "source",
  "createdAt",
  "id",
] as const;

export function buildTools(ctx: AnalyticsCtx) {
  const result = (rows: ToolResult["rows"], display: Display): ToolResult => ({
    rows,
    display,
  });

  /**
   * Run a query and shape its result, converting a thrown error into a
   * structured `{ error }` the model can read instead of crashing the turn.
   */
  const safe = async (
    name: string,
    run: () => Promise<ToolResult>,
  ): Promise<ToolResult | { error: string }> => {
    try {
      return await run();
    } catch (err) {
      console.error(`[tool:${name}] query failed:`, err);
      return {
        error:
          "The data for this request couldn't be retrieved from this workspace.",
      };
    }
  };

  // Columns to render for the candidate roster — role-aware, derived from the
  // single selection chokepoint so the table never advertises a PII column the
  // role can't actually read.
  const candidateColumns = (): string[] => {
    const present = new Set(Object.keys(candidateSelection(ctx)));
    return CANDIDATE_COLUMN_ORDER.filter((c) => present.has(c));
  };

  return {
    // REFERENCE TOOL — a scoped query + typed input + a display hint the UI
    // renders. Use it as the template for the tools you add.
    applicationCountByStage: tool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Pass a jobId to scope to one job.",
      inputSchema: z.object({ jobId: z.string().optional() }),
      async execute({ jobId }) {
        return safe("applicationCountByStage", async () => {
          const rows = await applicationCountByStage(ctx, { jobId });
          return result(rows, {
            kind: "bar",
            x: "stage",
            y: "count",
            title: "Applications by stage",
          });
        });
      },
    }),

    // Acquisition-channel mix. Pick this for "where are candidates coming
    // from", "sourcing breakdown", "which channel works best" — counts only,
    // no PII.
    candidatesBySource: tool({
      description:
        "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site). Use for questions about where candidates come from, the sourcing/channel mix, or which channel performs best. Returns one row per source with a count — no candidate names or contact details.",
      inputSchema: z.object({}),
      async execute() {
        return safe("candidatesBySource", async () => {
          const rows = await candidatesBySource(ctx);
          return result(rows, {
            kind: "bar",
            x: "source",
            y: "count",
            title: "Candidates by source",
          });
        });
      },
    }),

    // Open-roles / job health overview. Pick this for "which roles are open",
    // "jobs and their application volume". Optional status narrows the table.
    jobsOverview: tool({
      description:
        "List this workspace's jobs with department, status (open, closed, draft) and how many applications each has received. Use for 'which roles are open', 'open positions', or 'jobs and their application volume'. Pass status to show only jobs in that state. Returns a table — no candidate PII.",
      inputSchema: z.object({ status: z.enum(JOB_STATUSES).optional() }),
      async execute({ status }) {
        return safe("jobsOverview", async () => {
          // `jobsOverview` is scoped to the workspace in the query layer.
          // `status` is neither tenant scope nor PII, so narrowing the already-
          // scoped rows here is equivalent to a WHERE and keeps the spec-01
          // query fn untouched.
          const all = await jobsOverview(ctx);
          const rows = status ? all.filter((j) => j.status === status) : all;
          return result(rows, {
            kind: "table",
            columns: ["title", "department", "status", "applications"],
          });
        });
      },
    }),

    // PII-BEARING individual roster. Pick this ONLY for specific people, not for
    // counts or trends — and only name/email/phone the caller's role may read
    // are ever projected (analyst rows omit them entirely).
    listCandidates: tool({
      description:
        "List individual candidates in this workspace. Use ONLY when the user asks for specific people or a roster ('list candidates', 'who applied for X', 'show me candidates from referrals') — for counts or trends use the aggregate tools instead. Optional filters: source (referral, linkedin, job_board, agency, careers_site), stage (applied, screen, interview, offer, hired, rejected), jobId, and limit. This tool can surface candidate PII (name/email/phone), but those columns are only included for roles permitted to see them — for an analyst they are omitted from every row. Answer from the columns present; never invent hidden values.",
      inputSchema: z.object({
        source: z.enum(SOURCES).optional(),
        stage: z.enum(STAGES).optional(),
        jobId: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      async execute({ source, stage, jobId, limit }) {
        return safe("listCandidates", async () => {
          const rows = await listCandidates(ctx, {
            source,
            stage,
            jobId,
            limit,
          });
          return result(rows, {
            kind: "table",
            columns: candidateColumns(),
          });
        });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
