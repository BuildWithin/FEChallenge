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
 *                            params: { jobId? }   display: bar
 *
 *  applicationsByJob         "Which roles have the most applicants?"
 *                            params: {}           display: table
 *
 *  candidateSourceBreakdown  "Where are candidates coming from?"
 *                            params: { jobId? }   display: bar
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

import { applicationCountByStage, getApplicationsByJob, getCandidateSourceBreakdown, getTimeToHireByJob, getJobList, getCandidatesForJob, type AnalyticsCtx } from "@/db/analytics";
import { stripPII, PII_COLUMNS } from "@/db/permissions";
import type { Display, ToolResult } from "./artifact";

// ---------------------------------------------------------------------------
// In-memory tool result cache
//
// Key format: `${workspaceId}::${toolName}::${JSON.stringify(params)}`
// workspaceId MUST be part of the key — omitting it would be the cache-
// equivalent of omitting scopeWhere: a tenant isolation bug.
//
// Raw (pre-PII) data is stored. stripPII is applied after retrieval, per-
// request, using the caller's role. Role does NOT go in the key — two callers
// with different roles for the same workspace hit the same cache entry; the
// PII gate is applied on the way out of the cache, not on the way in.
// ---------------------------------------------------------------------------

const toolCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function getCached(key: string): unknown | undefined {
  const entry = toolCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return undefined;
  return entry.data;
}

function setCached(key: string, data: unknown): void {
  toolCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

    applicationsByJob: tool({
      description:
        "Returns application counts grouped by job. Useful for questions like 'which roles get the most applicants?' or 'how is hiring volume distributed across jobs?'. Returns one row per job with the job title, application count, and average days in pipeline.",
      inputSchema: z.object({ jobId: z.string().optional() }),
      async execute({ jobId }) {
        const cacheKey = `${ctx.workspaceId}::applicationsByJob::${JSON.stringify({ jobId })}`;
        const cached = getCached(cacheKey);
        if (cached !== undefined) {
          console.log("[cache HIT]", cacheKey);
          return result(cached as ToolResult["rows"], {
            kind: "table",
            columns: ["jobTitle", "count", "avgDaysInPipeline"],
          });
        }
        console.log("[cache MISS]", cacheKey);
        const rows = await getApplicationsByJob(ctx, { jobId });
        setCached(cacheKey, rows);
        return result(rows, {
          kind: "table",
          columns: ["jobTitle", "count", "avgDaysInPipeline"],
        });
      },
    }),

    candidateSourceBreakdown: tool({
      description:
        "Returns candidate counts grouped by source (LinkedIn, referral, job board, etc). Useful for 'where are candidates coming from?' or 'which sourcing channels are most effective?'. Includes percentage of total per source.",
      inputSchema: z.object({ jobId: z.string().optional() }),
      async execute({ jobId }) {
        const cacheKey = `${ctx.workspaceId}::candidateSourceBreakdown::${JSON.stringify({ jobId })}`;
        const cached = getCached(cacheKey);
        if (cached !== undefined) {
          console.log("[cache HIT]", cacheKey);
          return result(cached as ToolResult["rows"], {
            kind: "bar",
            x: "source",
            y: "count",
            title: "Candidates by source",
          });
        }
        console.log("[cache MISS]", cacheKey);
        const rows = await getCandidateSourceBreakdown(ctx, { jobId });
        setCached(cacheKey, rows);
        return result(rows, {
          kind: "bar",
          x: "source",
          y: "count",
          title: "Candidates by source",
        });
      },
    }),

    timeToHireByJob: tool({
      description:
        "Returns time-to-hire metrics per job: median days from application to hire and total hires. Useful for 'how long does hiring take?' or 'which roles have the fastest pipeline?'. Only includes jobs with at least one hire.",
      inputSchema: z.object({}),
      async execute() {
        const cacheKey = `${ctx.workspaceId}::timeToHireByJob::${JSON.stringify({})}`;
        const cached = getCached(cacheKey);
        if (cached !== undefined) {
          console.log("[cache HIT]", cacheKey);
          return result(cached as ToolResult["rows"], {
            kind: "table",
            columns: ["jobTitle", "medianDays", "hiredCount"],
          });
        }
        console.log("[cache MISS]", cacheKey);
        const rows = await getTimeToHireByJob(ctx);
        setCached(cacheKey, rows);
        return result(rows, {
          kind: "table",
          columns: ["jobTitle", "medianDays", "hiredCount"],
        });
      },
    }),

    jobList: tool({
      description:
        "Returns the list of jobs in this workspace. Useful for 'what jobs are open?' or 'show me all roles'. Pass a status to filter (e.g. 'open', 'closed', 'draft').",
      inputSchema: z.object({ status: z.string().optional() }),
      async execute({ status }) {
        const rows = await getJobList(ctx, { status });
        return result(rows, {
          kind: "table",
          columns: ["title", "status", "daysOpen"],
        });
      },
    }),

    candidateList: tool({
      description:
        "Returns candidates who applied for a specific job. Requires a jobId — use the jobList tool first to find job IDs. PII fields (name, email, phone) are only present for recruiter and admin roles — analysts receive a stripped view with stage, source, and days since applied only.",
      inputSchema: z.object({ jobId: z.string() }),
      async execute({ jobId }) {
        const cacheKey = `${ctx.workspaceId}::candidateList::${JSON.stringify({ jobId })}`;
        const cached = getCached(cacheKey);
        // Raw (pre-PII) rows are stored in the cache. The cast to
        // Record<string, unknown>[] is sound: we only cache the result of
        // getCandidatesForJob, which satisfies that structural type. stripPII
        // is applied per-request so role differences are handled correctly.
        if (cached !== undefined) {
          console.log("[cache HIT]", cacheKey);
          const safe = stripPII(cached as Record<string, unknown>[], ctx.role);
          const piiCols = ctx.role === "analyst" ? [] : [...PII_COLUMNS.candidates];
          return result(safe, {
            kind: "table",
            columns: [...piiCols, "stage", "source", "daysSinceApplied"],
          });
        }
        console.log("[cache MISS]", cacheKey);
        const rows = await getCandidatesForJob(ctx, jobId);
        setCached(cacheKey, rows); // store raw, before stripPII
        const safe = stripPII(rows, ctx.role);
        const piiCols = ctx.role === "analyst" ? [] : [...PII_COLUMNS.candidates];
        return result(safe, {
          kind: "table",
          columns: [...piiCols, "stage", "source", "daysSinceApplied"],
        });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
