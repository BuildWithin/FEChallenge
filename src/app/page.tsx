"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES, isPiiRestrictedRole } from "@/db/permissions";
import { ToolCall } from "./components/analytics-artifact";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";

const STARTER_PROMPTS = [
  "How does my pipeline look by stage?",
  "What's our average time-to-hire?",
  "Show stage conversion through the hiring funnel",
  "Which sources produce the most hires vs rejections?",
  "Where are we slowest in the pipeline?",
];

export default function Page() {
  const { activeWorkspace, setActiveWorkspace, role, setRole } = useTenant();
  const trpc = useTRPC();

  const workspaces = useQuery(trpc.workspaces.list.queryOptions());
  const agentMeta = useQuery(trpc.meta.agent.queryOptions());
  const pipeline = useQuery(trpc.analytics.applicationsByStage.queryOptions({}));

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

  const { messages, sendMessage, status, error } = useChat({
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

  function ask(prompt: string) {
    if (busy) return;
    sendMessage({ text: prompt });
  }

  return (
    <main className="mx-auto grid h-screen max-w-6xl grid-cols-[1fr_320px] gap-4 p-4">
      <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">ATS Analytics Copilot</h1>
            <p className="text-xs text-gray-500">
              Chat with this workspace&rsquo;s recruiting data.
              {agentMeta.data && (
                <span
                  className={`ml-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    agentMeta.data.isMock
                      ? "bg-gray-100 text-gray-500"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  }`}
                >
                  {agentMeta.data.label}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
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
            {isPiiRestrictedRole(role) && (
              <span
                className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200"
                title="Candidate name, email, and phone are hidden for this role"
              >
                PII hidden
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Ask about pipeline, sources, hiring velocity, or job performance.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={busy}
                    onClick={() => ask(prompt)}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 hover:border-gray-300 hover:bg-white disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`space-y-2 ${message.role === "user" ? "ml-8" : "mr-4"}`}
            >
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {message.role === "user" ? "You" : "Copilot"}
              </div>
              {message.parts.map((part, i) => {
                if (part.type === "text" && part.text.trim()) {
                  return (
                    <p
                      key={i}
                      className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                        message.role === "user"
                          ? "bg-gray-900 text-white"
                          : "bg-gray-50 text-gray-800"
                      }`}
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

          {busy && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              Copilot is working&hellip;
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <p className="font-medium">Copilot could not complete that request</p>
              <p className="mt-1 text-xs text-red-600">{error.message}</p>
            </div>
          )}
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

      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Pipeline (this workspace)</h2>
          {pipeline.data && pipeline.data.length > 0 ? (
            <ul className="space-y-2">
              {pipeline.data.map((row) => {
                const count = Number(row.count);
                const max = Math.max(
                  ...pipeline.data!.map((r) => Number(r.count)),
                  1,
                );
                const pct = Math.round((count / max) * 100);
                return (
                  <li key={row.stage} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium capitalize">{row.stage}</span>
                      <span className="text-gray-400">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-900"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">No data.</p>
          )}
        </div>
      </aside>
    </main>
  );
}
