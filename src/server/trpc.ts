import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Procedure that requires a workspace in context. All tenant-owned reads
 * should use this (or call analytics fns that take ctx) — never query
 * tenant tables without workspaceId from the request.
 */
export const scopedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.workspaceId?.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing workspace context",
    });
  }
  return next({ ctx });
});
