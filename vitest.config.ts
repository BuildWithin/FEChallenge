import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Vitest doesn't auto-load .env.local (that's Next.js). Parse it at config
// time and pass through test.env so every worker receives the vars.
function loadEnvLocal(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(__dirname, ".env.local"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, "$1");
      if (key) vars[key] = val;
    }
  } catch {
    // .env.local absent in CI — env vars come from the runtime environment
  }
  return vars;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    // PGlite + model streaming can take a moment on a cold start.
    testTimeout: 30_000,
    // Inject .env.local vars into every worker via test.env so scorers that
    // check AI_PROVIDER / OPENAI_API_KEY see the correct values.
    env: loadEnvLocal(),
    // PGlite is a single-connection WASM database. Multiple Vitest workers
    // each opening the same data directory in parallel causes WASM aborts.
    // isolate: false shares module state (and globalThis.__pglite__ from
    // client.ts) across all eval files so PGlite is initialised exactly once.
    fileParallelism: false,
    isolate: false,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
