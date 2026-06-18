import { describe, expect, test } from "vitest";

import { parseMarkdownBlocks } from "../markdown";

describe("parseMarkdownBlocks", () => {
  test("parses paragraphs and bullet lists", () => {
    const blocks = parseMarkdownBlocks(
      "Summary line.\n\n- First item\n- **Bold** metric\n\nClosing.",
    );
    expect(blocks).toEqual([
      { type: "paragraph", lines: ["Summary line."] },
      { type: "ul", items: ["First item", "**Bold** metric"] },
      { type: "paragraph", lines: ["Closing."] },
    ]);
  });

  test("parses numbered lists", () => {
    const blocks = parseMarkdownBlocks("1. Step one\n2. Step two");
    expect(blocks).toEqual([
      { type: "ol", items: ["Step one", "Step two"] },
    ]);
  });
});
