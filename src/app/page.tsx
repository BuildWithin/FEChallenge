"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES } from "@/db/permissions";
import type { ToolUIPart } from "@/agent/artifact";
import { ArtifactView } from "./artifacts";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";

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
  });

  const [input, setInput] = useState("");
  const busy = status === "streaming" || status === "submitted";

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
                  return <ToolCall key={i} part={part as ToolUIPart} />;
                }
                return null;
              })}
            </div>
          ))}

          {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}
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
// Tool-call rendering: name + status chip, a shimmer while the tool runs, the
// error text on failure, and the generative `ArtifactView` (bar/line/table)
// once the result streams in. See src/app/artifacts.tsx.
// ---------------------------------------------------------------------------
type ToolStatus = "running" | "result" | "error";

function ToolCall({ part }: { part: ToolUIPart }) {
  const name = prettyToolName(part.type.replace(/^tool-/, ""));
  const status: ToolStatus =
    part.state === "output-error"
      ? "error"
      : part.state === "output-available"
        ? "result"
        : "running";

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-700">{name}</span>
        <StatusChip status={status} />
      </div>
      {status === "error" && (
        <p className="mt-1 text-red-500">{part.errorText ?? "Tool failed."}</p>
      )}
      {status === "running" && <Shimmer />}
      {status === "result" && <ArtifactView output={part.output} />}
    </div>
  );
}

function StatusChip({ status }: { status: ToolStatus }) {
  const styles: Record<ToolStatus, string> = {
    running: "bg-amber-50 text-amber-600",
    result: "bg-emerald-50 text-emerald-700",
    error: "bg-red-50 text-red-600",
  };
  const label = { running: "running", result: "result", error: "error" }[status];
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      )}
      {label}
    </span>
  );
}

function Shimmer() {
  return (
    <div className="mt-2 space-y-1.5">
      {[80, 60, 70].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-gray-100"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

function prettyToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
