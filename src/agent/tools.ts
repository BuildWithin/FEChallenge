import { tool } from "ai";
import { z, type ZodTypeAny } from "zod";

import { applicationCountByStage, type AnalyticsCtx } from "@/db/analytics";
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

    // TODO(candidate): design and add the tools that make this a genuinely
    // useful analytics copilot for this workspace's recruiting data.
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
