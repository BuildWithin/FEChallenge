export const LABEL_OVERRIDES: Record<string, string> = {
  linkedin: "LinkedIn",
  job_board: "Job Board",
  careers_site: "Careers Site",
  daysOpen: "Days Open",
  jobId: "Job ID",
  jobTitle: "Job Title",
  avgDays: "Avg Days",
  avgDaysInPipeline: "Avg Days in Pipeline",
  daysSinceApplied: "Days Since Applied",
  medianDays: "Median Days",
  hiredCount: "Hired",
};

export function formatLabel(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  if (value.includes("_")) {
    return value
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return value
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Matches enum-like values: all lowercase letters/underscores, no spaces, no @ or +
export const ENUM_PATTERN = /^[a-z][a-z_]*$/;

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  const str = String(value);
  if (ENUM_PATTERN.test(str)) return formatLabel(str);
  return str;
}
