"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "../providers";

function formatSource(source: string): string {
  return source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDays(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(1)} days`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}

function MiniBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <li className="space-y-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate font-medium capitalize text-gray-700">
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-gray-400">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-gray-800 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

export function WorkspaceSidebar() {
  const trpc = useTRPC();

  const pipeline = useQuery(trpc.analytics.applicationsByStage.queryOptions({}));
  const sources = useQuery(trpc.analytics.candidatesBySource.queryOptions({}));
  const openJobs = useQuery(
    trpc.analytics.listJobs.queryOptions({ status: "open" }),
  );
  const timeToHire = useQuery(trpc.analytics.timeToHire.queryOptions({}));

  const openCount = openJobs.data?.length ?? 0;
  const avgHire = timeToHire.data?.[0]?.avgDays;

  const pipelineMax = Math.max(
    ...(pipeline.data?.map((r) => Number(r.count)) ?? [1]),
    1,
  );
  const sourceMax = Math.max(
    ...(sources.data?.map((r) => Number(r.count)) ?? [1]),
    1,
  );

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto lg:max-h-[calc(100vh-2rem)]">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Open jobs" value={String(openCount)} />
        <StatCard
          label="Avg time-to-hire"
          value={formatDays(avgHire)}
          hint={
            timeToHire.data?.[0]?.hiredCount
              ? `${timeToHire.data[0].hiredCount} hires`
              : undefined
          }
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Pipeline</h2>
        <p className="mb-3 text-[11px] text-gray-400">Applications by stage</p>
        {pipeline.data && pipeline.data.length > 0 ? (
          <ul className="space-y-2">
            {pipeline.data.map((row) => (
              <MiniBar
                key={row.stage}
                label={row.stage}
                value={Number(row.count)}
                max={pipelineMax}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No pipeline data.</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Sources</h2>
        <p className="mb-3 text-[11px] text-gray-400">Applications by channel</p>
        {sources.data && sources.data.length > 0 ? (
          <ul className="space-y-2">
            {sources.data.map((row) => (
              <MiniBar
                key={row.source}
                label={formatSource(row.source)}
                value={Number(row.count)}
                max={sourceMax}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No source data.</p>
        )}
      </div>
    </aside>
  );
}
