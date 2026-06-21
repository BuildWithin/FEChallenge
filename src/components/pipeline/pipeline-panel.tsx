export function PipelinePanel({
  rows,
}: {
  rows: ReadonlyArray<{ stage: string; count: number | string }>;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">Pipeline (this workspace)</h2>
      {rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((row) => (
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
  );
}
