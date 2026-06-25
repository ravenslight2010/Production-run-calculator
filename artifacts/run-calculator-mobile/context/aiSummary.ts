import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";
import { buildOptimizeRun } from "./aiOptimize";
import type { HistoryDay, RunState } from "./RunContext";

// AI end-of-day / weekly production-recap client (raw fetch + Bearer). EXACT
// mirror of the web src/aiSummary.ts: same wire shapes, same buildOptimizeRun
// mapping, same error handling. Mobile runs carry their own settings, so each is
// shaped via the shared buildOptimizeRun(run, index, nowMs) (replit.md parity).

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
};

// Map one run (via the shared buildOptimizeRun, keeping cases/downtime/stoppage
// counts consistent with optimize/forecast) to the compact summary run shape.
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
  runs: RunState[];
  incidentCount?: number;
  wasteFlaggedCount?: number;
}): SummaryInput {
  const runs: SummaryRunInput[] = args.runs.map((run, i) =>
    toSummaryRun(buildOptimizeRun(run, i, args.nowMs)),
  );
  return {
    scope: "day",
    date: args.date,
    runs,
    incidentCount: args.incidentCount,
    wasteFlaggedCount: args.wasteFlaggedCount,
  };
}

// Build the wire input for a WEEK recap from recent history. Every run in the
// period contributes its planned/produced/downtime so the recap reflects the
// whole week, matching the day recap's accounting.
export function buildWeekSummaryInput(args: {
  date: string;
  nowMs: number;
  history: HistoryDay[];
  incidentCount?: number;
  wasteFlaggedCount?: number;
}): SummaryInput {
  const runs: SummaryRunInput[] = [];
  for (const day of args.history) {
    day.runs.forEach((run, i) => {
      runs.push(toSummaryRun(buildOptimizeRun(run, i, args.nowMs)));
    });
  }
  return {
    scope: "week",
    date: args.date,
    runs,
    incidentCount: args.incidentCount,
    wasteFlaggedCount: args.wasteFlaggedCount,
  };
}

// ── API client (raw fetch + Bearer, matches requestForecast) ─────────────────
export async function requestSummary(input: SummaryInput): Promise<SummaryResult> {
  const base = getApiBaseUrl();
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
