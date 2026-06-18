import { stepCountIs, type StopCondition } from "ai";

/** Safety cap — enough for listJobs → drill-down → summary. */
export const MAX_AGENT_STEPS = 8;

type ToolOutput = { rows?: unknown[] };
type ToolResultLike = { type: string; output?: unknown };

function isToolError(tr: ToolResultLike): boolean {
  return tr.type === "tool-error";
}

function stepHasSuccessfulData(step: { toolResults: ToolResultLike[] }): boolean {
  return step.toolResults.some((tr) => {
    if (isToolError(tr)) return false;
    const out = tr.output as ToolOutput | undefined;
    return Array.isArray(out?.rows) && out.rows.length > 0;
  });
}

/**
 * Stop once the model produces a final text turn after grounded tool data,
 * instead of running until the step cap.
 */
export const stopWhenAnswerReady: StopCondition<any> = ({ steps }) => {
  if (steps.length === 0) return false;

  const last = steps[steps.length - 1];
  if (last.toolCalls.length > 0) return false;
  if (!last.text.trim()) return false;

  if (steps.some(stepHasSuccessfulData)) return true;

  const hadToolError = steps.some((step) =>
    step.toolResults.some((tr) => isToolError(tr as ToolResultLike)),
  );
  return hadToolError && last.text.trim().length > 0;
};

export const agentStopConditions: StopCondition<any>[] = [
  stopWhenAnswerReady,
  stepCountIs(MAX_AGENT_STEPS),
];
