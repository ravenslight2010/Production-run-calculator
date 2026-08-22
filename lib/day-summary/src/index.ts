// Shared, pure aggregation for the end-of-day / weekly production summary.
//
// The summary feature gives floor staff and managers a plain-language recap of a
// production day (or a rolling week): how much was planned vs. produced, how the
// line ran (downtime / stoppages), what didn't finish, and any reported issues.
//
// Both apps (artifacts/run-calculator web, artifacts/run-calculator-mobile)
// shape their day-state into the flat DaySummaryInput below and call this. The
// deterministic stats, the AI prompt grounding block, and the fail-safe fallback
// summary all live here so the two apps can't drift (replit.md parity rule). The
// AI only narrates — when the AI call fails or is unavailable, buildFallbackSummary
// always returns a usable plain-language recap from the same stats.

export type SummaryScope = "day" | "week";

export type OperationalReportAvailability = "available" | "unavailable";

export interface OperationalReportSection<T> {
  availability: OperationalReportAvailability;
  value: T | null;
  note?: string;
}

export interface OperationalReport {
  scope: SummaryScope;
  date: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  production: DaySummaryStats;
  quality: OperationalReportSection<{
    checks: number;
    issues: number;
    failed: number;
    warnings: number;
  }>;
  incidents: OperationalReportSection<{
    total: number;
    unresolved: number;
  }>;
  inventory: OperationalReportSection<{
    flaggedItems: number;
  }>;
  narrative?: {
    text: string;
    source: "ai" | "deterministic";
  };
}

/** One finished/attempted run as the client shapes it for the summary. */
export interface DaySummaryRunInput {
  brand: string;
  flavor: string;
  /** Cases the run was planned to make (casesNeeded). */
  casesPlanned: number;
  /** Cases actually produced/finished. */
  casesProduced: number;
  /** Whether the run was completed. */
  finished: boolean;
  /** Total stoppage/downtime minutes accumulated on the run. */
  downtimeMinutes: number;
  /** Number of discrete stoppages on the run. */
  stoppageCount: number;
}

export interface DaySummaryInput {
  scope: SummaryScope;
  /** ISO date for the day, or the week-ending date for a weekly summary. */
  date: string;
  runs: DaySummaryRunInput[];
  /** Incidents reported within the scope (optional context). */
  incidentCount?: number;
  /** Inventory items flagged at-risk / waste within the scope (optional). */
  wasteFlaggedCount?: number;
}

export interface DaySummaryTopDowntime {
  label: string;
  minutes: number;
}

export interface DaySummaryStats {
  scope: SummaryScope;
  date: string;
  runsPlanned: number;
  runsFinished: number;
  casesPlanned: number;
  casesProduced: number;
  /** produced / planned, 0-100, rounded; 0 when nothing was planned. */
  attainmentPct: number;
  totalDowntimeMinutes: number;
  totalStoppages: number;
  /** The single run with the most downtime, if any downtime occurred. */
  topDowntime: DaySummaryTopDowntime | null;
  /** Labels of runs that were planned but never finished. */
  unfinishedRuns: string[];
  incidentCount: number;
  wasteFlaggedCount: number;
  /** False when there were no runs at all — narration should say so plainly. */
  hasData: boolean;
}

function runLabel(run: DaySummaryRunInput): string {
  const brand = (run.brand ?? "").trim();
  const flavor = (run.flavor ?? "").trim();
  if (brand && flavor) return `${brand} ${flavor}`;
  return brand || flavor || "Unnamed run";
}

function safeNum(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Deterministic aggregation of a day's (or week's) runs into summary stats. */
export function aggregateDaySummary(input: DaySummaryInput): DaySummaryStats {
  const runs = Array.isArray(input.runs) ? input.runs : [];

  let casesPlanned = 0;
  let casesProduced = 0;
  let runsFinished = 0;
  let totalDowntimeMinutes = 0;
  let totalStoppages = 0;
  let topDowntime: DaySummaryTopDowntime | null = null;
  const unfinishedRuns: string[] = [];

  for (const run of runs) {
    const planned = Math.max(0, safeNum(run.casesPlanned));
    const produced = Math.max(0, safeNum(run.casesProduced));
    const downtime = Math.max(0, safeNum(run.downtimeMinutes));
    const stoppages = Math.max(0, Math.round(safeNum(run.stoppageCount)));

    casesPlanned += planned;
    casesProduced += produced;
    totalDowntimeMinutes += downtime;
    totalStoppages += stoppages;

    if (run.finished) {
      runsFinished += 1;
    } else {
      unfinishedRuns.push(runLabel(run));
    }

    if (downtime > 0 && (topDowntime === null || downtime > topDowntime.minutes)) {
      topDowntime = { label: runLabel(run), minutes: Math.round(downtime) };
    }
  }

  const attainmentPct =
    casesPlanned > 0
      ? Math.max(0, Math.round((casesProduced / casesPlanned) * 100))
      : 0;

  return {
    scope: input.scope === "week" ? "week" : "day",
    date: String(input.date ?? ""),
    runsPlanned: runs.length,
    runsFinished,
    casesPlanned,
    casesProduced,
    attainmentPct,
    totalDowntimeMinutes: Math.round(totalDowntimeMinutes),
    totalStoppages,
    topDowntime,
    unfinishedRuns,
    incidentCount: Math.max(0, Math.round(safeNum(input.incidentCount))),
    wasteFlaggedCount: Math.max(0, Math.round(safeNum(input.wasteFlaggedCount))),
    hasData: runs.length > 0,
  };
}

