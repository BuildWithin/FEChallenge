import { formatLabel, formatValue } from "./format";

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
}

export function DataTable({ data, columns }: DataTableProps) {
  if (data.length === 0) {
    return <p className="mt-1 text-xs text-slate-400">No data.</p>;
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-slate-100">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-400"
              >
                {formatLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className="border-b border-slate-50 transition-colors hover:bg-slate-50"
            >
              {columns.map((col) => {
                const value = row[col];
                const isNumeric = typeof value === "number";
                const formatted = formatValue(value);
                return (
                  <td
                    key={col}
                    title={formatted}
                    className={[
                      "max-w-[200px] truncate px-3 py-2 text-slate-700",
                      isNumeric ? "text-right tabular-nums" : "text-left",
                    ].join(" ")}
                  >
                    {formatted}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
