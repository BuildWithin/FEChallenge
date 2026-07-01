import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  jobsByStatus,
  listCandidates,
  openJobs as fetchOpenJobs,
  timeInFunnelByStage,
  type AnalyticsCtx,
} from "@/db/analytics";
import type { Display, ToolResult } from "./artifact";

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * The agent picks tools and passes high-level params — it never writes SQL.
 * Pass `ctx` to every query so results stay scoped to this workspace, and gate
 * PII by `ctx.role` (see src/db/permissions.ts). Each tool returns
 * `{ rows, display }` — see src/agent/artifact.ts.
 */
export function buildTools(ctx: AnalyticsCtx) {
  const result = (rows: ToolResult["rows"], display: Display): ToolResult => ({
    rows,
    display,
  });

  return {
    applicationCountByStage: tool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Pass a jobId to scope to one job.",
      inputSchema: z.object({ jobId: z.string().optional() }),
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
        "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site).",
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

    applicationsOverTime: tool({
      description:
        "Application volume over time, bucketed by week (default) or month. Use for trends.",
      inputSchema: z.object({ bucket: z.enum(["week", "month"]).optional() }),
      async execute({ bucket }) {
        const rows = await applicationsOverTime(ctx, { bucket });
        return result(rows, {
          kind: "line",
          x: "period",
          y: "count",
          title: "Applications over time",
        });
      },
    }),

    jobsByStatus: tool({
      description: "Count jobs grouped by status (open, closed, draft).",
      inputSchema: z.object({}),
      async execute() {
        const rows = await jobsByStatus(ctx);
        return result(rows, {
          kind: "bar",
          x: "status",
          y: "count",
          title: "Jobs by status",
        });
      },
    }),

    openJobs: tool({
      description: "List currently open jobs (title, department, location).",
      inputSchema: z.object({}),
      async execute() {
        const rows = await fetchOpenJobs(ctx);
        return result(rows, {
          kind: "table",
          columns: ["title", "department", "location"],
        });
      },
    }),

    timeInFunnel: tool({
      description:
        "Average days spent in the funnel per pipeline stage (proxy for time-to-stage).",
      inputSchema: z.object({}),
      async execute() {
        const rows = await timeInFunnelByStage(ctx);
        return result(rows, {
          kind: "bar",
          x: "stage",
          y: "avgDays",
          title: "Avg days in funnel by stage",
        });
      },
    }),

    listCandidates: tool({
      description:
        "List candidates in this workspace. Contact details (name/email/phone) are only returned for roles permitted to see them; analysts get anonymized rows.",
      inputSchema: z.object({
        source: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      async execute({ source, limit }) {
        const rows = await listCandidates(ctx, { source, limit });
        const columns = Object.keys(rows[0] ?? { id: null });
        return result(rows, { kind: "table", columns });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