function scopeWord(scope: SummaryScope): string {
  return scope === "week" ? "week" : "day";
}

/**
 * Compact, factual stat block fed to the AI as grounding. The AI is asked to
 * narrate ONLY from these figures, never to invent numbers.
 */
export function buildSummaryPromptBlock(stats: DaySummaryStats): string {
  const lines: string[] = [];
  lines.push(`SCOPE: ${scopeWord(stats.scope)} (${stats.date || "unknown date"})`);
  if (!stats.hasData) {
    lines.push("RUNS: none recorded in this period.");
    return lines.join("\n");
  }
  lines.push(
    `RUNS: ${stats.runsFinished} finished of ${stats.runsPlanned} planned.`,
  );
  lines.push(
    `CASES: ${stats.casesProduced} produced of ${stats.casesPlanned} planned (${stats.attainmentPct}% attainment).`,
  );
  lines.push(
    `DOWNTIME: ${stats.totalDowntimeMinutes} min across ${stats.totalStoppages} stoppage(s).`,
  );
  if (stats.topDowntime) {
    lines.push(
      `WORST DOWNTIME: ${stats.topDowntime.label} (${stats.topDowntime.minutes} min).`,
    );
  }
  if (stats.unfinishedRuns.length > 0) {
    lines.push(`UNFINISHED: ${stats.unfinishedRuns.join(", ")}.`);
  }
  if (stats.incidentCount > 0) {
    lines.push(`INCIDENTS REPORTED: ${stats.incidentCount}.`);
  }
  if (stats.wasteFlaggedCount > 0) {
    lines.push(`ITEMS FLAGGED AT-RISK/WASTE: ${stats.wasteFlaggedCount}.`);
  }
  return lines.join("\n");
}

/**
 * Deterministic plain-language summary used when the AI is unavailable or its
 * output is unusable. Always returns something useful from the same stats so the
 * feature is fail-safe (never a blank or error to the user).
 */
export function buildFallbackSummary(stats: DaySummaryStats): string {
  const word = scopeWord(stats.scope);
  if (!stats.hasData) {
    return `No production runs were recorded for this ${word}.`;
  }
  const parts: string[] = [];
  parts.push(
    `This ${word}, ${stats.runsFinished} of ${stats.runsPlanned} planned run${stats.runsPlanned === 1 ? "" : "s"} finished, producing ${stats.casesProduced} of ${stats.casesPlanned} planned case${stats.casesPlanned === 1 ? "" : "s"} (${stats.attainmentPct}% attainment).`,
  );
  if (stats.totalDowntimeMinutes > 0) {
    let dt = `There ${stats.totalStoppages === 1 ? "was" : "were"} ${stats.totalStoppages} stoppage${stats.totalStoppages === 1 ? "" : "s"} totaling ${stats.totalDowntimeMinutes} minute${stats.totalDowntimeMinutes === 1 ? "" : "s"} of downtime`;
    if (stats.topDowntime) {
      dt += `, most of it on ${stats.topDowntime.label} (${stats.topDowntime.minutes} min)`;
    }
    parts.push(dt + ".");
  } else {
    parts.push("No downtime was recorded.");
  }
  if (stats.unfinishedRuns.length > 0) {
    parts.push(
      `Did not finish: ${stats.unfinishedRuns.join(", ")}.`,
    );
  }
  const extras: string[] = [];
  if (stats.incidentCount > 0) {
    extras.push(
      `${stats.incidentCount} issue${stats.incidentCount === 1 ? "" : "s"} reported`,
    );
  }
  if (stats.wasteFlaggedCount > 0) {
    extras.push(
      `${stats.wasteFlaggedCount} item${stats.wasteFlaggedCount === 1 ? "" : "s"} flagged at-risk`,
    );
  }
  if (extras.length > 0) {
    parts.push(extras.join("; ") + ".");
  }
  return parts.join(" ");
}
