"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { ROLES } from "@/db/permissions";
import type { Display, Row } from "@/agent/artifact";
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

          {messages.map((message) => {
            const parts = messageParts(message.parts);
            const tableOnlyResponse =
              message.role === "assistant" && messageShowsDataTable(parts);
            const analystCandidateList =
              message.role === "assistant" && messageIsAnalystCandidateList(parts);
            const chartOnlyAnalyst =
              message.role === "assistant" &&
              role === "analyst" &&
              messageShowsChart(parts);

            return (
            <div key={message.id} className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {message.role}
              </div>
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  if (tableOnlyResponse || analystCandidateList || chartOnlyAnalyst) {
                    return null;
                  }
                  return (
                    <AssistantMessage key={i} text={part.text} role={message.role} />
                  );
                }
                if (part.type === "tool-listCandidates" && analystCandidateList) {
                  return <AnalystCandidateAccessNotice key={i} />;
                }
                if (part.type.startsWith("tool-")) {
                  return <ToolCall key={i} part={part} />;
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
// Tool-call rendering — display-driven charts/tables with loading/empty/error.
// ---------------------------------------------------------------------------
const INTERNAL_COLUMNS = new Set(["id", "workspaceId"]);

type MessagePartLike = {
  type: string;
  state?: string;
  output?: { rows?: Row[]; display?: Display };
};

function messageParts(parts: ReadonlyArray<{ type: string; state?: string; output?: unknown }>): MessagePartLike[] {
  return parts as MessagePartLike[];
}

/** Any visible table (candidates, open jobs, etc.) — prose would duplicate it. */
function messageShowsDataTable(parts: ReadonlyArray<MessagePartLike>): boolean {
  return parts.some((part) => {
    if (!part.type.startsWith("tool-")) return false;
    return (
      part.state === "output-available" &&
      part.output?.display?.kind === "table" &&
      (part.output.display.columns?.length ?? 0) > 0 &&
      (part.output?.rows?.length ?? 0) > 0
    );
  });
}

/** Analyst aggregate answers use bar/line charts — prose would duplicate them. */
function messageShowsChart(parts: ReadonlyArray<MessagePartLike>): boolean {
  return parts.some((part) => {
    if (!part.type.startsWith("tool-")) return false;
    const kind = part.output?.display?.kind;
    return (
      part.state === "output-available" &&
      (kind === "bar" || kind === "line") &&
      (part.output?.rows?.length ?? 0) > 0
    );
  });
}

/** Analyst listCandidates has no visible table — show a permission notice instead. */
function messageIsAnalystCandidateList(parts: ReadonlyArray<MessagePartLike>): boolean {
  return parts.some((part) => {
    if (part.type !== "tool-listCandidates") return false;
    return (
      part.state === "output-available" &&
      part.output?.display?.kind === "table" &&
      (part.output.display.columns?.length ?? 0) === 0 &&
      (part.output?.rows?.length ?? 0) > 0
    );
  });
}

function AnalystCandidateAccessNotice() {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-800">
      <p>
        Your role (<strong>analyst</strong>) doesn&apos;t include access to individual
        candidates or contact details.
      </p>
      <p className="mt-2 text-gray-600">
        Try aggregate questions instead, such as &ldquo;Where are candidates coming
        from?&rdquo; or &ldquo;How does my pipeline look by stage?&rdquo;
      </p>
    </div>
  );
}

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: { rows?: Row[]; display?: Display };
  errorText?: string;
};

function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;
  const done = p.state === "output-available";
  const errored = p.state === "output-error";
  const pending = !done && !errored;

  const proseOnlyResult =
    done &&
    p.output?.display?.kind === "table" &&
    p.output.display.columns.length === 0;

  if (proseOnlyResult) return null;

  if (errored) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
        {p.errorText ?? "Something went wrong loading this data."}
      </div>
    );
  }

  if (pending) {
    return <p className="text-xs text-gray-400">Looking up data…</p>;
  }

  return (
    <div className="rounded-md bg-gray-50 px-3 py-2 text-sm">
      <ToolResult output={p.output} />
    </div>
  );
}

function ToolResult({ output }: { output?: { rows?: Row[]; display?: Display } }) {
  const rows = output?.rows ?? [];
  const display = output?.display;

  if (display?.kind === "table" && display.columns.length === 0) {
    return null;
  }

  if (rows.length === 0) {
    return <p className="mt-1 text-gray-400">No rows.</p>;
  }

  switch (display?.kind) {
    case "bar":
      return (
        <BarChart rows={rows} x={display.x} y={display.y} title={display.title} />
      );
    case "line":
      return (
        <LineChart rows={rows} x={display.x} y={display.y} title={display.title} />
      );
    case "table":
    default: {
      const columns =
        display?.kind === "table"
          ? display.columns
          : Object.keys(rows[0] ?? {});
      return <TableView rows={rows} columns={columns} />;
    }
  }
}

