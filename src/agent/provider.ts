import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { createGateway, gateway } from "ai";
import type { LanguageModel } from "ai";

import { env, type AiProvider } from "@/env";
import { createMockModel } from "./mock-model";

/** @deprecated Import buildSystemPrompt from ./prompts instead. */
export { buildSystemPrompt } from "./prompts";

/**
 * Returns the language model for the configured provider.
 *
 * - `mock` — offline, deterministic (tests / CI / zero-setup dev)
 * - `anthropic` | `openai` | `bedrock` — direct provider keys
 * - Uses `AI_GATEWAY_BASE_URL` as provider baseURL when set, or `createGateway`
 *   from the AI SDK when `AI_GATEWAY_API_KEY` is set without a custom base URL.
 */
export function getModel(): LanguageModel {
  switch (env.AI_PROVIDER) {
    case "mock":
      return createMockModel();

    case "anthropic": {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          "AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add it to .env.local or use AI_PROVIDER=mock.",
        );
      }
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: env.AI_GATEWAY_BASE_URL || undefined,
      });
      return anthropic(env.ANTHROPIC_MODEL);
    }

    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "AI_PROVIDER=openai but OPENAI_API_KEY is not set. Add it to .env.local or use AI_PROVIDER=mock.",
        );
      }
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: env.AI_GATEWAY_BASE_URL || undefined,
      });
      return openai(env.OPENAI_MODEL);
    }

    case "bedrock": {
      if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
        throw new Error(
          "AI_PROVIDER=bedrock but no AWS credentials found (AWS_ACCESS_KEY_ID or AWS_PROFILE). Configure AWS creds or use AI_PROVIDER=mock.",
        );
      }
      return bedrock(env.BEDROCK_MODEL);
    }

    default: {
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Unknown AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

/** Resolve a model via the Vercel AI Gateway (optional helper for gateway-only setups). */
export function getGatewayModel(modelId: string): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) {
    const gw = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
    return gw(modelId);
  }
  return gateway(modelId);
}

export function getActiveProvider(): AiProvider {
  return env.AI_PROVIDER;
}

export function isMockProvider(): boolean {
  return env.AI_PROVIDER === "mock";
}

export function getProviderLabel(): string {
  if (isMockProvider()) return "Mock (offline)";
  if (env.AI_GATEWAY_BASE_URL) return `${env.AI_PROVIDER} via gateway`;
  return env.AI_PROVIDER;
}
