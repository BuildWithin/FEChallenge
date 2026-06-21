import type { Display, Row } from "@/agent/artifact";
import {
  VIEW_W, VIEW_H, MARGIN_TOP, MARGIN_LEFT, PLOT_W, PLOT_H,
  TITLE_DY, LINE_WIDTH, DOT_R, Y_LABEL_DX, Y_LABEL_DY, X_LABEL_DY,
  LINE_LABEL_ROTATE_AT, LABEL_ROTATE_DEG, BASELINE_WIDTH, CHART_COLORS, CHART_FONT,
} from "@/lib/charts";

export function LineChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "line" }>;
}) {
  const values = rows.map((r) => Number(r[display.y]) || 0);
  const max = Math.max(...values, 1);
  const n = rows.length;

  const pts = rows.map((_, i) => ({
    x: MARGIN_LEFT + (n > 1 ? (i / (n - 1)) * PLOT_W : PLOT_W / 2),
    y: MARGIN_TOP + PLOT_H - (values[i] / max) * PLOT_H,
  }));

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const midVal = Math.round(max / 2);
  const rotateLabels = n > LINE_LABEL_ROTATE_AT;

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

        {/* Y reference lines */}
        {([max, midVal, 0] as const).map((refVal, i) => {
          const ry = MARGIN_TOP + PLOT_H - (refVal / max) * PLOT_H;
          return (
            <g key={i}>
              <line
                x1={MARGIN_LEFT}
                y1={ry}
                x2={MARGIN_LEFT + PLOT_W}
                y2={ry}
                stroke={CHART_COLORS.gridFaint}
                strokeWidth={BASELINE_WIDTH}
              />
              <text
                x={MARGIN_LEFT - Y_LABEL_DX}
                y={ry + Y_LABEL_DY}
                textAnchor="end"
                style={{ fontSize: CHART_FONT.axis, fill: CHART_COLORS.mutedText }}
              >
                {refVal.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line
          x1={MARGIN_LEFT}
          y1={MARGIN_TOP + PLOT_H}
          x2={MARGIN_LEFT + PLOT_W}
          y2={MARGIN_TOP + PLOT_H}
          stroke={CHART_COLORS.baseline}
          strokeWidth={BASELINE_WIDTH}
        />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={CHART_COLORS.accent}
          strokeWidth={LINE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          className="line-draw"
        />

        {/* Dots */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={DOT_R} fill={CHART_COLORS.accent} />
        ))}

        {/* X labels */}
        {rows.map((row, i) => {
          const lx = pts[i].x;
          const ly = MARGIN_TOP + PLOT_H + X_LABEL_DY;
          return rotateLabels ? (
            <text
              key={i}
              x={lx}
              y={ly}
              transform={`rotate(${LABEL_ROTATE_DEG},${lx},${ly})`}
              textAnchor="end"
              style={{ fontSize: CHART_FONT.lineLabel, fill: CHART_COLORS.mutedText }}
            >
              {String(row[display.x] ?? "")}
            </text>
          ) : (
            <text
              key={i}
              x={lx}
              y={ly}
              textAnchor="middle"
              style={{ fontSize: CHART_FONT.lineLabel, fill: CHART_COLORS.mutedText }}
            >
              {String(row[display.x] ?? "")}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
