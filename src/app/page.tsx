"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES } from "@/db/permissions";
import type { ToolResult } from "@/agent/artifact";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";
import {
  ArtifactError,
  ArtifactLoading,
  ToolArtifact,
} from "./tool-artifact";
import { cleanAssistantText } from "./assistant-text";

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
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-3 p-3 md:grid md:grid-cols-[minmax(0,1fr)_260px] md:gap-4 md:p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Conversation column */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        <header className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">ATS Analytics Copilot</h1>
            <p className="text-xs text-gray-500">
              Chat with this workspace&rsquo;s recruiting data.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm sm:justify-end">
            <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
              <span className="text-gray-500">Workspace</span>
              <select
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm sm:max-w-40 sm:flex-none"
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
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="text-gray-500">Role</span>
              <select
                className="min-w-0 rounded border border-gray-300 px-2 py-1 text-sm sm:max-w-28"
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

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400">
              Ask about this workspace &mdash; e.g. &ldquo;How does my pipeline
              look by stage?&rdquo; or &ldquo;Where are candidates coming
              from?&rdquo;
            </p>
          )}

          {messages.map((message) => {
            const visibleParts = message.parts
              .map((part, originalIndex) => ({ part, originalIndex }))
              .filter(
                ({ part }) =>
                  part.type === "text" || part.type.startsWith("tool-"),
              );
            const textParts = visibleParts.filter(
              ({ part }) => part.type === "text",
            );
            const firstTextIndex = textParts[0]?.originalIndex;
            const assistantText =
              message.role === "assistant"
                ? cleanAssistantText(
                    textParts
                      .map(({ part }) =>
                        part.type === "text" ? part.text : "",
                      )
                      .join("\n\n"),
                  )
                : "";
            const orderedParts =
              message.role === "assistant"
                ? [
                    ...visibleParts.filter(({ part }) => part.type === "text"),
                    ...visibleParts.filter(({ part }) =>
                      part.type.startsWith("tool-"),
                    ),
                  ]
                : visibleParts;

            return (
              <div key={message.id} className="min-w-0 space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {message.role}
                </div>
                {orderedParts.map(({ part, originalIndex }) => {
                  if (part.type === "text") {
                    if (
                      message.role === "assistant" &&
                      originalIndex !== firstTextIndex
                    ) {
                      return null;
                    }
                    const text =
                      message.role === "assistant" ? assistantText : part.text;
                    if (!text) return null;

                    return (
                      <p
                        key={originalIndex}
                        className="break-words whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-sm"
                      >
                        {text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    return <ToolCall key={originalIndex} part={part} />;
                  }
                  return null;
                })}
              </div>
            );
          })}

          {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}
        </div>

        <form
          onSubmit={submit}
          className="flex min-w-0 items-center gap-2 border-t border-gray-200 px-4 py-3"
        >
          <input
            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
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
      {/* On phones it collapses so the chat keeps full height; expand to peek. */}
      <details className="group shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          Pipeline (this workspace)
          <span className="text-xs font-normal text-gray-400 group-open:hidden">
            Show
          </span>
          <span className="hidden text-xs font-normal text-gray-400 group-open:inline">
            Hide
          </span>
        </summary>
        <div className="max-h-[40dvh] overflow-y-auto border-t border-gray-200 px-4 py-3">
          <PipelineList rows={pipeline.data} />
        </div>
      </details>

      <aside className="hidden min-h-0 min-w-0 flex-col gap-4 overflow-y-auto md:flex">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Pipeline (this workspace)</h2>
          <PipelineList rows={pipeline.data} />
        </div>
      </aside>
    </main>
  );
}

function PipelineList({
  rows,
}: {
  rows?: { stage: string; count: number }[];
}) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-gray-400">No data.</p>;
  }

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.stage} className="flex justify-between text-xs">
          <span className="font-medium">{row.stage}</span>
          <span className="text-gray-400">{Number(row.count)}</span>
        </li>
      ))}
    </ul>
  );
}

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: ToolResult | { error: string };
  errorText?: string;
};

function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;
  const name = p.type.replace(/^tool-/, "");
  const done = p.state === "output-available";
  const outputError = p.output && "error" in p.output ? p.output.error : undefined;
  const errored = p.state === "output-error" || Boolean(outputError);

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-lg border px-3 py-3 text-xs shadow-sm transition-colors ${
        errored ? "border-red-200 bg-red-50/30" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 font-medium text-gray-600">
        <span>{name}</span>
        <span
          className={`font-normal ${errored ? "text-red-500" : "text-gray-400"}`}
        >
          {errored ? "· error" : done ? "· result" : "· calling…"}
        </span>
      </div>
      {errored && <ArtifactError message={p.errorText || outputError} />}
      {!done && !errored && <ArtifactLoading />}
      {done && !errored && <ToolArtifact output={p.output as ToolResult} />}
    </div>
  );
}
