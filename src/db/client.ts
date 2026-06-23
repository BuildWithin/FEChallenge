import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { env } from "@/env";
import * as schema from "./schema";

/**
 * File-backed PGlite so the `db:seed` process and the `next dev` server share
 * the same database. Postgres runs in-process — no Docker, no cloud.
 *
 * In Next dev, modules can be re-evaluated across HMR; we stash the client on
 * `globalThis` so we don't open a second handle to the same directory.
 */
const globalForDb = globalThis as unknown as {
  __pglite__?: PGlite;
};

const pglite = globalForDb.__pglite__ ?? new PGlite(env.PGLITE_DIR);
if (process.env.NODE_ENV !== "production") {
  globalForDb.__pglite__ = pglite;
}

export const db = drizzle(pglite, { schema });

/**
 * Memoized schema initialization. Concurrent importers share one promise so
 * the raw DDL runs exactly once per process.
 */
let initPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // Imported lazily to avoid a circular import (migrate.ts imports `db`).
      const { ensureSchema: run } = await import("./migrate");
      await run();
    })();
  }
  return initPromise;
}

/**
 * Seed-on-boot, for ephemeral / in-memory deploys (e.g. Vercel serverless with
 * `PGLITE_DIR=memory://`) where the DB starts empty on every cold start and the
 * offline `pnpm db:seed` step never ran. Opt-in via `SEED_ON_BOOT=1`; otherwise
 * this is just `ensureSchema()` so local dev and tests are untouched.
 *
 * Memoized (one run per process) and gated on an empty DB, so it can never wipe
 * a live request. Safe because the app only READS the seeded data.
 */
let seedPromise: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  if (process.env.SEED_ON_BOOT !== "1") return ensureSchema();
  if (!seedPromise) {
    seedPromise = (async () => {
      await ensureSchema();
      const existing = await db.select().from(schema.workspaces).limit(1);
      if (existing.length === 0) {
        // Lazy import to avoid a circular import (seed.ts imports `db`).
        const { seed } = await import("./seed");
        await seed();
      }
    })();
  }
  return seedPromise;
}
