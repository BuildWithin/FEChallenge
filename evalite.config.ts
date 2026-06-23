import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "evalite/config";

// Evalite runs its own Vite instance — not vitest.config.ts. Load .env.local
// here so AI_PROVIDER, OPENAI_API_KEY, etc. are available in eval scorers.
// Uses `define` to bake values into the compiled eval bundle, falling back to
// whatever is already in process.env (so runtime overrides still work).
function loadEnvLocal(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
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

const envLocal = loadEnvLocal();

// Also set in process.env so non-Vite-transformed paths (e.g. config files
// that run in the main process) pick up the values.
for (const [k, v] of Object.entries(envLocal)) {
  if (!(k in process.env)) process.env[k] = v;
}

/**
 * Evalite runs its own Vite, so re-declare the `@` → `src` alias the app uses
 * (mirrors `vitest.config.ts`). Storage is left as the default (in-memory), so
 * evals need zero setup — no database, no native deps.
 */
export default defineConfig({
  viteConfig: {
    resolve: {
      alias: { "@": resolve(process.cwd(), "src") },
    },
    // Bake .env.local vars into the compiled eval bundle so process.env.*
    // checks in scorers see the correct values regardless of worker isolation.
    define: Object.fromEntries(
      Object.entries(envLocal).map(([k, v]) => [
        `process.env.${k}`,
        JSON.stringify(v),
      ]),
    ),
  },
});
