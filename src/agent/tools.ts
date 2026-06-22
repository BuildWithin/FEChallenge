/**
 * Tool catalog — 6 tools covering the core recruiting analytics questions.
 *
 * Design rules:
 *  - Each tool answers ONE question. The LLM picks by description, not by code.
 *  - workspaceId is NEVER in the input schema — it comes from ctx. Always.
 *  - Only `candidateList` returns PII. stripPII() gates it by role at the boundary.
 *
 * Catalog:
 *
 *  applicationCountByStage   "How does my pipeline look by stage?"
 *                            params: { jobId? }   display: bar_chart
 *
 *  applicationsByJob         "Which roles have the most applicants?"
 *                            params: {}           display: table
 *
 *  candidateSourceBreakdown  "Where are candidates coming from?"
 *                            params: { jobId? }   display: bar_chart
 *
 *  timeToHireByJob           "How long does hiring take per role?"
 *                            params: {}           display: table
 *
 *  jobList                   "What jobs are open right now?"
 *                            params: { status? }  display: table
 *
 *  candidateList             "Show me candidates for a job."        ⚠ PII
 *                            params: { jobId }    display: table
 */

import { tool } from "ai";
import { z } from "zod";

import { applicationCountByStage, type AnalyticsCtx } from "@/db/analytics";
import type { Display, ToolResult } from "./artifact";

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * This ships with ONE worked example. Designing the rest of the catalog is the
 * heart of the exercise: which tools should exist, their granularity, how their
 * inputs are shaped for a model to fill, and what each returns for the UI.
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
    // REFERENCE TOOL — a scoped query + typed input + a display hint the UI
    // renders. Use it as the template for the tools you add.
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

    // TODO(candidate): design and add the tools that make this a genuinely
    // useful analytics copilot for this workspace's recruiting data.
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
