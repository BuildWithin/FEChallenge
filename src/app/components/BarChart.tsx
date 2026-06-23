"use client";

import { useEffect, useRef, useState } from "react";
import { Bar, BarChart as RechartsBarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";

import { formatLabel } from "./format";

const BAR_COLOR = "#6366f1"; // indigo-500

const STAGE_ORDER = ["applied", "screen", "interview", "offer", "hired", "rejected"];

interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  title?: string;
}

export function BarChart({ data, xKey, yKey, title }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Measure container width once on mount and use explicit pixel dimensions on
  // RechartsBarChart — eliminates ResponsiveContainer and its internal ResizeObserver,
  // which was dispatching Recharts Redux actions that JSON.stringify'd into a
  // Next.js Proxy during streaming and threw, killing the useChat stream.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    if (w > 0) {
      setWidth(w);
      return;
    }
    // Container hidden at mount (e.g. inside an invisible tab) — watch until visible.
    const observer = new ResizeObserver(() => {
      const w2 = el.offsetWidth;
      if (w2 > 0) {
        setWidth(w2);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (data.length === 0) {
    return <p className="py-4 text-center text-xs text-slate-400">No data.</p>;
  }

  const coerced = data.map((row) => ({
    ...row,
    [yKey]: typeof row[yKey] === "number" ? row[yKey] : Number(row[yKey] ?? 0),
  }));

  const chartData =
    xKey === "stage"
      ? [...coerced].sort((a, b) => {
          const ai = STAGE_ORDER.indexOf(String(a[xKey]));
          const bi = STAGE_ORDER.indexOf(String(b[xKey]));
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
      : coerced;

  const height = Math.max(120, chartData.length * 36);

  return (
    <div ref={containerRef} className="w-full min-w-0">
      {title && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
      )}
      {width > 0 && (
        <RechartsBarChart
          width={width}
          height={height}
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
        >
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey={xKey}
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            width={120}
            tickFormatter={(v: unknown) => {
              const label = formatLabel(String(v));
              return label.length > 18 ? label.slice(0, 17) + "…" : label;
            }}
          />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value) => [`${value}`, formatLabel(yKey)]}
            labelFormatter={(label: unknown) => formatLabel(String(label))}
            contentStyle={{
              fontSize: 12,
              borderColor: "#e2e8f0",
              borderRadius: 6,
              background: "#fff",
              boxShadow: "0 1px 3px rgba(0,0,0,.1)",
            }}
          />
          <Bar dataKey={yKey} radius={[0, 4, 4, 0]} maxBarSize={28}>
            {chartData.map((_entry, idx) => (
              <Cell key={idx} fill={BAR_COLOR} fillOpacity={0.85} />
            ))}
          </Bar>
        </RechartsBarChart>
      )}
    </div>
  );
}
