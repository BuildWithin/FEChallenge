import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

/**
 * Deterministic, offline mock language model (provider interface v3 — matches
 * the installed `ai` / `@ai-sdk/provider` versions). It drives a REAL
 * tool-calling loop through `streamText` with no network and no API key.
 *
 * It is GENERIC: it inspects whatever tools you register and drives a simple
 * loop — pick the tool whose name/description best matches the user's question,
 * call it, then summarize. So as you design and add tools, the app keeps running
 * offline with zero setup.
 *
 * Limits (by design — it's a stand-in for a real model):
 *   - It calls tools with EMPTY args, so give your tools sensible OPTIONAL
 *     params. For richer offline behavior, extend this; for real reasoning,
 *     point AI_PROVIDER at a model/gateway (see src/agent/provider.ts).
 */

const usage = {
  inputTokens: { total: 32, noCache: 32, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 24, text: 24, reasoning: 0 },
} as const;

const finished = (
  reason: "stop" | "tool-calls",
): Extract<LanguageModelV3StreamPart, { type: "finish" }> => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage,
});

/** Count tool-result parts already present in the prompt (which loop step we're on). */
function countToolResults(prompt: LanguageModelV3Prompt): number {
  let total = 0;
  for (const message of prompt) {
    if (message.role !== "tool" && message.role !== "assistant") continue;
    for (const part of message.content) {
      if (typeof part === "string") continue;
      if (part.type === "tool-result") total += 1;
    }
  }
  return total;
}

/** Pull the last user text out of the prompt to read intent. */
function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role !== "user") continue;
    const text = message.content
      .map((part) =>
        typeof part !== "string" && part.type === "text" ? part.text : "",
      )
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

type FnTool = { name: string; description: string };

/** Read the function tools streamText handed us for this call. */
function functionTools(options: LanguageModelV3CallOptions): FnTool[] {
  const tools = (options.tools ?? []) as Array<{
    type?: string;
    name?: string;
    description?: string;
  }>;
  return tools
    .filter((t) => t.type === "function" && typeof t.name === "string")
    .map((t) => ({ name: t.name as string, description: t.description ?? "" }));
}

const STAGES = [
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

/** Split camelCase tool names into words for intent matching. */
function toolNameWords(name: string): string[] {
  return name
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/** Pick the tool whose name/description best overlaps the user's question. */
function pickTool(tools: FnTool[], userText: string): FnTool {
  const t = userText.toLowerCase();
  let best = tools[0];
  let bestScore = -1;
  for (const tool of tools) {
    const words = `${tool.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    let score = words.filter((w) => t.includes(w)).length;
    score += toolNameWords(tool.name).filter((w) => t.includes(w)).length * 2;
    if (tool.name === "candidatesBySource" && /coming from|by source/.test(t)) {
      score += 6;
    }
    if (tool.name === "candidatesInStage" && /\bcandidates?\b/.test(t)) {
      score += 4;
    }
    if (tool.name === "applicationCountByStage" && /pipeline|by stage/.test(t)) {
      score += 4;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tool;
    }
  }
  return best;
}

/** Best-effort params for tools that need required inputs in offline mode. */
function inferToolInput(toolName: string, userText: string): Record<string, unknown> {
  const t = userText.toLowerCase();
  if (toolName === "candidatesInStage") {
    const stage = STAGES.find((s) => t.includes(s));
    if (stage) return { stage };
  }
  return {};
}

function textParts(id: string, text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

function toolCall(
  toolName: string,
  input: Record<string, unknown>,
): LanguageModelV3StreamPart {
  return {
    type: "tool-call",
    toolCallId: `call-${toolName}`,
    toolName,
    input: JSON.stringify(input),
  };
}

function buildParts(
  options: LanguageModelV3CallOptions,
): LanguageModelV3StreamPart[] {
  const prompt = options.prompt;
  const parts: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
  ];

  const tools = functionTools(options);
  const calls = countToolResults(prompt);

  if (calls === 0 && tools.length > 0) {
    // Step 1: call the most relevant tool.
    const userText = lastUserText(prompt);
    const chosen = pickTool(tools, userText);
    parts.push(
      ...textParts("t1", "Let me pull that from this workspace's data."),
    );
    parts.push(toolCall(chosen.name, inferToolInput(chosen.name, userText)));
    parts.push(finished("tool-calls"));
    return parts;
  }

  // A tool has run (or none are registered) → answer and stop.
  const blurb =
    tools.length === 0
      ? "No tools are wired up yet, so I can't query the data."
      : "Here's what I found — see the result above. Want me to look at it another way?";
  parts.push(...textParts("t2", blurb));
  parts.push(finished("stop"));
  return parts;
}

export function createMockModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "ats-copilot-mock",
    supportedUrls: {},
    async doGenerate(options: LanguageModelV3CallOptions) {
      // Non-streaming path: collapse the stream plan into a single result.
      const parts = buildParts(options);
      const content: LanguageModelV3Content[] = [];
      for (const p of parts) {
        if (p.type === "text-delta") {
          content.push({ type: "text", text: p.delta });
        } else if (p.type === "tool-call") {
          content.push({
            type: "tool-call",
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            input: p.input,
          });
        }
      }
      const hasToolCall = content.some((c) => c.type === "tool-call");
      return {
        content,
        finishReason: {
          unified: hasToolCall ? ("tool-calls" as const) : ("stop" as const),
          raw: hasToolCall ? "tool-calls" : "stop",
        },
        usage,
        warnings: [],
      };
    },
    async doStream(options: LanguageModelV3CallOptions) {
      return {
        stream: simulateReadableStream({
          chunks: buildParts(options),
          // No artificial delay — keeps the eval/test fast and deterministic.
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  };
}
