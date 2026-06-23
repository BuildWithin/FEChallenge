import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    env: {
      // Pin the deterministic mock for unit tests so they never hit a real API,
      // even if the shell (or .env.local via `next dev`) exports AI_PROVIDER=openai.
      AI_PROVIDER: "mock",
      // Give each test worker its own IN-MEMORY PGlite. Vitest runs test files in
      // parallel worker processes; pointing them all at the shared file-backed
      // `./.pglite` made two processes open the same on-disk dir at once, which
      // crashes PGlite's WASM (`Aborted()`). An in-memory DB lives in each
      // worker's own heap — nothing is shared, so parallelism is safe (and the
      // real `./.pglite` used by `db:seed`/`next dev` is left untouched).
      PGLITE_DIR: "memory://",
    },
    // PGlite + model streaming can take a moment on a cold start.
    testTimeout: 30_000,
  },
});
