"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES } from "@/db/permissions";
import type { Display, Row, ToolResult } from "@/agent/artifact";
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
                  return <ToolCall key={i} part={part} />;
                }
                return null;
              })}
            </div>
          ))}

          {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}

          {/* Stream/model error (e.g. an intermittent gateway failure). The model
              may end a turn with no text; show a calm, non-technical retry note
              instead of leaving the user staring at nothing. */}
          {error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Something went wrong on our side. Please try again.
            </p>
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
// ---------------------------------------------------------------------------
type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: ToolResult;
};

function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;

  // Recoverable SDK validation error — the model retries silently. Render nothing
  // so a recovered attempt doesn't leave a card behind.
  if (p.state === "output-error") return null;

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

// ---------------------------------------------------------------------------
// ToolResultView — switches on display.kind; owns the empty-state guard.
// ---------------------------------------------------------------------------
function ToolResultView({ output }: { output: { rows: Row[]; display: Display } }) {
  const { rows, display } = output;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-gray-400">No data for this view.</p>
    );
  }

  if (display.kind === "bar") return <BarChart rows={rows} display={display} />;
  if (display.kind === "line") return <LineChart rows={rows} display={display} />;
  return <DataTable rows={rows} columns={display.columns} />;
}

// ---------------------------------------------------------------------------
// SVG chart layout constants (shared by bar + line)
// ---------------------------------------------------------------------------
const VW = 540;
const MT = 28;
const MR = 20;
const MB = 62;
const ML = 48;
const CW = VW - ML - MR; // 472
const CH = 196;
const VH = MT + CH + MB; // 286

// ---------------------------------------------------------------------------
// BarChart — hand-rolled SVG vertical bars
// ---------------------------------------------------------------------------
function BarChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "bar" }>;
}) {
  const values = rows.map((r) => Number(r[display.y]) || 0);
  const max = Math.max(...values, 1);
  const n = rows.length;
  const slotW = CW / n;
  const bW = Math.max(slotW * 0.55, 4);
  const bOffset = (slotW - bW) / 2;
  const rotateLabels = n > 7;

  return (
    <div className="px-4 pt-4 pb-2">
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" aria-label={display.title}>
        {/* Title */}
        <text
          x={VW / 2}
          y={MT - 10}
          textAnchor="middle"
          style={{ fontSize: 13, fontWeight: 600, fill: "#374151" }}
        >
          {display.title}
        </text>

        {/* Baseline */}
        <line
          x1={ML}
          y1={MT + CH}
          x2={ML + CW}
          y2={MT + CH}
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        {/* Bars + labels */}
        {rows.map((row, i) => {
          const val = values[i];
          const bH = Math.max((val / max) * CH, val > 0 ? 2 : 0);
          const bX = ML + i * slotW + bOffset;
          const bY = MT + CH - bH;
          const labelX = ML + (i + 0.5) * slotW;
          const labelY = MT + CH + 14;

          return (
            <g key={i}>
              <rect
                x={bX}
                y={bY}
                width={bW}
                height={bH}
                rx={2}
                fill="#6366f1"
                className="bar-grow"
              />
              {/* value above bar */}
              <text
                x={bX + bW / 2}
                y={bY - 4}
                textAnchor="middle"
                style={{ fontSize: 10, fill: "#6b7280" }}
              >
                {val.toLocaleString()}
              </text>
              {/* category label */}
              {rotateLabels ? (
                <text
                  x={labelX}
                  y={labelY}
                  transform={`rotate(-40,${labelX},${labelY})`}
                  textAnchor="end"
                  style={{ fontSize: 10, fill: "#9ca3af" }}
                >
                  {String(row[display.x] ?? "")}
                </text>
              ) : (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  style={{ fontSize: 11, fill: "#9ca3af" }}
                >
                  {String(row[display.x] ?? "")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LineChart — hand-rolled SVG polyline
// ---------------------------------------------------------------------------
function LineChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "line" }>;
}) {
  const values = rows.map((r) => Number(r[display.y]) || 0);
  const max = Math.max(...values, 1);
  const n = rows.length;

  const pts = rows.map((_, i) => ({
    x: ML + (n > 1 ? (i / (n - 1)) * CW : CW / 2),
    y: MT + CH - (values[i] / max) * CH,
  }));

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const midVal = Math.round(max / 2);
  const rotateLabels = n > 8;

  return (
    <div className="px-4 pt-4 pb-2">
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" aria-label={display.title}>
        {/* Title */}
        <text
          x={VW / 2}
          y={MT - 10}
          textAnchor="middle"
          style={{ fontSize: 13, fontWeight: 600, fill: "#374151" }}
        >
          {display.title}
        </text>

        {/* Y reference lines */}
        {([max, midVal, 0] as const).map((refVal, i) => {
          const ry = MT + CH - (refVal / max) * CH;
          return (
            <g key={i}>
              <line
                x1={ML}
                y1={ry}
                x2={ML + CW}
                y2={ry}
                stroke="#f3f4f6"
                strokeWidth={1}
              />
              <text
                x={ML - 6}
                y={ry + 4}
                textAnchor="end"
                style={{ fontSize: 10, fill: "#9ca3af" }}
              >
                {refVal.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line
          x1={ML}
          y1={MT + CH}
          x2={ML + CW}
          y2={MT + CH}
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#6366f1"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          className="line-draw"
        />

        {/* Dots */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#6366f1" />
        ))}

        {/* X labels */}
        {rows.map((row, i) => {
          const lx = pts[i].x;
          const ly = MT + CH + 14;
          return rotateLabels ? (
            <text
              key={i}
              x={lx}
              y={ly}
              transform={`rotate(-40,${lx},${ly})`}
              textAnchor="end"
              style={{ fontSize: 10, fill: "#9ca3af" }}
            >
              {String(row[display.x] ?? "")}
            </text>
          ) : (
            <text
              key={i}
              x={lx}
              y={ly}
              textAnchor="middle"
              style={{ fontSize: 10, fill: "#9ca3af" }}
            >
              {String(row[display.x] ?? "")}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable — renders display.columns as headers, rows as cells
// ---------------------------------------------------------------------------
function DataTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  return (
    <div className="overflow-x-auto px-4 pb-4 pt-3">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="border-b border-gray-200 py-2 pr-4 text-xs font-medium uppercase tracking-wide text-gray-500"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0">
              {columns.map((c) => (
                <td key={c} className="py-2 pr-4 text-gray-700">
                  {String(row[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
