import type { Display, Row } from "@/agent/artifact";
import {
  VIEW_W, VIEW_H, MARGIN_TOP, MARGIN_LEFT,
  PLOT_W, PLOT_H, BAR_WIDTH_RATIO, BAR_MIN_WIDTH, BAR_MIN_HEIGHT, BAR_RADIUS,
  TITLE_DY, VALUE_LABEL_DY, X_LABEL_DY, BAR_LABEL_ROTATE_AT, LABEL_ROTATE_DEG, BASELINE_WIDTH,
  CHART_COLORS, CHART_FONT,
} from "@/lib/charts";

export function BarChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "bar" }>;
}) {
  const values = rows.map((r) => Number(r[display.y]) || 0);
  const max = Math.max(...values, 1);
  const n = rows.length;
  const slotW = PLOT_W / n;
  const bW = Math.max(slotW * BAR_WIDTH_RATIO, BAR_MIN_WIDTH);
  const bOffset = (slotW - bW) / 2;
  const rotateLabels = n > BAR_LABEL_ROTATE_AT;

  return (
    <div className="px-4 pt-4 pb-2">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" aria-label={display.title}>
        {/* Title */}
        <text
          x={VIEW_W / 2}
          y={MARGIN_TOP - TITLE_DY}
          textAnchor="middle"
          style={{ fontSize: CHART_FONT.title, fontWeight: CHART_FONT.titleWeight, fill: CHART_COLORS.titleText }}
        >
          {display.title}
        </text>

        {/* Baseline */}
        <line
          x1={MARGIN_LEFT}
          y1={MARGIN_TOP + PLOT_H}
          x2={MARGIN_LEFT + PLOT_W}
          y2={MARGIN_TOP + PLOT_H}
          stroke={CHART_COLORS.baseline}
          strokeWidth={BASELINE_WIDTH}
        />

        {/* Bars + labels */}
        {rows.map((row, i) => {
          const val = values[i];
          const bH = Math.max((val / max) * PLOT_H, val > 0 ? BAR_MIN_HEIGHT : 0);
          const bX = MARGIN_LEFT + i * slotW + bOffset;
          const bY = MARGIN_TOP + PLOT_H - bH;
          const labelX = MARGIN_LEFT + (i + 0.5) * slotW;
          const labelY = MARGIN_TOP + PLOT_H + X_LABEL_DY;

          return (
            <g key={i}>
              <rect
                x={bX}
                y={bY}
                width={bW}
                height={bH}
                rx={BAR_RADIUS}
                fill={CHART_COLORS.accent}
                className="bar-grow"
              />
              {/* value above bar */}
              <text
                x={bX + bW / 2}
                y={bY - VALUE_LABEL_DY}
                textAnchor="middle"
                style={{ fontSize: CHART_FONT.value, fill: CHART_COLORS.valueText }}
              >
                {val.toLocaleString()}
              </text>
              {/* category label */}
              {rotateLabels ? (
                <text
                  x={labelX}
                  y={labelY}
                  transform={`rotate(${LABEL_ROTATE_DEG},${labelX},${labelY})`}
                  textAnchor="end"
                  style={{ fontSize: CHART_FONT.barLabelRotated, fill: CHART_COLORS.mutedText }}
                >
                  {String(row[display.x] ?? "")}
                </text>
              ) : (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  style={{ fontSize: CHART_FONT.barLabel, fill: CHART_COLORS.mutedText }}
                >
                  {String(row[display.x] ?? "")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
