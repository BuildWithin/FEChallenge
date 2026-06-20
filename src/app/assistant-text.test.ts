import { describe, expect, it } from "vitest";

import { cleanAssistantText } from "./assistant-text";

describe("cleanAssistantText", () => {
  it("removes a Markdown data image and keeps surrounding text", () => {
    expect(
      cleanAssistantText(
        "Trend summary.\n![Applications over time](data:image/svg+xml;base64,PHN2Zz4=)\nWeekly volume rose.",
      ),
    ).toBe("Trend summary.\n\nWeekly volume rose.");
  });

  it("removes malformed and line-broken data images", () => {
    expect(
      cleanAssistantText(
        "Applications over time](\n  data:image/svg+xml;base64,PHN2Zz4=)",
      ),
    ).toBe("");
  });

  it("removes a bare data URI", () => {
    expect(cleanAssistantText("data:image/png;base64,AAAA")).toBe("");
  });

  it("does not alter normal assistant text", () => {
    expect(cleanAssistantText("Applications increased this week.")).toBe(
      "Applications increased this week.",
    );
  });
});
