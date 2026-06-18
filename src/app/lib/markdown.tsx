import type { ReactNode } from "react";

/** Render inline markdown: **bold**, `code`, and plain text. */
export function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-gray-200/80 px-1 py-0.5 font-mono text-[0.85em] text-gray-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

/** Split prose into paragraphs and bullet/numbered lists. */
export function parseMarkdownBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push(
        list.kind === "ul"
          ? { type: "ul", items: list.items }
          : { type: "ol", items: list.items },
      );
      list = null;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    const ulMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.+)$/.exec(trimmed);

    if (ulMatch) {
      flushParagraph();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ulMatch[1]);
      continue;
    }

    if (olMatch) {
      flushParagraph();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(olMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushList();
  flushParagraph();
  return blocks;
}

export function MarkdownContent({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-2 text-sm leading-relaxed text-gray-800">
      {blocks.map((block, i) => {
        if (block.type === "paragraph") {
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <span key={j}>
                  {j > 0 ? " " : null}
                  {renderInlineMarkdown(line)}
                </span>
              ))}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
