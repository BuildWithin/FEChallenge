import type { Display, Row, ToolResult } from "@/agent/artifact";
import { ToolResultView } from "@/components/charts/tool-result-view";

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: ToolResult;
};

export function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;

  // Recoverable SDK validation error — the model retries silently. Render nothing
  // so a recovered attempt doesn't leave a card behind.
  if (p.state === "output-error") {
    return null;
  }

  const name = p.type.replace(/^tool-/, "");
  const done = p.state === "output-available";
  const hasToolError = done && p.output != null && "error" in p.output;
  const hasData = done && p.output != null && "rows" in p.output;

  if (!done) {
    return (
      <div className="rounded-md border border-dashed border-line-strong px-3 py-2 text-xs">
        <span className="font-medium text-foreground-muted">{name}</span>
        <span className="text-foreground-faint"> · calling…</span>
      </div>
    );
  }

  if (hasToolError) {
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-foreground-faint">
        Couldn&rsquo;t load this data.
      </div>
    );
  }

  if (hasData) {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <ToolResultView output={p.output as { rows: Row[]; display: Display }} />
        <div className="border-t border-line-subtle px-4 py-1.5 text-xs text-foreground-faint">
          {name}
        </div>
      </div>
    );
  }

  return null;
}
