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
    // PGlite is file-backed and WASM-based — one process avoids handle conflicts.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
