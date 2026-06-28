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
    // One file-backed PGlite dir is shared by all tests; run files serially so
    // separate worker processes don't open the same database concurrently.
    fileParallelism: false,
  },
});
