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
declare global {
  // eslint-disable-next-line no-var
  var __pglite__: PGlite | undefined;
}

const pglite = globalThis.__pglite__ ?? new PGlite(env.PGLITE_DIR);
if (process.env.NODE_ENV !== "production") {
  globalThis.__pglite__ = pglite;
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
