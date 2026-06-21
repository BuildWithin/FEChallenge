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
      <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs">
        <span className="font-medium text-gray-500">{name}</span>
        <span className="text-gray-400"> · calling…</span>
      </div>
    );
  }

  if (hasToolError) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
        Couldn&rsquo;t load this data.
      </div>
    );
  }

  if (hasData) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ToolResultView output={p.output as { rows: Row[]; display: Display }} />
        <div className="border-t border-gray-100 px-4 py-1.5 text-xs text-gray-400">
          {name}
        </div>
      </div>
    );
  }

  return null;
}
