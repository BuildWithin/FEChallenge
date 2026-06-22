import type { Row } from "@/agent/artifact";
import { TABLE_MAX_ROWS } from "@/lib/ui";

export function DataTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  return (
    <div className="overflow-x-auto px-4 pb-4 pt-3">
      <table className="w-full border-collapse text-left text-[0.9375rem] tabular-nums">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="border-b border-line py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, TABLE_MAX_ROWS).map((row, i) => (
            <tr key={i} className="border-b border-line-faint last:border-0">
              {columns.map((c) => (
                <td key={c} className="py-2 pr-4 text-foreground-body">
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
