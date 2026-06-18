import { z } from "zod";

/** Acquisition channels stored on candidates.source. */
export const APPLICATION_SOURCES = [
  "referral",
  "linkedin",
  "job_board",
  "agency",
  "careers_site",
] as const;

export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

/**
 * Cross-cutting analytics filters shared by application-scoped queries and tools.
 * All fields are optional — omit for workspace-wide results.
 */
export type AnalyticsFilters = {
  jobId?: string;
  source?: ApplicationSource;
  dateFrom?: string;
  dateTo?: string;
  department?: string;
};

/** Application-scoped queries may also filter by pipeline stage. */
export type ApplicationFilters = AnalyticsFilters & {
  stage?: string;
};

/** Zod fields — single source of truth for agent tools and tRPC inputs. */
export const analyticsFilterFields = {
  jobId: z
    .string()
    .optional()
    .describe("Scope to one job posting (resolve id via listJobs)"),
  source: z
    .enum(APPLICATION_SOURCES)
    .optional()
    .describe(
      "Filter to candidates from this acquisition source (referral, linkedin, job_board, agency, careers_site)",
    ),
  dateFrom: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD) — include applications on or after this date"),
  dateTo: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD) — include applications on or before this date"),
  department: z
    .string()
    .optional()
    .describe("Filter to jobs in this department (e.g. Engineering, Design)"),
} as const;

export const analyticsFilterSchema = z.object(analyticsFilterFields);

export const analyticsFilterInputSchema = analyticsFilterSchema.optional();

/** Appended to tool descriptions so the model learns one filter vocabulary. */
export const ANALYTICS_FILTER_DOCS =
  "Shared optional filters: jobId, source, dateFrom, dateTo, department.";
