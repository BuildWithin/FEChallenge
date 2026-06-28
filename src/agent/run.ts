import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { ensureSchema } from "@/db/client";
import type { Role } from "@/db/permissions";
import { buildTools } from "./tools";
import { getModel, SYSTEM_PROMPT } from "./provider";

/**
 * Runs the analytics copilot for one turn and RETURNS the `streamText` result.
 *
 * The caller decides what to do with it:
 *   - the chat route calls `.toUIMessageStreamResponse()`
 *   - evals/tests `await result.steps` / `.toolCalls` / `.text`
 *
 * The agent loops (orient → query → answer) up to 6 steps via `stopWhen`.
 */
export async function streamCopilot({
  workspaceId,
  role,
  messages,
  model = getModel(),
}: {
  workspaceId: string;
  role: Role;
  messages: UIMessage[];
  /** Override the model — e.g. wrap it with evalite's wrapAISDKModel in evals. */
  model?: LanguageModel;
}) {
  await ensureSchema();

  return streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools({ workspaceId, role }),
    // Stop strategy: orient -> query -> answer rarely needs many hops, so cap at
    // 6 steps to bound cost/latency. The model also stops naturally on a
    // tool-free closing message before reaching the cap.
    stopWhen: stepCountIs(6),
    // Analytics answers should be reproducible, not creative — keep it cold.
    temperature: 0,
    // A throwing tool surfaces as a tool-error part (the model can retry or
    // explain it; the UI renders it via the "output-error" state). onError
    // catches stream-level failures so they're logged, not silently swallowed.
    onError: ({ error }) => {
      console.error("[copilot] stream error:", error);
    },
  });
}
