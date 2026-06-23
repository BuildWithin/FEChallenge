import { z } from "zod";

import { db, ensureSeeded } from "@/db/client";
import { applicationCountByStage } from "@/db/analytics";
import { workspaces } from "@/db/schema";
import { publicProcedure, router } from "../trpc";

export const appRouter = router({
  workspaces: router({
    // For the tenant switcher in the UI.
    list: publicProcedure.query(async () => {
      await ensureSeeded();
      return db.select().from(workspaces).orderBy(workspaces.name);
    }),
  }),

  analytics: router({
    // Reference scoped read: passes ctx (workspaceId + role) to the analytics
    // layer. Mirror this pattern for any procedures you add.
    applicationsByStage: publicProcedure
      .input(z.object({ jobId: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSeeded();
        return applicationCountByStage(ctx, input ?? {});
      }),
  }),
});

export type AppRouter = typeof appRouter;
