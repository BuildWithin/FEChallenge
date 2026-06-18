import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { ensureSchema } from "@/db/client";
import type { Role } from "@/db/permissions";
import { flattenToolInsights } from "./insights";
import { buildSystemPrompt } from "./prompts";
import { buildTools } from "./tools";
import { getModel } from "./provider";
import { agentStopConditions, MAX_AGENT_STEPS } from "./stop";

export { MAX_AGENT_STEPS };

/**
 * Runs the analytics copilot for one turn and RETURNS the `streamText` result.
 *
 * Stop strategy: finish when the model answers after grounded tool data, with
 * MAX_AGENT_STEPS as a safety cap. prepareStep injects computed insights so
 * the model summarizes trends, not just raw rows.
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
  model?: LanguageModel;
}) {
  await ensureSchema();

  const system = buildSystemPrompt(role);

  return streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    tools: buildTools({ workspaceId, role }),
    stopWhen: agentStopConditions,
    maxRetries: 2,
    prepareStep: async ({ steps }) => {
      if (steps.length === 0) return {};

      const last = steps[steps.length - 1];
      const insightLines = flattenToolInsights(
        last.toolResults.map((tr) => ({
          toolName: tr.toolName,
          output: tr.output,
        })),
      );

      if (insightLines.length === 0) return {};

      const hints = insightLines.map((line) => `- ${line}`).join("\n");
      return {
        system: `${system}\n\n## Computed insights (cite these in your answer)\n${hints}\n\nEnd with a **Key insights** bullet list using the trends above. If a tool failed, explain what went wrong and suggest next steps — do not invent data.`,
      };
    },
  });
}
