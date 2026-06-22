// SVG chart geometry, shared by BarChart and LineChart. Units are viewBox units.
export const VIEW_W = 540;
export const MARGIN_TOP = 28;
export const MARGIN_RIGHT = 20;
export const MARGIN_BOTTOM = 62;
export const MARGIN_LEFT = 48;
export const PLOT_W = VIEW_W - MARGIN_LEFT - MARGIN_RIGHT; // 472
export const PLOT_H = 196;
export const VIEW_H = MARGIN_TOP + PLOT_H + MARGIN_BOTTOM; // 302

// Bar geometry.
export const BAR_MAX_FILL = 0.7; // tallest bar fills at most this fraction of the plot height
export const BAR_WIDTH_RATIO = 0.55; // bar width as a fraction of its slot
export const BAR_MIN_WIDTH = 4;
export const BAR_MIN_HEIGHT = 2; // min height for a non-zero value
export const BAR_RADIUS = 2;
export const VALUE_LABEL_DY = 4; // value text sits this far above the bar top

// Line geometry.
export const LINE_WIDTH = 2;
export const DOT_R = 3;
export const Y_LABEL_DX = 6; // y-axis ref label sits this far left of the plot
export const Y_LABEL_DY = 4; // vertical centering nudge for the y-axis ref label

// Axis lines.
export const BASELINE_WIDTH = 1;

// Title baseline, pinned near the top so the plot can sit lower (headroom under it).
export const TITLE_Y = 16;

// X-axis category labels.
export const X_LABEL_DY = 14; // distance below the baseline
export const BAR_LABEL_ROTATE_AT = 7; // rotate bar x-labels when row count exceeds this
export const LINE_LABEL_ROTATE_AT = 8; // rotate line x-labels when point count exceeds this
export const LABEL_ROTATE_DEG = -40;

export const CHART_COLORS = {
  accent: "var(--color-chart-accent)", // bars, line, dots
  baseline: "var(--color-chart-grid)", // axis baseline
  gridFaint: "var(--color-chart-grid-faint)", // y reference lines
  titleText: "var(--color-chart-title)",
  valueText: "var(--color-chart-value)",
  mutedText: "var(--color-chart-muted)",
} as const;

// Font sizes used inside the SVGs.
export const CHART_FONT = {
  title: 14,
  titleWeight: 600,
  value: 10, // value printed above a bar
  barLabel: 11, // bar category label, not rotated
  barLabelRotated: 10,
  axis: 10, // line y-axis ref label
  lineLabel: 10, // line x-axis label
} as const;
