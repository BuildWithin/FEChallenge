"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { ROLES } from "@/db/permissions";
import type { Display, Row } from "@/agent/artifact";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";
import { BarChart } from "./components/BarChart";
import { DataTable } from "./components/DataTable";
import { LineChart } from "./components/LineChart";

export default function Page() {
  const { activeWorkspace, setActiveWorkspace, role, setRole } = useTenant();
  const trpc = useTRPC();

  const workspaces = useQuery(trpc.workspaces.list.queryOptions());
  const pipeline = useQuery(trpc.analytics.applicationsByStage.queryOptions({}));

  // A fresh transport per active workspace/role so the `x-workspace` + `x-role`
  // headers follow the switchers. Keying useChat on them also resets the
  // conversation when you switch tenant or role.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => ({
          "x-workspace": getActiveWorkspace(),
          "x-role": getActiveRole(),
        }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspace, role],
  );

  const { messages, sendMessage, status } = useChat({
    id: `${activeWorkspace}:${role}`,
    transport,
    onError: (err) => console.error("[chat] stream error:", err),
  });

  const [input, setInput] = useState("");
  const busy = status === "streaming" || status === "submitted";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <main className="mx-auto grid h-screen max-w-6xl grid-cols-[1fr_320px] gap-4 p-4">
      {/* Conversation column */}
      <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">ATS Analytics Copilot</h1>
            <p className="text-xs text-gray-500">
              Chat with this workspace&rsquo;s recruiting data.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">Workspace</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={activeWorkspace}
                onChange={(e) => setActiveWorkspace(e.target.value)}
              >
                {workspaces.data?.map((w) => (
                  <option key={w.id} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">Role</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400">
              Ask about this workspace &mdash; e.g. &ldquo;How does my pipeline
              look by stage?&rdquo; or &ldquo;Where are candidates coming
              from?&rdquo;
            </p>
          )}

          {messages.map((message, msgIdx) => {
            const isLastMessage = msgIdx === messages.length - 1;
            return (
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
                    return (
                      <ToolCall
                        key={i}
                        part={part}
                        streaming={isLastMessage && busy}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            );
          })}

          {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-gray-200 px-4 py-3"
        >
          <input
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Ask the analytics copilot…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </section>

      {/* Side panel: a reference scoped read via tRPC (pipeline by stage). */}
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Pipeline (this workspace)</h2>
          {pipeline.data && pipeline.data.length > 0 ? (
            <ul className="space-y-1">
              {pipeline.data.map((row) => (
                <li key={row.stage} className="flex justify-between text-xs">
                  <span className="font-medium">{row.stage}</span>
                  <span className="text-gray-400">{Number(row.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">No data.</p>
          )}
        </div>
      </aside>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tool-call rendering.
//
// TODO(candidate): this is a deliberately bare stub. Each tool returns
// `{ rows, display }` where `display.kind` is "table" | "bar" | "line". Turn
// these into real, streaming generative UI — render bar/line charts, show the
// "calling…" → "result" transition nicely, handle empty/error states. Make it
// something you'd ship.
// ---------------------------------------------------------------------------
type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: { rows?: Row[]; display?: Display };
  errorText?: string;
};

function isToolPart(part: unknown): part is ToolPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof (part as Record<string, unknown>).type === "string"
  );
}

function ToolCall({ part, streaming }: { part: unknown; streaming: boolean }) {
  if (!isToolPart(part)) return null;
  const name = part.type.replace(/^tool-/, "");
  const done = part.state === "output-available";
  const errored = part.state === "output-error";
  const calling = !done && !errored;

  return (
    <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-gray-600">
        {name}{" "}
        {calling && (
          <span className="flex items-center gap-1 font-normal text-gray-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
            calling&hellip;
          </span>
        )}
        {done && <span className="font-normal text-gray-400">&middot; result</span>}
        {errored && <span className="font-normal text-red-400">&middot; error</span>}
      </div>
      {errored && <p className="mt-1 text-red-500">{part.errorText}</p>}
      {done && !streaming && <ToolResult output={part.output} />}
      {done && streaming && <p className="mt-1 text-gray-400">Loading chart…</p>}
    </div>
  );
}

// memo prevents BarChart (and Recharts internals) from re-rendering on every
// streaming text delta — completed tool results never change, but parent
// re-renders on each token, which was causing Recharts Redux dispatch → throw
// → useChat error → stream cut mid-sentence.
// Custom comparator: AI SDK may reconstruct the output wrapper object on each
// tick even though the underlying rows array and display config are unchanged.
// Compare rows by reference (SDK preserves the array) and display by value.
function toolResultEqual(
  prev: { output?: { rows?: Row[]; display?: Display } },
  next: { output?: { rows?: Row[]; display?: Display } },
) {
  if (prev.output === next.output) return true;
  if (!prev.output || !next.output) return false;
  // Prefer reference equality on rows (AI SDK preserves array refs for completed
  // tool results). Fall back to value comparison in case the SDK ever reconstructs
  // the wrapper object, which would defeat memoization.
  return (
    (prev.output.rows === next.output.rows ||
      JSON.stringify(prev.output.rows) === JSON.stringify(next.output.rows)) &&
    JSON.stringify(prev.output.display) === JSON.stringify(next.output.display)
  );
}

const ToolResult = memo(function ToolResult({
  output,
}: {
  output?: { rows?: Row[]; display?: Display };
}) {
  const rows = output?.rows ?? [];
  const display = output?.display;

  if (!display || rows.length === 0) {
    return <p className="mt-1 text-gray-400">No data.</p>;
  }

  switch (display.kind) {
    case "bar":
      return (
        <div className="mt-2">
          <BarChart
            data={rows}
            xKey={display.x}
            yKey={display.y}
            title={display.title}
          />
        </div>
      );
    case "line":
      return (
        <div className="mt-2">
          <LineChart
            data={rows}
            xKey={display.x}
            yKey={display.y}
            title={display.title}
          />
        </div>
      );
    case "table":
      return <DataTable data={rows} columns={display.columns} />;
    default:
      return (
        <pre className="mt-1 overflow-x-auto text-xs text-gray-400">
          {JSON.stringify(output, null, 2)}
        </pre>
      );
  }
}, toolResultEqual);
