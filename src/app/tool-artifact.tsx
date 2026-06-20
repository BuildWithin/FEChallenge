"use client";

import { useId } from "react";

import type { Row, ToolResult } from "@/agent/artifact";

type BarChartProps = {
  rows: Row[];
  x: string;
  y: string;
  title: string;
};

type LineChartProps = BarChartProps;

const numberFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

function columnLabel(column: string) {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatCell(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return numberFormatter.format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
      }).format(date);
    }
  }

  return text;
}

export function ArtifactLoading() {
  return (
    <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading data">
      <span className="sr-only">Loading data</span>
      <div className="h-3 w-2/5 animate-pulse rounded bg-gray-200" />
      <div className="grid h-28 animate-pulse grid-cols-5 items-end gap-2 rounded-md bg-gray-50 px-3 py-3">
        {[35, 65, 45, 80, 55].map((height, index) => (
          <div
            key={index}
            className="rounded-sm bg-gray-200"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ArtifactError({ message }: { message?: string }) {
  return (
    <div
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-red-700"
    >
      <span aria-hidden="true" className="mt-px font-semibold">
        !
      </span>
      <p>{message || "The data could not be loaded. Please try again."}</p>
    </div>
  );
}

export function EmptyArtifact() {
  return (
    <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-4 py-6 text-center">
      <p className="font-medium text-gray-500">No data</p>
      <p className="mt-0.5 text-gray-400">Nothing matched this request.</p>
    </div>
  );
}

export function ToolArtifact({ output }: { output?: ToolResult }) {
  if (!output || output.rows.length === 0) return <EmptyArtifact />;

  const { display, rows } = output;
  if (display.kind === "bar") {
    return (
      <BarChart
        rows={rows}
        x={display.x}
        y={display.y}
        title={display.title}
      />
    );
  }

  if (display.kind === "line") {
    return (
      <LineChart
        rows={rows}
        x={display.x}
        y={display.y}
        title={display.title}
      />
    );
  }

  return <DataTable rows={rows} columns={display.columns} />;
}

export function DataTable({
  rows,
  columns,
}: {
  rows: Row[];
  columns: string[];
}) {
  if (rows.length === 0) return <EmptyArtifact />;

  const visibleColumns =
    columns.length > 0 ? columns : Object.keys(rows[0] ?? {});

  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-md border border-gray-200">
      <table className="w-full min-w-max border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column}
                scope="col"
                className="border-b border-gray-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500"
              >
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white even:bg-gray-50/50">
              {visibleColumns.map((column) => (
                <td
                  key={column}
                  className="max-w-72 border-b border-gray-100 px-3 py-2 align-top text-gray-700 last:border-r-0"
                  title={String(row[column] ?? "")}
                >
                  <span className="block truncate">{formatCell(row[column])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BarChart({ rows, x, y, title }: BarChartProps) {
  const titleId = useId();
  if (rows.length === 0) return <EmptyArtifact />;

  const values = rows.map((row) => {
    const rawValue = Number(row[y]);
    return {
      label: String(row[x] ?? "Unknown"),
      value: Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0,
    };
  });

  const width = 720;
  const left = 142;
  const right = 58;
  const top = 14;
  const bottom = 30;
  const rowHeight = 42;
  const height = top + values.length * rowHeight + bottom;
  const plotWidth = width - left - right;
  const maximum = Math.max(...values.map((item) => item.value), 0);
  const scaleMaximum = maximum || 1;
  const ticks = Array.from({ length: 5 }, (_, index) =>
    (scaleMaximum * index) / 4,
  );

  return (
    <figure className="mt-3 max-w-full overflow-hidden rounded-md border border-gray-200 bg-white p-3">
      <figcaption id={titleId} className="mb-1 text-sm font-semibold text-gray-800">
        {title}
      </figcaption>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
      >
        {ticks.map((tick, index) => {
          const tickX = left + (plotWidth * index) / 4;
          return (
            <g key={index}>
              <line
                x1={tickX}
                x2={tickX}
                y1={top}
                y2={height - bottom}
                stroke="currentColor"
                className="text-gray-100"
              />
              <text
                x={tickX}
                y={height - 8}
                textAnchor="middle"
                className="fill-gray-400 text-[11px]"
              >
                {numberFormatter.format(tick)}
              </text>
            </g>
          );
        })}

        {values.map((item, index) => {
          const rowY = top + index * rowHeight;
          const barWidth = (item.value / scaleMaximum) * plotWidth;
          const shortLabel =
            item.label.length > 20 ? `${item.label.slice(0, 19)}…` : item.label;

          return (
            <g key={`${item.label}-${index}`}>
              <title>{`${item.label}: ${numberFormatter.format(item.value)}`}</title>
              <text
                x={left - 12}
                y={rowY + 22}
                textAnchor="end"
                className="fill-gray-600 text-[12px] font-medium"
              >
                {shortLabel}
              </text>
              <rect
                x={left}
                y={rowY + 7}
                width={barWidth}
                height={24}
                rx={4}
                className="fill-gray-800"
              />
              <text
                x={Math.min(left + barWidth + 8, width - right + 8)}
                y={rowY + 23}
                className="fill-gray-600 text-[12px] font-semibold"
              >
                {numberFormatter.format(item.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function LineChart({ rows, x, y, title }: LineChartProps) {
  const titleId = useId();
  if (rows.length === 0) return <EmptyArtifact />;

  const values = rows.map((row) => {
    const rawValue = Number(row[y]);
    return {
      label: String(row[x] ?? "Unknown"),
      value: Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0,
    };
  });

  const width = 720;
  const height = 240;
  const left = 52;
  const right = 24;
  const top = 14;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(...values.map((item) => item.value), 0);
  const scaleMaximum = maximum || 1;
  const tickCount =
    Number.isInteger(scaleMaximum) && scaleMaximum <= 4
      ? scaleMaximum + 1
      : 5;
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    (scaleMaximum * index) / (tickCount - 1),
  );
  const points = values.map((item, index) => ({
    ...item,
    px:
      values.length === 1
        ? left + plotWidth / 2
        : left + (plotWidth * index) / (values.length - 1),
    py: top + plotHeight - (item.value / scaleMaximum) * plotHeight,
  }));
  const labelEvery = Math.max(1, Math.ceil((values.length - 1) / 5));
  const lastPointIndex = points.length - 1;

  return (
    <figure className="mt-3 max-w-full overflow-hidden rounded-md border border-gray-200 bg-white p-3">
      <figcaption id={titleId} className="mb-1 text-sm font-semibold text-gray-800">
        {title}
      </figcaption>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
      >
        {ticks.map((tick, index) => {
          const tickY =
            top + plotHeight - (plotHeight * index) / (tickCount - 1);
          return (
            <g key={index}>
              <line
                x1={left}
                x2={width - right}
                y1={tickY}
                y2={tickY}
                stroke="currentColor"
                className="text-gray-100"
              />
              <text
                x={left - 10}
                y={tickY + 4}
                textAnchor="end"
                className="fill-gray-400 text-[11px]"
              >
                {numberFormatter.format(tick)}
              </text>
            </g>
          );
        })}

        {points.length > 1 && (
          <polyline
            points={points.map((point) => `${point.px},${point.py}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-gray-800"
          />
        )}

        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <title>{`${point.label}: ${numberFormatter.format(point.value)}`}</title>
            <circle
              cx={point.px}
              cy={point.py}
              r={3.5}
              className="fill-white stroke-gray-800"
              strokeWidth={3}
            />
            {(index === 0 ||
              index === lastPointIndex ||
              (index % labelEvery === 0 &&
                index <= lastPointIndex - labelEvery)) && (
              <text
                x={point.px}
                y={height - 10}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === lastPointIndex
                      ? "end"
                      : "middle"
                }
                className="fill-gray-500 text-[11px]"
              >
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
