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
import { analyticsFilterInputSchema, analyticsFilterSchema } from "@/db/filters";
import { db, ensureSchema } from "@/db/client";
import { getProviderLabel, isMockProvider } from "@/agent/provider";
import { env } from "@/env";
import { workspaces } from "@/db/schema";
import { router, scopedProcedure, publicProcedure } from "../trpc";

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
  meta: router({
    agent: publicProcedure.query(() => ({
      provider: env.AI_PROVIDER,
      label: getProviderLabel(),
      isMock: isMockProvider(),
    })),
  }),

  workspaces: router({
    // Intentionally unscoped: lists workspace names for the tenant switcher only.
    list: publicProcedure.query(async () => {
      await ensureSchema();
      return db.select().from(workspaces).orderBy(workspaces.name);
    }),
  }),

  analytics: router({
    applicationsByStage: scopedProcedure
      .input(analyticsFilterInputSchema)
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          applicationCountByStage(scoped, input ?? {}),
        ),
      ),

    candidatesBySource: scopedProcedure
      .input(analyticsFilterInputSchema)
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => candidatesBySource(scoped, input ?? {})),
      ),

    applicationsOverTime: scopedProcedure
      .input(
        analyticsFilterSchema
          .extend({ granularity: z.enum(["month", "week"]).optional() })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          applicationsOverTime(scoped, input ?? {}),
        ),
      ),

    timeToHire: scopedProcedure
      .input(analyticsFilterInputSchema)
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => timeToHire(scoped, input ?? {})),
      ),

    stageConversionRates: scopedProcedure
      .input(
        analyticsFilterSchema
          .extend({ funnelOnly: z.boolean().optional() })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          stageConversionRates(scoped, input ?? {}),
        ),
      ),

    sourceEffectiveness: scopedProcedure
      .input(analyticsFilterInputSchema)
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) =>
          sourceEffectiveness(scoped, input ?? {}),
        ),
      ),

    pipelineVelocity: scopedProcedure
      .input(analyticsFilterInputSchema)
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => pipelineVelocity(scoped, input ?? {})),
      ),

    jobPerformance: scopedProcedure
      .input(
        analyticsFilterSchema.extend({ status: jobStatusInput }).optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => jobPerformance(scoped, input ?? {})),
      ),

    candidatesInStage: scopedProcedure
      .input(analyticsFilterSchema.extend({ stage: stageInput }))
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => candidatesInStage(scoped, input)),
      ),

    listJobs: scopedProcedure
      .input(
        z
          .object({
            status: jobStatusInput,
            department: analyticsFilterSchema.shape.department,
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        withAnalytics(ctx, (scoped) => listJobs(scoped, input ?? {})),
      ),
  }),
});

export type AppRouter = typeof appRouter;
