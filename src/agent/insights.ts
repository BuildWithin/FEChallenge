import type { Row } from "./artifact";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatPct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatSource(source: string): string {
  return source.replace(/_/g, " ");
}

/** Deterministic trend lines computed from scoped tool rows — no LLM required. */
export function deriveInsights(
  toolName: string,
  rows: Row[],
): string[] {
  if (rows.length === 0) {
    return ["No rows matched the current filters — try widening dates or dropping jobId."];
  }

  switch (toolName) {
    case "stageConversionRates": {
      const funnel = rows.filter(
        (r) => r.stage !== "applied" && r.conversionFromPrevious != null,
      );
      if (funnel.length === 0) return [];
      const weakest = [...funnel].sort(
        (a, b) => num(a.conversionFromPrevious) - num(b.conversionFromPrevious),
      )[0];
      const prevIdx = rows.findIndex((r) => r.stage === weakest.stage) - 1;
      const prevStage =
        prevIdx >= 0 ? String(rows[prevIdx].stage) : "previous stage";
      return [
        `${prevStage}→${weakest.stage} conversion is ${formatPct(num(weakest.conversionFromPrevious))}, the steepest drop-off in the funnel.`,
      ];
    }

    case "pipelineVelocity": {
      const slowest = [...rows].sort((a, b) => num(b.avgDays) - num(a.avgDays))[0];
      return [
        `${slowest.stage} stage is slowest at ${num(slowest.avgDays).toFixed(1)} avg days (${num(slowest.applicationCount)} applications).`,
      ];
    }

    case "sourceEffectiveness": {
      const bestHire = [...rows].sort((a, b) => num(b.hireRate) - num(a.hireRate))[0];
      const worstReject = [...rows].sort(
        (a, b) => num(b.rejectionRate) - num(a.rejectionRate),
      )[0];
      const lines = [
        `${formatSource(String(bestHire.source))} leads on hire rate (${formatPct(num(bestHire.hireRate))}).`,
      ];
      if (worstReject.source !== bestHire.source) {
        lines.push(
          `${formatSource(String(worstReject.source))} has the highest rejection rate (${formatPct(num(worstReject.rejectionRate))}).`,
        );
      }
      return lines;
    }

    case "applicationCountByStage": {
      const top = [...rows].sort((a, b) => num(b.count) - num(a.count))[0];
      return [
        `Most applications sit in **${top.stage}** (${num(top.count)} applications).`,
      ];
    }

    case "timeToHire": {
      const row = rows[0];
      return [
        `Average time-to-hire is **${num(row.avgDays).toFixed(1)} days** across ${num(row.hiredCount)} hires.`,
      ];
    }

    case "jobPerformance": {
      const top = [...rows].sort(
        (a, b) => num(b.applicationCount) - num(a.applicationCount),
      )[0];
      const dept = top.department ? ` in ${top.department}` : "";
      return [
        `**${top.title}**${dept} has the most applicants (${num(top.applicationCount)}).`,
      ];
    }

    case "candidatesBySource": {
      const top = [...rows].sort((a, b) => num(b.count) - num(a.count))[0];
      return [
        `${formatSource(String(top.source))} drives the most applications (${num(top.count)}).`,
      ];
    }

    case "applicationsOverTime": {
      const peak = [...rows].sort((a, b) => num(b.count) - num(a.count))[0];
      return [
        `Peak volume was **${peak.period}** with ${num(peak.count)} applications.`,
      ];
    }

    default:
      return [];
  }
}

/** Flatten insights from multiple tool results for prepareStep grounding. */
export function flattenToolInsights(
  toolResults: Array<{ toolName: string; output: unknown }>,
): string[] {
  const lines: string[] = [];
  for (const tr of toolResults) {
    const output = tr.output as { insights?: string[]; rows?: Row[] } | undefined;
    if (output?.insights?.length) {
      lines.push(...output.insights);
      continue;
    }
    if (output?.rows) {
      lines.push(...deriveInsights(tr.toolName, output.rows));
    }
  }
  return lines;
}
