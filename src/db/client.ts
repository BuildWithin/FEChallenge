import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";

import { env } from "@/env";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Neon path — used in production (Vercel + Neon serverless).
// Neon uses HTTP pooling, so no singleton guard is needed: each import gets
// the same module-level `db` instance (Node module cache handles it).
// ---------------------------------------------------------------------------
// PGlite path — used in local dev and all test environments.
// File-backed PGlite so the `db:seed` process and the `next dev` server share
// the same database. Postgres runs in-process — no Docker, no cloud.
//
// In Next dev, modules can be re-evaluated across HMR; we stash the client on
// `globalThis` so we don't open a second handle to the same directory.
// In test environments (Vitest / Evalite) use an in-memory database so
// concurrent eval files don't race on file-backed initdb and cause WASM aborts.
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as {
  __pglite__?: PGlite;
};

function buildDb() {
  if (env.DATABASE_URL) {
    return drizzleNeon(env.DATABASE_URL, { schema });
  }

  const pglite =
    globalForDb.__pglite__ ??
    new PGlite(process.env.VITEST ? undefined : env.PGLITE_DIR);

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__pglite__ = pglite;
  }

  return drizzlePglite(pglite, { schema });
}

export const db = buildDb();

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

export { initPromise };
