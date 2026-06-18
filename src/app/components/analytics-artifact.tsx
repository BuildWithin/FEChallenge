"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Display, Row } from "@/agent/artifact";
import { downloadCsv, rowsToCsv } from "../lib/export-csv";

const PAGE_SIZE = 10;

type ToolOutput = { rows?: Row[]; display?: Display };

export type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: ToolOutput;
  errorText?: string;
};

type ToolPhase = "calling" | "result" | "error";

function toolPhase(state: string | undefined): ToolPhase {
  if (state === "output-error") return "error";
  if (state === "output-available") return "result";
  return "calling";
}

function humanizeToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

function chartData(rows: Row[], xKey: string, yKey: string) {
  return rows.map((row) => ({
    ...row,
    [xKey]: formatCell(row[xKey]),
    [yKey]: Number(row[yKey] ?? 0),
  }));
}

export function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;
  const name = p.type.replace(/^tool-/, "");
  const phase = toolPhase(p.state);

  const shell =
    phase === "error"
      ? "border-red-200 bg-red-50/50"
      : phase === "result"
        ? "border-gray-200 bg-white"
        : "border-gray-200 bg-gray-50/80";

  return (
    <div className={`rounded-lg border px-3 py-3 text-sm shadow-sm ${shell}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-gray-800">{humanizeToolName(name)}</div>
        <ToolStatus phase={phase} />
      </div>

      {phase === "calling" && (
        <p className="mt-2 text-xs text-gray-500">Querying workspace data…</p>
      )}

      {phase === "error" && (
        <p className="mt-2 text-xs text-red-600">
          {p.errorText ?? "Something went wrong running this query."}
        </p>
      )}

      {phase === "result" && <ArtifactView output={p.output} toolName={name} />}
    </div>
  );
}

function ToolStatus({ phase }: { phase: ToolPhase }) {
  if (phase === "calling") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        Running
      </span>
    );
  }
  if (phase === "error") {
    return <span className="text-xs font-medium text-red-600">Failed</span>;
  }
  return <span className="text-xs font-medium text-emerald-600">Complete</span>;
}

function ArtifactView({
  output,
  toolName,
}: {
  output?: ToolOutput;
  toolName: string;
}) {
  const rows = output?.rows ?? [];
  const display = output?.display;

  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
        No data matched this query.
      </p>
    );
  }

  if (display?.kind === "bar") {
    return (
      <ChartBlock title={display.title}>
        <BarChartView rows={rows} x={display.x} y={display.y} />
      </ChartBlock>
    );
  }

  if (display?.kind === "line") {
    return (
      <ChartBlock title={display.title}>
        <LineChartView rows={rows} x={display.x} y={display.y} />
      </ChartBlock>
    );
  }

  const columns =
    display?.kind === "table"
      ? display.columns
      : Object.keys(rows[0] ?? {});

  return (
    <DataTable
      columns={columns}
      rows={rows}
      exportName={`${toolName}-${Date.now()}.csv`}
    />
  );
}

function ChartBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <h4 className="mb-2 text-xs font-medium text-gray-500">{title}</h4>
      <div className="h-52 w-full">{children}</div>
    </div>
  );
}

function BarChartView({
  rows,
  x,
  y,
}: {
  rows: Row[];
  x: string;
  y: string;
}) {
  const data = useMemo(() => chartData(rows, x, y), [rows, x, y]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={x}
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
        />
        <Bar dataKey={y} fill="#111827" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartView({
  rows,
  x,
  y,
}: {
  rows: Row[];
  x: string;
  y: string;
}) {
  const data = useMemo(() => chartData(rows, x, y), [rows, x, y]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={x}
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
        />
        <Line
          type="monotone"
          dataKey={y}
          stroke="#111827"
          strokeWidth={2}
          dot={{ r: 3, fill: "#111827" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DataTable({
  columns,
  rows,
  exportName,
}: {
  columns: string[];
  rows: Row[];
  exportName: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  function exportCsv() {
    downloadCsv(exportName, rowsToCsv(columns, rows));
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-100">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-gray-50">
            <tr className="text-gray-500">
              {columns.map((c) => (
                <th key={c} className="px-2 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={start + i} className="border-t border-gray-50 text-gray-700">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1.5 whitespace-nowrap">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of{" "}
            {rows.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded border border-gray-200 px-2 py-0.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
