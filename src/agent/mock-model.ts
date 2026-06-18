import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

import { flattenToolInsights } from "./insights";
import type { ToolResult } from "./artifact";

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
    if (tool.name === "timeToHire" && /time.to.hire|time-to-hire/.test(t)) {
      score += 8;
    }
    if (
      tool.name === "stageConversionRates" &&
      /conversion|funnel|drop.off/.test(t)
    ) {
      score += 8;
    }
    if (
      tool.name === "sourceEffectiveness" &&
      /source|hire|rejection|channel|referral|linkedin/.test(t)
    ) {
      score += 6;
    }
    if (
      tool.name === "pipelineVelocity" &&
      /velocity|slowest|bottleneck|days per stage|dwell/.test(t)
    ) {
      score += 8;
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

function unwrapToolOutput(raw: unknown): ToolResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if ("rows" in raw && "display" in raw) return raw as ToolResult;
  const wrapped = raw as { type?: string; value?: unknown };
  if (wrapped.type === "json" && wrapped.value && typeof wrapped.value === "object") {
    return wrapped.value as ToolResult;
  }
  return undefined;
}

/** Read the most recent tool result (or error) from the prompt. */
function lastToolOutcome(prompt: LanguageModelV3Prompt): {
  toolName: string;
  output?: ToolResult;
  error?: string;
} | null {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (typeof part === "string") continue;
      if (part.type === "tool-result") {
        const output = unwrapToolOutput(part.output);
        if (output) {
          return { toolName: part.toolName, output };
        }
        if (
          part.output &&
          typeof part.output === "object" &&
          "type" in part.output &&
          part.output.type === "error-text"
        ) {
          const err = part.output as { value?: string };
          return {
            toolName: part.toolName,
            error: err.value ?? "Tool execution failed",
          };
        }
      }
    }
  }
  return null;
}

function buildFinalAnswer(prompt: LanguageModelV3Prompt): string {
  const outcome = lastToolOutcome(prompt);
  if (outcome?.error) {
    return [
      "I couldn't complete that query.",
      "",
      `**What went wrong:** ${outcome.error}`,
      "",
      "**Next steps:**",
      "- Widen filters (drop jobId or date range)",
      "- Confirm the job ID via listJobs",
      "- Try a different analytics tool if this one isn't the right fit",
    ].join("\n");
  }

  if (outcome?.output) {
    const insights =
      outcome.output.insights ??
      flattenToolInsights([
        { toolName: outcome.toolName, output: outcome.output },
      ]);
    const intro =
      (outcome.output.rows?.length ?? 0) > 0
        ? "Here's what the data shows for this workspace — the chart/table above has the full breakdown."
        : "The query ran successfully but returned no rows for these filters.";

    if (insights.length === 0) {
      return intro;
    }

    return [
      intro,
      "",
      "**Key insights**",
      ...insights.map((line) => `- ${line}`),
    ].join("\n");
  }

  return "Here's what I found — see the result above. Want me to look at it another way?";
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
      : buildFinalAnswer(prompt);
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
