import type { OperationalReport } from "@workspace/day-summary";

function sectionValue<T>(
  section: { availability: "available" | "unavailable"; value: T | null; note?: string },
  format: (value: T) => string,
): string {
  if (section.availability !== "available" || section.value === null) {
    return `Unavailable${section.note ? ` — ${section.note}` : ""}`;
  }
  return format(section.value);
}

export function operationalReportTitle(report: OperationalReport): string {
  return `Operational ${report.scope} report — ${report.periodStart} to ${report.periodEnd}`;
}

export function operationalReportText(report: OperationalReport): string {
  const p = report.production;
  const lines = [
    "OPERATIONAL PRODUCTION REPORT",
    `Scope: ${report.scope}`,
    `Period: ${report.periodStart} to ${report.periodEnd}`,
    `Scope date: ${report.date}`,
    `Generated: ${report.generatedAt}`,
    "",
    "AUTHORITATIVE SOURCE STATISTICS",
    `Runs: ${p.runsFinished} finished of ${p.runsPlanned} planned`,
    `Cases: ${p.casesProduced} produced of ${p.casesPlanned} planned (${p.attainmentPct}% attainment)`,
    `Downtime: ${p.totalDowntimeMinutes} minutes across ${p.totalStoppages} stoppages`,
    `Unfinished runs: ${p.unfinishedRuns.length ? p.unfinishedRuns.join(", ") : "None recorded"}`,
    `Quality: ${sectionValue(report.quality, (value) => `${value.checks} checks, ${value.issues} issues, ${value.failed} failed, ${value.warnings} warnings`)}`,
    `Incidents: ${sectionValue(report.incidents, (value) => `${value.total} total, ${value.unresolved} unresolved`)}`,
    `Inventory flags: ${sectionValue(report.inventory, (value) => `${value.flaggedItems} items at or below reorder level`)}`,
    report.inventory.value?.historical
      ? `Historical inventory events: ${sectionValue(report.inventory.value.historical, (value) => `${value.totalEvents} total, ${value.consumptionEvents} consumption, ${value.wasteEvents} waste, ${value.adjustmentEvents} adjustments`)}`
      : "Historical inventory events: Unavailable",
  ];

  if (report.narrative) {
    lines.push(
      "",
      `OPTIONAL NARRATIVE (${report.narrative.source === "ai" ? "AI-GENERATED" : "DETERMINISTIC FALLBACK"}; NOT AUTHORITATIVE STATISTICS)`,
      report.narrative.text,
    );
  }

  return lines.join("\n");
}

export async function shareOperationalReport(
  report: OperationalReport,
): Promise<"shared" | "copied" | "failed"> {
  const text = operationalReportText(report);
  const title = operationalReportTitle(report);

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "shared";
      }
    }
  }

  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return "failed";
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

export function reportFilename(report: OperationalReport): string {
  return `operational-${report.scope}-${report.date}.txt`;
}