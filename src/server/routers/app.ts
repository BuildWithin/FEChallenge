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
import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { router, scopedProcedure, publicProcedure } from "../trpc";

const dateRangeInput = {
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
};

const sourceInput = z
  .enum(["referral", "linkedin", "job_board", "agency", "careers_site"])
  .optional();

const stageInput = z.enum([
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
]);

const jobStatusInput = z.enum(["open", "closed", "draft"]).optional();

/** Ensures schema is ready, then runs an analytics fn with request ctx. */
async function withAnalytics<T>(
  ctx: AnalyticsCtx,
  fn: (scoped: AnalyticsCtx) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  return fn(ctx);
}

export const appRouter = router({
  workspaces: router({
    // Intentionally unscoped: lists workspace names for the tenant switcher only.
    list: publicProcedure.query(async () => {
      await ensureSchema();
      return db.select().from(workspaces).orderBy(workspaces.name);
    }),
  }),

  analytics: router({
    applicationsByStage: scopedProcedure
      .input(
        z
          .object({
            jobId: z.string().optional(),
            ...dateRangeInput,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          applicationCountByStage(scoped, input ?? {}),
        ),
      ),

    candidatesBySource: scopedProcedure
      .input(z.object(dateRangeInput).optional())
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => candidatesBySource(scoped, input ?? {})),
      ),

    applicationsOverTime: scopedProcedure
      .input(
        z
          .object({
            jobId: z.string().optional(),
            granularity: z.enum(["month", "week"]).optional(),
            ...dateRangeInput,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          applicationsOverTime(scoped, input ?? {}),
        ),
      ),

    timeToHire: scopedProcedure
      .input(
        z
          .object({
            jobId: z.string().optional(),
            department: z.string().optional(),
            ...dateRangeInput,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => timeToHire(scoped, input ?? {})),
      ),

    stageConversionRates: scopedProcedure
      .input(
        z
          .object({
            jobId: z.string().optional(),
            ...dateRangeInput,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          stageConversionRates(scoped, input ?? {}),
        ),
      ),

    jobPerformance: scopedProcedure
      .input(
        z
          .object({
            status: jobStatusInput,
            department: z.string().optional(),
            ...dateRangeInput,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => jobPerformance(scoped, input ?? {})),
      ),

    candidatesInStage: scopedProcedure
      .input(
        z.object({
          stage: stageInput,
          jobId: z.string().optional(),
          source: sourceInput,
        }),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => candidatesInStage(scoped, input)),
      ),

    listJobs: scopedProcedure
      .input(
        z
          .object({
            status: jobStatusInput,
            department: z.string().optional(),
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => listJobs(scoped, input ?? {})),
      ),
  }),
});

export type AppRouter = typeof appRouter;
