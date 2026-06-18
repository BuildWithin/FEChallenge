"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES, isPiiRestrictedRole, type Role } from "@/db/permissions";
import { ChatMessage } from "./components/chat-message";
import { StarterPrompts } from "./components/starter-prompts";
import { WorkspaceSidebar } from "./components/workspace-sidebar";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";

const ROLE_STYLES: Record<
  Role,
  { badge: string; label: string; description: string }
> = {
  admin: {
    badge: "bg-blue-50 text-blue-800 ring-blue-200",
    label: "Admin",
    description: "Full access including candidate PII",
  },
  recruiter: {
    badge: "bg-violet-50 text-violet-800 ring-violet-200",
    label: "Recruiter",
    description: "Full access including candidate PII",
  },
  analyst: {
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    label: "Analyst",
    description: "PII restricted — names, emails, and phones are hidden",
  },
};

export default function Page() {
  const { activeWorkspace, setActiveWorkspace, role, setRole } = useTenant();
  const trpc = useTRPC();
  const roleMeta = ROLE_STYLES[role];

  const workspaces = useQuery(trpc.workspaces.list.queryOptions());
  const agentMeta = useQuery(trpc.meta.agent.queryOptions());

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

  const workspaceName =
    workspaces.data?.find((w) => w.slug === activeWorkspace)?.name ??
    activeWorkspace;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-3 sm:p-4 lg:min-h-0 lg:h-screen lg:max-h-screen lg:grid lg:grid-cols-[1fr_minmax(260px,320px)] lg:grid-rows-1">
      <section className="flex min-h-[60vh] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:min-h-0">
        <header className="shrink-0 border-b border-gray-200 px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
                  ATS Analytics Copilot
                </h1>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${roleMeta.badge}`}
                  title={roleMeta.description}
                >
                  {roleMeta.label}
                </span>
                {agentMeta.data && (
                  <span
                    className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      agentMeta.data.isMock
                        ? "bg-gray-100 text-gray-500"
                        : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    }`}
                  >
                    {agentMeta.data.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{workspaceName}</span>
                {" · "}
                {roleMeta.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                <span className="shrink-0 text-xs text-gray-500">Workspace</span>
                <select
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs sm:flex-none sm:text-sm"
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
              <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                <span className="shrink-0 text-xs text-gray-500">Role</span>
                <select
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs sm:flex-none sm:text-sm"
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as (typeof ROLES)[number])
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_STYLES[r].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {isPiiRestrictedRole(role) && (
            <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-800">
              Analyst mode: candidate names, emails, and phone numbers never
              appear in tool results or exports.
            </p>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
          {messages.length === 0 ? (
            <StarterPrompts disabled={busy} onSelect={ask} />
          ) : (
            messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))
          )}

          {busy && (
            <div className="flex items-center gap-2 px-1 text-xs text-gray-400">
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

        <div className="shrink-0 border-t border-gray-200 px-3 py-3 sm:px-4">
          {messages.length > 0 && (
            <div className="mb-2">
              <StarterPrompts compact disabled={busy} onSelect={ask} />
            </div>
          )}
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
              placeholder="Ask about pipeline, funnel, sources, velocity…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </section>

      <WorkspaceSidebar />
    </main>
  );
}
