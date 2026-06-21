export function PipelinePanel({
  rows,
}: {
  rows: ReadonlyArray<{ stage: string; count: number | string }>;
}) {
  const counts = rows.map((r) => Number(r.count) || 0);
  const max = Math.max(...counts, 1);

  return (
    <div className="rounded-xl shadow-sm border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-[-0.01em]">Pipeline (this workspace)</h2>
      {rows.length > 0 ? (
        <ul className="space-y-2.5">
          {rows.map((row, i) => {
            const count = counts[i];
            const pct = (count / max) * 100;
            return (
              <li key={row.stage} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-foreground-body">{row.stage}</span>
                <span className="text-xs font-semibold tabular-nums text-accent-text">{count}</span>
                {/* Inline bar — the always-on data viz, carrying the brand color. */}
                <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-accent-subtle">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-foreground-faint">No data.</p>
      )}
    </div>
  );
}
