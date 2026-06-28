/**
 * Tiny env helper. No t3-env on purpose — keep the dependency surface small
 * and the defaults obvious. Everything has a sensible default so the app runs
 * with zero configuration.
 */

export type AiProvider = "mock" | "anthropic" | "openai" | "bedrock" | "google";

export const env = {
  /** Which model provider the agent uses. Defaults to the offline mock. */
  AI_PROVIDER: (process.env.AI_PROVIDER ?? "mock") as AiProvider,

  /** Model ids per provider (only read when that provider is selected). */
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  BEDROCK_MODEL:
    process.env.BEDROCK_MODEL ??
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
  // Gemini 2.5 Flash: fast, strong tool-calling, free-tier eligible via Google
  // AI Studio. Override with GOOGLE_MODEL (e.g. gemini-2.5-pro on the paid tier).
  GOOGLE_MODEL: process.env.GOOGLE_MODEL ?? "gemini-2.5-flash",

  /**
   * Optional gateway base URL. When set, the anthropic/openai providers route
   * through it — point this at a Vercel AI Gateway or Cloudflare AI Gateway
   * endpoint. Leave unset to call the provider directly. See `.env.example`.
   */
  AI_GATEWAY_BASE_URL: process.env.AI_GATEWAY_BASE_URL,

  /** File-backed PGlite directory, shared by the seed and dev processes. */
  PGLITE_DIR: process.env.PGLITE_DIR ?? "./.pglite",
} as const;
