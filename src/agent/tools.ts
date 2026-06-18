import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  candidatesInStage,
  jobPerformance,
  listJobs,
  stageConversionRates,
  timeToHire,
  type AnalyticsCtx,
} from "@/db/analytics";
import { redactDisplayColumns, redactRowsForRole } from "@/db/permissions";
import type { Display, ToolResult } from "./artifact";

const dateRangeSchema = {
  dateFrom: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD) — include applications on or after this date"),
  dateTo: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD) — include applications on or before this date"),
};

const sourceSchema = z
  .enum(["referral", "linkedin", "job_board", "agency", "careers_site"])
  .optional()
  .describe("Filter to candidates from this acquisition source");

const stageSchema = z
  .enum(["applied", "screen", "interview", "offer", "hired", "rejected"])
  .describe("Pipeline stage");

const jobStatusSchema = z
  .enum(["open", "closed", "draft"])
  .optional()
  .describe("Filter jobs by posting status");

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * Each tool wraps a scoped analytics query. The agent picks tools and passes
 * high-level params; it never writes SQL. Every query receives `ctx` so results
 * stay scoped to this workspace.
 */
export function buildTools(ctx: AnalyticsCtx) {
  const result = (rows: ToolResult["rows"], display: Display): ToolResult => {
    const safeRows = redactRowsForRole(ctx.role, rows);
    const safeDisplay: Display =
      display.kind === "table"
        ? {
            ...display,
            columns: redactDisplayColumns(ctx.role, display.columns),
          }
        : display;
    return { rows: safeRows, display: safeDisplay };
  };

  return {
    applicationCountByStage: tool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Use for pipeline overview questions. Optionally filter by jobId or date range.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Scope to one job posting"),
        ...dateRangeSchema,
      }),
      async execute(input) {
        const rows = await applicationCountByStage(ctx, input);
        return result(rows, {
          kind: "bar",
          x: "stage",
          y: "count",
          title: "Applications by stage",
        });
      },
    }),

    candidatesBySource: tool({
      description:
        "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site). Use for questions about where candidates come from.",
      inputSchema: z.object({ ...dateRangeSchema }),
      async execute(input) {
        const rows = await candidatesBySource(ctx, input);
        return result(rows, {
          kind: "bar",
          x: "source",
          y: "count",
          title: "Candidates by source",
        });
      },
    }),

    applicationsOverTime: tool({
      description:
        "Count applications over time in weekly or monthly buckets. Use for volume trends and hiring velocity questions.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Scope to one job posting"),
        granularity: z
          .enum(["month", "week"])
          .optional()
          .describe("Time bucket size (default: month)"),
        ...dateRangeSchema,
      }),
      async execute(input) {
        const rows = await applicationsOverTime(ctx, input);
        return result(rows, {
          kind: "line",
          x: "period",
          y: "count",
          title: "Applications over time",
        });
      },
    }),

    timeToHire: tool({
      description:
        "Average days from application to hire for candidates in the hired stage. Optionally filter by job or department.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Scope to one job posting"),
        department: z
          .string()
          .optional()
          .describe("Filter to jobs in this department (e.g. Engineering)"),
        ...dateRangeSchema,
      }),
      async execute(input) {
        const rows = await timeToHire(ctx, input);
        return result(rows, {
          kind: "table",
          columns: ["avgDays", "hiredCount"],
        });
      },
    }),

    stageConversionRates: tool({
      description:
        "Pipeline funnel metrics: count per stage, percentage of total applications, and conversion rate from the previous stage. Use for drop-off and funnel efficiency questions.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Scope to one job posting"),
        ...dateRangeSchema,
      }),
      async execute(input) {
        const rows = await stageConversionRates(ctx, input);
        return result(rows, {
          kind: "table",
          columns: [
            "stage",
            "count",
            "pctOfTotal",
            "conversionFromPrevious",
          ],
        });
      },
    }),

    jobPerformance: tool({
      description:
        "Application counts per job with title, department, and status. Use to compare roles or find which jobs attract the most applicants.",
      inputSchema: z.object({
        status: jobStatusSchema,
        department: z
          .string()
          .optional()
          .describe("Filter to jobs in this department"),
        ...dateRangeSchema,
      }),
      async execute(input) {
        const rows = await jobPerformance(ctx, input);
        return result(rows, {
          kind: "table",
          columns: [
            "title",
            "department",
            "status",
            "applicationCount",
          ],
        });
      },
    }),

    candidatesInStage: tool({
      description:
        "List candidates in a specific pipeline stage. Returns PII (name, email, phone) only for permitted roles; analysts see anonymized candidate IDs. Optionally filter by job or source.",
      inputSchema: z.object({
        stage: stageSchema,
        jobId: z.string().optional().describe("Scope to one job posting"),
        source: sourceSchema,
      }),
      async execute(input) {
        const rows = await candidatesInStage(ctx, input);
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ["candidateId", "source", "stage", "jobId", "appliedAt"];
        return result(rows, { kind: "table", columns });
      },
    }),

    listJobs: tool({
      description:
        "List job postings in the workspace with title, department, location, and status. Use to discover job IDs or answer questions about open roles.",
      inputSchema: z.object({
        status: jobStatusSchema,
        department: z
          .string()
          .optional()
          .describe("Filter to jobs in this department"),
      }),
      async execute(input) {
        const rows = await listJobs(ctx, input);
        return result(rows, {
          kind: "table",
          columns: ["title", "department", "location", "status"],
        });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
