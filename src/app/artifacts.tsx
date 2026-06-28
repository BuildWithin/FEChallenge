import type { CellValue, Display, Row, ToolResult } from "@/agent/artifact";

/**
 * Generative UI: render a tool result from its `display` hint. Dependency-free
 * (plain SVG/CSS) so charts stay light and predictable. Each tool returns
 * `{ rows, display }`; this picks the component the hint asks for and handles
 * the empty case. Loading/error states live in the caller (page.tsx).
 */
export function ArtifactView({ output }: { output?: ToolResult }) {
  if (!output) return null;
  const { rows, display } = output;

  if (rows.length === 0) {
    return <p className="mt-1 text-gray-400">No data for this workspace.</p>;
  }

  switch (display.kind) {
    case "bar":
      return <BarChart rows={rows} display={display} />;
    case "line":
      return <LineChart rows={rows} display={display} />;
    case "table":
      return <DataTable rows={rows} columns={display.columns} />;
  }
}

// --- helpers ---------------------------------------------------------------

function toNumber(value: CellValue): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function prettyColumn(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

// --- bar -------------------------------------------------------------------

function BarChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "bar" }>;
}) {
  const max = Math.max(...rows.map((r) => toNumber(r[display.y])), 1);

  return (
    <figure className="mt-2">
      <figcaption className="mb-2 text-xs font-medium text-gray-600">
        {display.title}
      </figcaption>
      <div className="space-y-1.5">
        {rows.map((row, i) => {
          const value = toNumber(row[display.y]);
          const pct = (value / max) * 100;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-right text-gray-500">
                {formatCell(row[display.x])}
              </span>
              <div className="h-4 flex-1 rounded bg-gray-100">
                <div
                  className="h-4 rounded bg-indigo-500"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                  title={`${value}`}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-gray-700">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

// --- line ------------------------------------------------------------------

function LineChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "line" }>;
}) {
  const values = rows.map((r) => toNumber(r[display.y]));
  const max = Math.max(...values, 1);
  const n = values.length;

  // viewBox is 0..100 in both axes; vector-effect keeps strokes crisp.
  const points = values.map((v, i) => {
    const x = n === 1 ? 50 : (i / (n - 1)) * 100;
    const y = 100 - (v / max) * 100;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  return (
    <figure className="mt-2">
      <figcaption className="mb-2 text-xs font-medium text-gray-600">
        {display.title}
      </figcaption>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-28 w-full text-indigo-500"
        role="img"
        aria-label={display.title}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={1.5}
            fill="currentColor"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{formatCell(rows[0][display.x])}</span>
        {n > 1 && <span>{formatCell(rows[n - 1][display.x])}</span>}
      </div>
    </figure>
  );
}

// --- table -----------------------------------------------------------------

const MAX_TABLE_ROWS = 50;

function DataTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  const cols = columns.length > 0 ? columns : Object.keys(rows[0]);
  const shown = rows.slice(0, MAX_TABLE_ROWS);

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-gray-400">
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-gray-100 py-1 pr-3 font-medium"
              >
                {prettyColumn(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="text-gray-600">
              {cols.map((c) => (
                <td key={c} className="border-b border-gray-50 py-1 pr-3">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_TABLE_ROWS && (
        <p className="mt-1 text-[10px] text-gray-400">
          Showing {MAX_TABLE_ROWS} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
