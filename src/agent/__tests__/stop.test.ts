import { describe, expect, test } from "vitest";

import { stopWhenAnswerReady } from "../stop";

describe("stopWhenAnswerReady", () => {
  test("stops after a text answer following successful tool data", () => {
    const shouldStop = stopWhenAnswerReady({
      steps: [
        {
          toolCalls: [{ toolName: "timeToHire" }],
          toolResults: [
            {
              type: "tool-result",
              toolName: "timeToHire",
              output: { rows: [{ avgDays: 5, hiredCount: 3 }] },
            },
          ],
          text: "",
        },
        {
          toolCalls: [],
          toolResults: [],
          text: "Average time-to-hire is 5 days.\n\n**Key insights**\n- ...",
        },
      ],
    } as unknown as Parameters<typeof stopWhenAnswerReady>[0]);

    expect(shouldStop).toBe(true);
  });

  test("does not stop mid tool-calling step", () => {
    const shouldStop = stopWhenAnswerReady({
      steps: [
        {
          toolCalls: [{ toolName: "listJobs" }],
          toolResults: [],
          text: "Looking up jobs…",
        },
      ],
    } as unknown as Parameters<typeof stopWhenAnswerReady>[0]);

    expect(shouldStop).toBe(false);
  });
});
