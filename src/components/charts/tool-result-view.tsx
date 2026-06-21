import type { Display, Row } from "@/agent/artifact";
import { BarChart } from "./bar-chart";
import { LineChart } from "./line-chart";
import { DataTable } from "./data-table";

export function ToolResultView({ output }: { output: { rows: Row[]; display: Display } }) {
  const { rows, display } = output;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-foreground-faint">No data for this view.</p>
    );
  }

  if (display.kind === "bar") return <BarChart rows={rows} display={display} />;
  if (display.kind === "line") return <LineChart rows={rows} display={display} />;
  return <DataTable rows={rows} columns={display.columns} />;
}
