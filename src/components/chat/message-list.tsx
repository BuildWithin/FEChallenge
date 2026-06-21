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
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 w-full max-w-[95%] mx-auto">
      {messages.length === 0 && (
        <p className="text-[0.9375rem] leading-relaxed text-foreground-faint">
          Ask about this workspace &mdash; e.g. &ldquo;How does my pipeline
          look by stage?&rdquo; or &ldquo;Where are candidates coming
          from?&rdquo;
        </p>
      )}

      {messages.map((message) => {
        const isUser = message.role === "user";
        return (
          <div key={message.id} className="space-y-2">
            {!isUser && (
              <div className="text-xs font-medium uppercase tracking-wide text-accent-text">
                {message.role}
              </div>
            )}
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div key={i} className={isUser ? "flex justify-end" : ""}>
                    <p
                      className={
                        isUser
                          ? "max-w-[80%] whitespace-pre-wrap rounded-2xl bg-user-bubble px-4 py-2 text-[0.9375rem] leading-relaxed text-user-bubble-fg"
                          : "whitespace-pre-wrap px-3 py-2 text-[0.9375rem] leading-relaxed"
                      }
                    >
                      {part.text}
                    </p>
                  </div>
                );
              }
              if (part.type.startsWith("tool-")) {
                return <ToolCall key={i} part={part} />;
              }
              return null;
            })}
          </div>
        );
      })}

      {busy && <p className="text-xs text-foreground-faint">Copilot is working&hellip;</p>}

      {/* Stream/model error (e.g. an intermittent gateway failure). The model
          may end a turn with no text; show a calm, non-technical retry note
          instead of leaving the user staring at nothing. */}
      {error && (
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
          Something went wrong on our side. Please try again.
        </p>
      )}
    </div>
  );
}
