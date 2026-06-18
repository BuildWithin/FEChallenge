import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    // PGlite + model streaming can take a moment on a cold start.
    testTimeout: 30_000,
    // CI/tests always use the offline mock — never a real API key.
    env: {
      AI_PROVIDER: "mock",
    },
    // PGlite is file-backed and WASM-based — one process avoids handle conflicts.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
