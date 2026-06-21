import type { UIMessage } from "ai";
import { ToolCall } from "./tool-call";

export function MessageList({
  messages,
  busy,
  error,
}: {
  messages: UIMessage[];
  busy: boolean;
  error: Error | undefined;
}) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {messages.length === 0 && (
        <p className="text-sm text-gray-400">
          Ask about this workspace &mdash; e.g. &ldquo;How does my pipeline
          look by stage?&rdquo; or &ldquo;Where are candidates coming
          from?&rdquo;
        </p>
      )}

      {messages.map((message) => (
        <div key={message.id} className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {message.role}
          </div>
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <p
                  key={i}
                  className="whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-sm"
                >
                  {part.text}
                </p>
              );
            }
            if (part.type.startsWith("tool-")) {
              return <ToolCall key={i} part={part} />;
            }
            return null;
          })}
        </div>
      ))}

      {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}

      {/* Stream/model error (e.g. an intermittent gateway failure). The model
          may end a turn with no text; show a calm, non-technical retry note
          instead of leaving the user staring at nothing. */}
      {error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Something went wrong on our side. Please try again.
        </p>
      )}
    </div>
  );
}