function TableView({ rows, columns }: { rows: Row[]; columns: string[] }) {
  const visible = columns.filter((c) => !INTERNAL_COLUMNS.has(c));
  if (visible.length === 0) {
    return <p className="mt-1 text-gray-400">No rows.</p>;
  }

  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="text-gray-400">
          {visible.map((c) => (
            <th key={c} className="border-b border-gray-100 py-1 pr-2 font-medium">
              {formatLabel(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((row, i) => (
          <tr key={i} className="text-gray-600">
            {visible.map((c) => (
              <td key={c} className="border-b border-gray-50 py-1 pr-2">
                {formatCell(row[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BarChart({
  rows,
  x,
  y,
  title,
}: {
  rows: Row[];
  x: string;
  y: string;
  title: string;
}) {
  const data = rows.map((r) => ({
    label: formatLabel(String(r[x] ?? "")),
    value: Number(r[y] ?? 0),
  }));
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <figure>
      <figcaption className="mb-1 text-xs font-medium text-gray-600">{title}</figcaption>
      <div className="space-y-1">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-gray-500" title={d.label}>
              {d.label}
            </span>
            <div className="h-3 min-w-0 flex-1 rounded bg-gray-100">
              <div
                className="h-3 rounded bg-gray-800 transition-all"
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right tabular-nums text-gray-600">
              {formatNumber(d.value)}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function LineChart({
  rows,
  x,
  y,
  title,
}: {
  rows: Row[];
  x: string;
  y: string;
  title: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const data = rows.map((r) => ({
    label: String(r[x] ?? ""),
    value: Number(r[y] ?? 0),
  }));
  const max = Math.max(1, ...data.map((d) => d.value));

  const W = 320;
  const H = 140;
  const plotLeft = 32;
  const plotRight = 8;
  const plotTop = 20;
  const plotBottom = 28;
  const plotW = W - plotLeft - plotRight;
  const plotH = H - plotTop - plotBottom;

  const points = data.map((d, i) => {
    const px = plotLeft + (i * plotW) / Math.max(1, data.length - 1);
    const py = plotTop + plotH - (d.value / max) * plotH;
    return { ...d, px, py };
  });

  const yTicks = [0, Math.round(max / 2), max].filter(
    (v, i, arr) => i === 0 || v !== arr[i - 1],
  );

  const xLabelEvery = data.length <= 6 ? 1 : Math.ceil(data.length / 5);

  return (
    <figure>
      <figcaption className="mb-1 text-xs font-medium text-gray-600">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full text-gray-800"
        role="img"
        aria-label={`${title}: ${data.map((d) => `${formatPeriodLabel(d.label)} ${formatNumber(d.value)}`).join(", ")}`}
        onMouseLeave={() => setHovered(null)}
      >
        {yTicks.map((tick) => {
          const ty = plotTop + plotH - (tick / max) * plotH;
          return (
            <g key={tick} className="text-gray-300">
              <line
                x1={plotLeft}
                y1={ty}
                x2={W - plotRight}
                y2={ty}
                stroke="currentColor"
                strokeWidth="0.5"
              />
              <text
                x={plotLeft - 4}
                y={ty + 3}
                textAnchor="end"
                className="fill-gray-400 text-[9px]"
              >
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={points.map((p) => `${p.px},${p.py}`).join(" ")}
        />

        {points.map((p, i) => (
          <g
            key={i}
            className="cursor-pointer"
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
          >
            <title>
              {formatPeriodLabel(p.label)}: {formatNumber(p.value)}
            </title>
            <circle cx={p.px} cy={p.py} r="10" fill="transparent" />
            <circle
              cx={p.px}
              cy={p.py}
              r={hovered === i ? 4 : 3}
              fill="currentColor"
              className="transition-[r]"
            />
            {hovered === i && (
              <text
                x={p.px}
                y={p.py - 8}
                textAnchor="middle"
                className="fill-gray-700 text-[9px] font-medium pointer-events-none"
              >
                {formatNumber(p.value)}
              </text>
            )}
            {(i % xLabelEvery === 0 || i === data.length - 1) && (
              <text
                x={p.px}
                y={H - 6}
                textAnchor="middle"
                className="fill-gray-400 text-[8px] pointer-events-none"
              >
                {formatPeriodLabel(p.label)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Shorten ISO period buckets for chart axis labels. */
function formatPeriodLabel(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw.length > 8 ? `${raw.slice(0, 8)}…` : raw;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[parseInt(m[2], 10) - 1] ?? m[2];
  const day = parseInt(m[3], 10);
  return day === 1 ? mon : `${mon} ${day}`;
}

function formatLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
