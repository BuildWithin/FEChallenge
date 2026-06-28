import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  listCandidates,
  listJobs,
  timeToHire,
  type AnalyticsCtx,
} from "@/db/analytics";
import { canReadPII } from "@/db/permissions";
import type { Display, ToolResult } from "./artifact";

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * Each tool is a thin wrapper over a scoped query in `src/db/analytics.ts`. The
 * agent picks tools and passes high-level params — it never writes SQL. `ctx`
 * (workspaceId + role) is threaded into every query, so tenant scoping and PII
 * gating hold at the tool boundary, not just at the DB.
 *
 * Inputs are ALL optional on purpose: the offline mock model calls tools with
 * empty args, so the catalog must stay drivable with no params (and a real model
 * gets enums/descriptions to fill them well).
 *
 * Each tool returns `{ rows, display }` — see src/agent/artifact.ts.
 */
export function buildTools(ctx: AnalyticsCtx) {
  const result = (rows: ToolResult["rows"], display: Display): ToolResult => ({
    rows,
    display,
  });

  return {
    // REFERENCE TOOL — a scoped query + typed input + a display hint the UI renders.
    applicationCountByStage: tool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Pass a jobId to scope to one job. Use for 'how does my pipeline look'.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Restrict to a single job's applications."),
      }),
      async execute({ jobId }) {
        const rows = await applicationCountByStage(ctx, { jobId });
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
        "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site). Use for 'where are candidates coming from'.",
      inputSchema: z.object({}),
      async execute() {
        const rows = await candidatesBySource(ctx);
        return result(rows, {
          kind: "bar",
          x: "source",
          y: "count",
          title: "Candidates by source",
        });
      },
    }),

    listJobs: tool({
      description:
        "List the jobs in this workspace, optionally filtered by status. Use for 'what roles are open' or to find a jobId before drilling into one job.",
      inputSchema: z.object({
        status: z
          .enum(["open", "closed", "draft"])
          .optional()
          .describe("Filter to jobs with this status."),
      }),
      async execute({ status }) {
        const rows = await listJobs(ctx, { status });
        return result(rows, {
          kind: "table",
          columns: ["title", "department", "location", "status"],
        });
      },
    }),

    applicationsOverTime: tool({
      description:
        "Application volume over time, bucketed by day, week, or month — for trend lines. Pass a jobId to scope to one job. Use for 'how have applications trended'.",
      inputSchema: z.object({
        bucket: z
          .enum(["day", "week", "month"])
          .optional()
          .describe("Time bucket size; defaults to week."),
        jobId: z.string().optional().describe("Restrict to a single job."),
      }),
      async execute({ bucket, jobId }) {
        const rows = await applicationsOverTime(ctx, { bucket, jobId });
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
        "Average days from application to hire (and number of hires), optionally for one job. Use for 'how long does it take us to hire'.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Restrict to a single job."),
      }),
      async execute({ jobId }) {
        const rows = await timeToHire(ctx, { jobId });
        return result(rows, {
          kind: "table",
          columns: ["avgDaysToHire", "hires"],
        });
      },
    }),

    listCandidates: tool({
      description:
        "List individual candidates in this workspace, newest first, optionally filtered by source. Candidate names/emails/phones are only returned for roles permitted to see PII.",
      inputSchema: z.object({
        source: z
          .enum(["referral", "linkedin", "job_board", "agency", "careers_site"])
          .optional()
          .describe("Filter to candidates from this source."),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max candidates to return (default 50)."),
      }),
      async execute({ source, limit }) {
        const rows = await listCandidates(ctx, { source, limit });
        // Column hint mirrors what the scoped query actually returns for this
        // role — PII columns are absent entirely for an analyst.
        const columns = canReadPII(ctx.role)
          ? ["name", "email", "phone", "source", "createdAt"]
          : ["id", "source", "createdAt"];
        return result(rows, { kind: "table", columns });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
