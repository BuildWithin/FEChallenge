/**
 * Answer quality eval — verifies the agent calls the right tools and produces
 * prose that accurately addresses the user's question.
 *
 * Two scorers:
 *
 * 1. `usedCorrectTool` — deterministic. Uses `toolCallAccuracy` (flexible mode)
 *    to check the expected analytics tool was called. Works with AI_PROVIDER=mock.
 *
 * 2. `answerCorrectness` — LLM-as-judge (75% factual accuracy + 25% semantic
 *    similarity). Requires AI_PROVIDER != mock AND OPENAI_API_KEY (for embeddings).
 *    Returns 0 (skipped) when running against the mock model.
 *
 * To enable the LLM judge:
 *   AI_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm eval
 */

import { createScorer, evalite } from "evalite";
import { answerCorrectness, toolCallAccuracy } from "evalite/scorers";
import { wrapAISDKModel } from "evalite/ai-sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel, defaultSettingsMiddleware } from "ai";
import type { UIMessage } from "ai";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { getModel } from "@/agent/provider";
import { streamCopilot } from "@/agent/run";

async function ensureSeeded() {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
}

function userMessage(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

type QualityInput = {
  question: string;
  workspaceId: string;
  expectedTool: string;
  // Reference answer for the LLM judge — factually correct, prose-style.
  expectedAnswer: string;
};

type QualityOutput = {
  text: string;
  toolCalls: Array<{ toolName: string; input?: unknown }>;
};

async function runCopilotForQuality(input: QualityInput): Promise<QualityOutput> {
  const result = await streamCopilot({
    workspaceId: input.workspaceId,
    role: "admin",
    messages: [userMessage(input.question)],
    model: wrapAISDKModel(getModel()),
  });

  const [text, steps] = await Promise.all([result.text, result.steps]);

  // Omit input — scorer checks name only, and the Responses API passes empty
  // strings for optional params which would cause spurious nameOnly mismatches.
  const toolCalls = steps.flatMap((s) =>
    s.toolCalls.map((c) => ({ toolName: c.toolName })),
  );

  return { text, toolCalls };
}

// --- Scorer 1: deterministic tool selection check ----------------------------

const usedCorrectTool = createScorer<QualityInput, QualityOutput, undefined>({
  name: "usedCorrectTool",
  description:
    "The agent called the expected analytics tool (flexible order — other tool calls are allowed).",
  scorer: async ({ input, output }) => {
    const result = await toolCallAccuracy({
      actualCalls: output.toolCalls,
      expectedCalls: [{ toolName: input.expectedTool }],
      mode: "flexible",
    });
    return result.score;
  },
});

// --- Scorer 2: LLM-as-judge answer quality -----------------------------------
// Returns 0 when AI_PROVIDER=mock or OPENAI_API_KEY is missing.
// Embeddings require OpenAI regardless of which provider runs the copilot itself.

const llmJudge = createScorer<QualityInput, QualityOutput, undefined>({
  name: "answerCorrectness",
  description:
    "LLM-as-judge: factual accuracy + semantic similarity vs reference answer. Skipped (score=0) when AI_PROVIDER=mock or OPENAI_API_KEY is absent.",
  scorer: async ({ input, output }) => {
    const isMock =
      !process.env.AI_PROVIDER || process.env.AI_PROVIDER === "mock";
    const hasEmbeddingKey = Boolean(process.env.OPENAI_API_KEY);

    if (isMock || !hasEmbeddingKey) return 0;

    try {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      // evalite's answerCorrectness sends JSON schemas without additionalProperties:false.
      // OpenAI's strict mode (default for gpt-4o-mini) rejects those. Inject
      // strictJsonSchema:false via middleware so every generateObject call uses
      // json_object mode instead of the strict json_schema mode.
      const judgeModel = wrapLanguageModel({
        model: openai.chat("gpt-4o-mini"),
        middleware: defaultSettingsMiddleware({
          settings: {
            providerOptions: { openai: { strictJsonSchema: false } },
          },
        }),
      });
      const result = await answerCorrectness({
        question: input.question,
        answer: output.text,
        reference: input.expectedAnswer,
        model: judgeModel,
        embeddingModel: openai.embedding("text-embedding-3-small"),
      });
      return result.score;
    } catch (err) {
      console.error("[llmJudge] error:", err);
      return 0;
    }
  },
});

// --- Eval --------------------------------------------------------------------

evalite<QualityInput, QualityOutput>(
  "Answer quality — correct tool selection and accurate prose",
  {
    data: async () => {
      await ensureSeeded();
      return [
        {
          input: {
            question: "How does my pipeline look by stage?",
            workspaceId: "brightwave",
            expectedTool: "applicationCountByStage",
            // Brightwave seed: interview=6, rejected=6 (tied highest at 25% each);
            // applied/screen/offer/hired=3 each.
            expectedAnswer:
              "The pipeline has interview and rejected stages tied as the largest at 6 applications each, accounting for half of all volume. Applied, screen, offer, and hired each hold 3, indicating a significant drop-off at both the interview and rejection points.",
          },
        },
        {
          input: {
            question: "Where are candidates coming from?",
            workspaceId: "brightwave",
            expectedTool: "candidateSourceBreakdown",
            // Brightwave seed: referral=6 (25%), linkedin=5, job_board=5, agency=4, careers_site=4.
            expectedAnswer:
              "Referral is the top channel with 6 applications (25% of total). LinkedIn and job board each contribute 5, while agency and careers site account for 4 each. Referrals lead but no single channel dominates overwhelmingly.",
          },
        },
      ];
    },
    task: (input) => runCopilotForQuality(input),
    scorers: [usedCorrectTool, llmJudge],
  },
);
