"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { ROLES } from "@/db/permissions";
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
                    <AssistantMessage key={i} text={part.text} role={message.role} />
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

/** Render assistant/user text with light markdown (lists, bold). */
function AssistantMessage({ text, role }: { text: string; role: string }) {
  const blocks = parseMessageBlocks(text);

  return (
    <div
      className={`space-y-2 rounded-md px-3 py-2 text-sm leading-relaxed ${
        role === "user" ? "bg-gray-100 text-gray-900" : "bg-gray-50 text-gray-800"
      }`}
    >
      {blocks}
    </div>
  );
}

/** Inline **bold** only — no full markdown parser. */
function formatInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={key++}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function stripListMarker(line: string): string {
  return line.replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, "");
}

/** Model sometimes emits "- a - b - c" on one line; split into separate items. */
function expandInlineBullets(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ") || !/\s+-\s+/.test(trimmed)) {
    return [trimmed];
  }
  return trimmed.split(/\s+-\s+/).map((part, i) => (i === 0 ? part.trim() : `- ${part.trim()}`));
}

function parseMessageBlocks(text: string): ReactNode[] {
  const lines = text.split(/\n/);
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    const expanded = expandInlineBullets(line);
    const first = expanded[0];

    if (/^\d+\.\s/.test(first)) {
      const items: string[] = [];
      for (const item of expanded) {
        items.push(stripListMarker(item));
      }
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) break;
        if (/^\d+\.\s/.test(next)) {
          for (const item of expandInlineBullets(next)) {
            if (/^\d+\.\s/.test(item)) items.push(stripListMarker(item));
          }
          i++;
        } else break;
      }
      elements.push(
        <ol key={key++} className="list-decimal space-y-1.5 pl-5">
          {items.map((item, j) => (
            <li key={j}>{formatInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^[-*]\s/.test(first)) {
      const items: string[] = [];
      for (const item of expanded) {
        items.push(stripListMarker(item));
      }
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) break;
        if (/^[-*]\s/.test(next) || expandInlineBullets(next).some((p) => /^[-*]\s/.test(p))) {
          for (const item of expandInlineBullets(next)) {
            if (/^[-*]\s/.test(item)) items.push(stripListMarker(item));
          }
          i++;
        } else break;
      }
      elements.push(
        <ul key={key++} className="list-disc space-y-1.5 pl-5">
          {items.map((item, j) => (
            <li key={j}>{formatInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l) break;
      if (/^\d+\.\s/.test(l) || /^[-*]\s/.test(l)) break;
      paraLines.push(l);
      i++;
    }
    elements.push(<p key={key++}>{formatInline(paraLines.join(" "))}</p>);
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Tool-call rendering — loading/error only. Successful tool results ground the
// agent's answer but are not shown as raw DB tables; users see the assistant
// prose only. Phase 4 adds generative charts for analytics (bar/line), not row
// dumps with internal ids.
// ---------------------------------------------------------------------------
type ToolPart = {
  type: string;
  state?: string;
  errorText?: string;
};

function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;
  const errored = p.state === "output-error";
  const pending = p.state !== "output-available" && !errored;

  if (errored) {
    const name = p.type.replace(/^tool-/, "");
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
        <span className="font-medium">{name}</span> failed
        {p.errorText ? `: ${p.errorText}` : "."}
      </div>
    );
  }

  if (pending) {
    return <p className="text-xs text-gray-400">Looking up data…</p>;
  }

  return null;
}
