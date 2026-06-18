import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  candidatesInStage,
  jobPerformance,
  listJobs,
  pipelineVelocity,
  sourceEffectiveness,
  stageConversionRates,
  timeToHire,
  type AnalyticsCtx,
} from "@/db/analytics";
import {
  ANALYTICS_FILTER_DOCS,
  analyticsFilterFields,
  analyticsFilterSchema,
} from "@/db/filters";
import { redactDisplayColumns, redactRowsForRole } from "@/db/permissions";
import { deriveInsights } from "./insights";
import type { Display, ToolResult } from "./artifact";

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
 *
 * Application analytics tools share one filter shape (see analyticsFilterSchema)
 * so the model learns a single vocabulary: jobId, source, dateFrom, dateTo, department.
 */
export function buildTools(ctx: AnalyticsCtx) {
  const result = (
    toolName: string,
    rows: ToolResult["rows"],
    display: Display,
  ): ToolResult => {
    const safeRows = redactRowsForRole(ctx.role, rows);
    const safeDisplay: Display =
      display.kind === "table"
        ? {
            ...display,
            columns: redactDisplayColumns(ctx.role, display.columns),
          }
        : display;
    return {
      rows: safeRows,
      display: safeDisplay,
      insights: deriveInsights(toolName, safeRows),
    };
  };

  async function runQuery<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      throw new Error(
        `${toolName} failed: ${detail}. Widen filters (drop jobId or dates), verify jobId via listJobs, or try a different tool.`,
      );
    }
  }

  return {
    applicationCountByStage: tool({
      description: `Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Use for pipeline overview questions. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema,
      async execute(input) {
        return runQuery("applicationCountByStage", async () => {
          const rows = await applicationCountByStage(ctx, input);
          return result("applicationCountByStage", rows, {
            kind: "bar",
            x: "stage",
            y: "count",
            title: "Applications by stage",
          });
        });
      },
    }),

    candidatesBySource: tool({
      description: `Count applications grouped by candidate acquisition source (referral, linkedin, job_board, agency, careers_site). ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema,
      async execute(input) {
        return runQuery("candidatesBySource", async () => {
          const rows = await candidatesBySource(ctx, input);
          return result("candidatesBySource", rows, {
            kind: "bar",
            x: "source",
            y: "count",
            title: "Applications by source",
          });
        });
      },
    }),

    applicationsOverTime: tool({
      description: `Count applications over time in weekly or monthly buckets. Use for volume trends. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema.extend({
        granularity: z
          .enum(["month", "week"])
          .optional()
          .describe("Time bucket size (default: month)"),
      }),
      async execute(input) {
        return runQuery("applicationsOverTime", async () => {
          const rows = await applicationsOverTime(ctx, input);
          return result("applicationsOverTime", rows, {
            kind: "line",
            x: "period",
            y: "count",
            title: "Applications over time",
          });
        });
      },
    }),

    timeToHire: tool({
      description: `Recruiting KPI: average days from application (appliedAt) to hire for candidates in the hired stage. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema,
      async execute(input) {
        return runQuery("timeToHire", async () => {
          const rows = await timeToHire(ctx, input);
          return result("timeToHire", rows, {
            kind: "table",
            columns: ["avgDays", "hiredCount"],
          });
        });
      },
    }),

    stageConversionRates: tool({
      description: `Recruiting funnel KPI: step conversion through applied → screen → interview → offer → hired. ${ANALYTICS_FILTER_DOCS} Set funnelOnly (default true) to exclude rejected from funnel totals.`,
      inputSchema: analyticsFilterSchema.extend({
        funnelOnly: z
          .boolean()
          .optional()
          .describe("Exclude rejected from funnel totals (default: true)"),
      }),
      async execute(input) {
        const { funnelOnly = true, ...filters } = input;
        return runQuery("stageConversionRates", async () => {
          const rows = await stageConversionRates(ctx, {
            ...filters,
            funnelOnly,
          });
          return result("stageConversionRates", rows, {
            kind: "table",
            columns: [
              "stage",
              "count",
              "pctOfTotal",
              "conversionFromPrevious",
            ],
          });
        });
      },
    }),

    sourceEffectiveness: tool({
      description: `Recruiting KPI: compare acquisition sources by hires vs rejections with hire and rejection rates. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema,
      async execute(input) {
        return runQuery("sourceEffectiveness", async () => {
          const rows = await sourceEffectiveness(ctx, input);
          return result("sourceEffectiveness", rows, {
            kind: "table",
            columns: [
              "source",
              "totalApplications",
              "hiredCount",
              "rejectedCount",
              "inProgressCount",
              "hireRate",
              "rejectionRate",
            ],
          });
        });
      },
    }),

    pipelineVelocity: tool({
      description: `Recruiting KPI: average days applications spend at each pipeline stage. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema,
      async execute(input) {
        return runQuery("pipelineVelocity", async () => {
          const rows = await pipelineVelocity(ctx, input);
          return result("pipelineVelocity", rows, {
            kind: "bar",
            x: "stage",
            y: "avgDays",
            title: "Average days per stage",
          });
        });
      },
    }),

    jobPerformance: tool({
      description: `Application counts per job with title, department, and status. ${ANALYTICS_FILTER_DOCS} Also accepts status (open|closed|draft) to limit which jobs appear.`,
      inputSchema: analyticsFilterSchema.extend({
        status: jobStatusSchema,
      }),
      async execute(input) {
        return runQuery("jobPerformance", async () => {
          const rows = await jobPerformance(ctx, input);
          return result("jobPerformance", rows, {
            kind: "table",
            columns: [
              "title",
              "department",
              "status",
              "applicationCount",
            ],
          });
        });
      },
    }),

    candidatesInStage: tool({
      description: `List candidates in a specific pipeline stage. PII (name, email, phone) only for permitted roles. ${ANALYTICS_FILTER_DOCS}`,
      inputSchema: analyticsFilterSchema.extend({
        stage: stageSchema,
      }),
      async execute(input) {
        return runQuery("candidatesInStage", async () => {
          const rows = await candidatesInStage(ctx, input);
          const columns = rows[0]
            ? Object.keys(rows[0])
            : ["candidateId", "source", "stage", "jobId", "appliedAt"];
          return result("candidatesInStage", rows, { kind: "table", columns });
        });
      },
    }),

    listJobs: tool({
      description:
        "List job postings with title, department, location, and status. Use to discover job IDs before filtering other tools. Optional filters: status (open|closed|draft), department.",
      inputSchema: z.object({
        status: jobStatusSchema,
        department: analyticsFilterFields.department,
      }),
      async execute(input) {
        return runQuery("listJobs", async () => {
          const rows = await listJobs(ctx, input);
          return result("listJobs", rows, {
            kind: "table",
            columns: ["id", "title", "department", "location", "status"],
          });
        });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
