import type { FormValues, RunMeta, HistoryDay } from "./types";
import { buildOptimizeRun } from "./aiOptimize";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";
import type { AiStatus } from "./aiStatus";

// AI end-of-day / weekly production-recap client (raw fetch, matches
// aiForecast.ts). Shapes the day's (or a rolling week's) runs through the shared
// buildOptimizeRun mapping, sends them to /ai/summary, and renders the recap.
// Kept in lockstep with the mobile context/aiSummary.ts so both platforms send
// identically-shaped data and show the same card (replit.md parity rule).

// ── Types (mirror the OpenAPI /ai/summary contract) ──────────────────────────
export type SummaryScope = "day" | "week";

export type SummaryRunInput = {
  brand: string;
  flavor: string;
  casesPlanned: number;
  casesProduced: number;
  finished: boolean;
  downtimeMinutes: number;
  stoppageCount: number;
};

export type SummaryInput = {
  scope: SummaryScope;
  date: string;
  runs: SummaryRunInput[];
  incidentCount?: number;
  wasteFlaggedCount?: number;
};

export type SummaryTopDowntime = {
  label: string;
  minutes: number;
};

export type SummaryStats = {
  scope: SummaryScope;
  date: string;
  runsPlanned: number;
  runsFinished: number;
  casesPlanned: number;
  casesProduced: number;
  attainmentPct: number;
  totalDowntimeMinutes: number;
  totalStoppages: number;
  topDowntime: SummaryTopDowntime | null;
  unfinishedRuns: string[];
  incidentCount: number;
  wasteFlaggedCount: number;
  hasData: boolean;
};

export type SummaryResult = {
  summary: string;
  stats: SummaryStats;
  generatedAt: number;
  aiGenerated: boolean;
  aiStatus?: AiStatus;
};

// Map one run (via the shared buildOptimizeRun, keeping cases/downtime/stoppage
// counts consistent with the optimize/forecast features) to the compact summary
// run shape. Used for both day-scope (today's runs) and week-scope (history).
function toSummaryRun(o: ReturnType<typeof buildOptimizeRun>): SummaryRunInput {
  return {
    brand: o.brand,
    flavor: o.flavor,
    casesPlanned: o.casesNeeded,
    casesProduced: o.casesMade,
    finished: o.status === "finished",
    downtimeMinutes: Math.round(o.downtimeSec / 60),
    stoppageCount: o.stoppages.length,
  };
}

// Build the wire input for a DAY recap from today's live runs.
export function buildDaySummaryInput(args: {
  date: string;
  nowMs: number;
  runs: RunMeta[];
  runValues: (run: RunMeta) => FormValues | undefined;
  incidentCount?: number;
  wasteFlaggedCount?: number;
}): SummaryInput {
  const runs: SummaryRunInput[] = [];
  for (const run of args.runs) {
    const vals = args.runValues(run);
    if (!vals) continue;
    runs.push(toSummaryRun(buildOptimizeRun(run, vals, args.nowMs)));
  }
  return {
    scope: "day",
    date: args.date,
    runs,
    incidentCount: args.incidentCount,
    wasteFlaggedCount: args.wasteFlaggedCount,
  };
}

// Build the wire input for a WEEK recap from recent FINISHED history. Every run
// in the period (finished or not) contributes its planned/produced/downtime so
// the recap reflects the whole week, matching the day recap's accounting.
export function buildWeekSummaryInput(args: {
  date: string;
  nowMs: number;
  history: HistoryDay[];
  runValuesForHistory: (day: HistoryDay, run: RunMeta) => FormValues | undefined;
  incidentCount?: number;
  wasteFlaggedCount?: number;
}): SummaryInput {
  const runs: SummaryRunInput[] = [];
  for (const day of args.history) {
    for (const run of day.runs) {
      const vals = args.runValuesForHistory(day, run);
      if (!vals) continue;
      runs.push(toSummaryRun(buildOptimizeRun(run, vals, args.nowMs)));
    }
  }
  return {
    scope: "week",
    date: args.date,
    runs,
    incidentCount: args.incidentCount,
    wasteFlaggedCount: args.wasteFlaggedCount,
  };
}

// ── API client (raw fetch, matches inventoryShared) ──────────────────────────
export async function requestSummary(input: SummaryInput): Promise<SummaryResult> {
  const res = await fetch("/api/ai/summary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Summary request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as SummaryResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const summaryErrorMessage = photoErrorMessage;
