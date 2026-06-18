import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { ensureSchema } from "@/db/client";
import type { Role } from "@/db/permissions";
import { buildSystemPrompt } from "./prompts";
import { buildTools } from "./tools";
import { getModel } from "./provider";

/** Max agent steps — enough for listJobs → drill-down → summary. */
export const MAX_AGENT_STEPS = 8;

/**
 * Runs the analytics copilot for one turn and RETURNS the `streamText` result.
 *
 * The caller decides what to do with it:
 *   - the chat route calls `.toUIMessageStreamResponse()`
 *   - evals/tests `await result.steps` / `.toolCalls` / `.text`
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
    system: buildSystemPrompt(role),
    messages: await convertToModelMessages(messages),
    tools: buildTools({ workspaceId, role }),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
  });
}
