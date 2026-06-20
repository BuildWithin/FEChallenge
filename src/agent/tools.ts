import { tool } from "ai";
import { z, type ZodTypeAny } from "zod";

import { applicationCountByStage, applicationsOverTime, jobsOverview, listCandidates, type AnalyticsCtx } from "@/db/analytics";
import { APPLICATION_STAGES, CANDIDATE_SOURCES, JOB_STATUSES, TIME_GRANULARITIES } from "@/db/schema";
import { canSeePII } from "@/db/permissions";
import type { Display, Row, ToolResult } from "./artifact";
import { optional } from "./schema";

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
  /**
   * Wraps a query in a tool with consistent error handling: catches any throw,
   * logs the real error server-side, and returns a sanitized { error } so the
   * model can narrate to the user. Tenant scoping stays in the query layer.
   */
  function analyticsTool<TSchema extends ZodTypeAny>({
    description,
    inputSchema,
    display,
    query,
  }: {
    description: string;
    inputSchema: TSchema;
    display: Display;
    query: (ctx: AnalyticsCtx, input: z.infer<TSchema>) => Promise<Row[]>;
  }) {
    return tool({
      description,
      inputSchema,
      async execute(input): Promise<ToolResult> {
        try {
          const rows = await query(ctx, input);
          return { rows, display };
        } catch (err) {
          console.error("[tool error]", err);
          return { error: "I couldn't retrieve that data right now." };
        }
      },
    });
  }

  return {
    // REFERENCE TOOL, a scoped query + typed input + a display hint the UI
    // renders. Use it as the template for the tools you add.
    applicationCountByStage: analyticsTool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Pass a jobId to scope to one job.",
      inputSchema: z.object({ jobId: optional(z.string()) }),
      display: { kind: "bar", x: "stage", y: "count", title: "Applications by stage" },
      query: (ctx, { jobId }) => applicationCountByStage(ctx, { jobId }),
    }),

    listCandidates: analyticsTool({
      description:
        "List candidates in this workspace. Optional filters: application stage, candidate source, or jobId. Returns a table of candidates.",
      inputSchema: z.object({
        stage: optional(z.enum(APPLICATION_STAGES)),
        source: optional(z.enum(CANDIDATE_SOURCES)),
        jobId: optional(z.string()),
        limit: optional(z.number().int().positive()),
      }),
      display: {
        kind: "table",
        columns: canSeePII(ctx.role)
          ? ["name", "email", "phone", "source", "createdAt"]
          : ["source", "createdAt"],
      },
      query: (ctx, input) => listCandidates(ctx, input),
    }),

    applicationsOverTime: analyticsTool({
      description:
        "Show application volume over time as a trend line. Buckets applications by day, week or month (default week). Optional filters: a date range or a jobId.",
      inputSchema: z.object({
        granularity: optional(z.enum(TIME_GRANULARITIES)),
        dateRange: optional(
          z.object({ from: optional(z.string()), to: optional(z.string()) }),
        ),
        jobId: optional(z.string()),
      }),
      display: { kind: "line", x: "bucket", y: "count", title: "Applications over time" },
      query: (ctx, { granularity, dateRange, jobId }) =>
        applicationsOverTime(ctx, {
          granularity,
          from: dateRange?.from,
          to: dateRange?.to,
          jobId,
        }),
    }),

    jobsOverview: analyticsTool({
      description:
        "List the jobs (roles/openings) in this workspace with each job's application counts broken down by stage. Optional filter: status (open, closed, draft). Use it to see all roles at once, or to find a job's id from its title before filtering another tool by that job.",
      inputSchema: z.object({ status: optional(z.enum(JOB_STATUSES)) }),
      display: {
        kind: "table",
        columns: ["title", "status", "applied", "screen", "interview", "offer", "hired", "rejected", "total"],
      },
      query: (ctx, { status }) => jobsOverview(ctx, { status }),
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
