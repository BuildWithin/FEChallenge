/** Remove model-generated inline images; charts are rendered from tool results. */
export function cleanAssistantText(text: string) {
  return text
    .replace(
      /!?\[[^\]\r\n]*\]\(\s*data\s*:\s*image\/[^\r\n)]*(?:\)|$)/gi,
      "",
    )
    // Some providers stream a malformed image without its opening `![`, or
    // split the URI onto the next line. Remove that whole orphaned construct.
    .replace(
      /(^|\n)[^\r\n]{0,200}\]\(\s*data\s*:\s*image\/[^\r\n)]*(?:\)|$)/gi,
      "$1",
    )
    // Defense in depth for a bare data URI that was not wrapped in Markdown.
    .split("\n")
    .filter((line) => !/data\s*:\s*image\//i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
