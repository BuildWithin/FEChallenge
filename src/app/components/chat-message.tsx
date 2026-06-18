"use client";

import type { UIMessage } from "ai";

import { MarkdownContent } from "../lib/markdown";
import { ToolCall } from "./analytics-artifact";

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isUser
            ? "bg-gray-900 text-white"
            : "bg-emerald-100 text-emerald-800"
        }`}
        aria-hidden
      >
        {isUser ? "You" : "AI"}
      </div>

      <div
        className={`min-w-0 flex-1 space-y-2 ${isUser ? "text-right" : ""}`}
      >
        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {isUser ? "You" : "Copilot"}
        </div>

        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text.trim()) {
            if (isUser) {
              return (
                <p
                  key={i}
                  className="inline-block rounded-2xl rounded-tr-sm bg-gray-900 px-3 py-2 text-left text-sm text-white"
                >
                  {part.text}
                </p>
              );
            }
            return (
              <div
                key={i}
                className="rounded-2xl rounded-tl-sm border border-gray-100 bg-gray-50/90 px-3 py-2.5"
              >
                <MarkdownContent text={part.text} />
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            return <ToolCall key={i} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
