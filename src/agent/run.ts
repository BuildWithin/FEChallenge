import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { ensureSeeded } from "@/db/client";
import type { Role } from "@/db/permissions";
import { buildTools } from "./tools";
import { getModel, buildSystemPrompt } from "./provider";

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
  await ensureSeeded();

  // A minimal loop: one model, the scoped tools, capped at 6 steps via
  // `stopWhen`. Tool failures are caught per-tool (the `safe` wrapper in
  // tools.ts) and at the stream level (`onError` below), so a failing query
  // degrades gracefully instead of crashing the turn.
  return streamText({
    model,
    system: buildSystemPrompt(role),
    messages: await convertToModelMessages(messages),
    tools: buildTools({ workspaceId, role }),
    stopWhen: stepCountIs(6),
    // A tool or stream failure shouldn't crash the turn. Surface it (logged) so
    // the model can recover within the loop and tell the user the data couldn't
    // be retrieved, per the system prompt's failure rule.
    onError: ({ error }) => {
      console.error("[streamCopilot] stream error:", error);
    },
  });
}
