"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatLabel } from "./format";

const LINE_COLOR = "#6366f1"; // indigo-500

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  title?: string;
}

export function LineChart({ data, xKey, yKey, title }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    if (w > 0) {
      setWidth(w);
      return;
    }
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

  return (
    <div ref={containerRef} className="w-full min-w-0">
      {title && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
      )}
      {width > 0 && (
        <RechartsLineChart
          width={width}
          height={240}
          data={coerced}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: unknown) => {
              const label = formatLabel(String(v));
              return label.length > 14 ? label.slice(0, 13) + "…" : label;
            }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
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
          <Line
            type="monotone"
            dataKey={yKey}
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={{ r: 3, fill: LINE_COLOR }}
            activeDot={{ r: 5 }}
          />
        </RechartsLineChart>
      )}
    </div>
  );
}
