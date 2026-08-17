// Run Insights — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/runInsights.ts.
// The pure evaluation logic (evaluateRunInsights, statFromRunState, etc.) is
// self-contained math duplicated here rather than imported from the web app,
// consistent with how other mobile contexts mirror shared logic.
//
// After a run finalises, the client DETERMINISTICALLY compares what actually
// happened against what was configured for that product+die. When the deviation
// is significant (≥5%) and consistent (≥2 recent runs of the same product+die
// under the SAME configured value), a suggestion candidate is posted to the
// server. A manager reviews it on the Setup tab's Run Insights card. Nothing is
// ever auto-applied.

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import type { RunState } from "./RunContext";

// ─── Pure evaluation ────────────────────────────────────────────────────────

export const INSIGHT_DEVIATION_THRESHOLD = 0.05;
export const INSIGHT_MIN_RUNS = 2;
export const CONFIG_MATCH_TOL = 0.02;
export const TUNNEL_MIN_ABS_GAP_MIN = 1;

export interface FinishedRunStat {
  brand: string;
  flavor: string;
  dieType: string;
  pizzas: number;
  netMin: number;
  configuredPpm: number;
  cycleSpeed: number;
  freezerTime: number;
  endedAt: number;
}

export type SuggestionType = "speed-target" | "tunnel-time";

export interface SuggestionCandidate {
  type: SuggestionType;
  brand: string;
  flavor: string;
  dieType: string;
  observedValue: number;
  configuredValue: number;
  recommendedValue: number;
  unit: string;
  runCount: number;
  statsLine: string;
}

export interface RunSuggestion {
  id: string;
  type: SuggestionType;
  brand: string;
  flavor: string;
  dieType: string;
  observedValue: number;
  configuredValue: number;
  recommendedValue: number;
  unit: string;
  runCount: number;
  statsLine: string;
  narrative: string;
  status: "pending" | "accepted" | "dismissed";
  followUpNote: string;
  updatedAt: number;
}

export function insightScopeKey(brand: string, flavor: string, dieType: string): string {
  return `${brand.trim().toLowerCase()}::${flavor.trim().toLowerCase()}::${dieType
    .trim()
    .toLowerCase()}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function runSpeedDeviation(s: FinishedRunStat): number | null {
  if (s.configuredPpm <= 0 || s.pizzas <= 0 || s.netMin <= 0) return null;
  const prodMin = s.netMin - s.freezerTime;
  if (prodMin <= 0) return null;
  const observedPpm = s.pizzas / prodMin;
  return observedPpm / s.configuredPpm - 1;
}

export function runObservedTunnelMin(s: FinishedRunStat): number | null {
  if (s.configuredPpm <= 0 || s.pizzas <= 0 || s.netMin <= 0) return null;
  return s.netMin - s.pizzas / s.configuredPpm;
}

function configMatches(a: FinishedRunStat, b: FinishedRunStat): boolean {
  if (a.configuredPpm <= 0 || b.configuredPpm <= 0) return false;
  const ppmOk =
    Math.abs(a.configuredPpm - b.configuredPpm) / b.configuredPpm <= CONFIG_MATCH_TOL;
  const ftOk =
    Math.abs(a.freezerTime - b.freezerTime) <=
    Math.max(b.freezerTime * CONFIG_MATCH_TOL, 0.11);
  return ppmOk && ftOk;
}

export function evaluateRunInsights(
  stats: FinishedRunStat[],
  onlyScopes?: Set<string>,
): SuggestionCandidate[] {
  const byScope = new Map<string, FinishedRunStat[]>();
  for (const s of stats) {
    if (!s.brand && !s.flavor) continue;
    const key = insightScopeKey(s.brand, s.flavor, s.dieType);
    if (onlyScopes && !onlyScopes.has(key)) continue;
    const arr = byScope.get(key);
    if (arr) arr.push(s);
    else byScope.set(key, [s]);
  }

  const out: SuggestionCandidate[] = [];
  for (const group of byScope.values()) {
    group.sort((a, b) => b.endedAt - a.endedAt);
    const latest = group[0];
    const comparable = group.filter((s) => configMatches(s, latest));

    // Speed target
    const latestSpeedDev = runSpeedDeviation(latest);
    if (latestSpeedDev !== null && Math.abs(latestSpeedDev) >= INSIGHT_DEVIATION_THRESHOLD) {
      const devs: number[] = [];
      for (const s of comparable) {
        const d = runSpeedDeviation(s);
        if (d !== null && Math.abs(d) >= INSIGHT_DEVIATION_THRESHOLD && d * latestSpeedDev > 0) {
          devs.push(d);
        }
        if (devs.length >= 5) break;
      }
      if (devs.length >= INSIGHT_MIN_RUNS && latest.cycleSpeed > 0) {
        const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
        const observed = round2(latest.cycleSpeed * (1 + meanDev));
        const recommended = observed;
        if (recommended > 0 && Math.abs(recommended - latest.cycleSpeed) >= 0.01) {
          const pct = Math.round(Math.abs(meanDev) * 100);
          const dir = meanDev < 0 ? "below" : "above";
          out.push({
            type: "speed-target",
            brand: latest.brand,
            flavor: latest.flavor,
            dieType: latest.dieType,
            observedValue: observed,
            configuredValue: latest.cycleSpeed,
            recommendedValue: recommended,
            unit: "cycles/min",
            runCount: devs.length,
            statsLine: `The last ${devs.length} ${[latest.brand, latest.flavor].filter(Boolean).join(" ")} runs averaged ${pct}% ${dir} the configured speed target (cycle speed ${latest.cycleSpeed}).`,
          });
        }
        continue;
      }
    }

    // Tunnel time
    if (
      latest.freezerTime > 0 &&
      latestSpeedDev !== null &&
      Math.abs(latestSpeedDev) < INSIGHT_DEVIATION_THRESHOLD
    ) {
      const observedTunnels: number[] = [];
      for (const s of comparable) {
        const d = runSpeedDeviation(s);
        if (d === null || Math.abs(d) >= INSIGHT_DEVIATION_THRESHOLD) continue;
        const t = runObservedTunnelMin(s);
        if (t === null || s.freezerTime <= 0) continue;
        const gap = t - s.freezerTime;
        const rel = gap / s.freezerTime;
        const latestGap = (runObservedTunnelMin(latest) ?? 0) - latest.freezerTime;
        if (
          Math.abs(rel) >= INSIGHT_DEVIATION_THRESHOLD &&
          Math.abs(gap) >= TUNNEL_MIN_ABS_GAP_MIN &&
          gap * latestGap > 0
        ) {
          observedTunnels.push(t);
        }
        if (observedTunnels.length >= 5) break;
      }
      if (observedTunnels.length >= INSIGHT_MIN_RUNS) {
        const mean = observedTunnels.reduce((a, b) => a + b, 0) / observedTunnels.length;
        const observed = round1(mean);
        const recommended = observed;
        if (recommended > 0 && Math.abs(recommended - latest.freezerTime) >= 0.1) {
          out.push({
            type: "tunnel-time",
            brand: latest.brand,
            flavor: latest.flavor,
            dieType: latest.dieType,
            observedValue: observed,
            configuredValue: latest.freezerTime,
            recommendedValue: recommended,
            unit: "min",
            runCount: observedTunnels.length,
            statsLine: `The last ${observedTunnels.length} ${[latest.brand, latest.flavor].filter(Boolean).join(" ")} runs implied about ${observed} min of tunnel time against the configured ${latest.freezerTime} min.`,
          });
        }
      }
    }
  }
  return out;
}

export const FOLLOW_UP_ACCURATE_TOL = 0.03;

export function computeFollowUpNote(
  latest: FinishedRunStat,
  suggestion: Pick<RunSuggestion, "type" | "recommendedValue">,
): string | null {
  if (suggestion.type === "speed-target") {
    if (Math.abs(latest.cycleSpeed - suggestion.recommendedValue) > 0.011) return null;
    const dev = runSpeedDeviation(latest);
    if (dev === null) return null;
    const pct = Math.round(Math.abs(dev) * 100);
    return Math.abs(dev) <= FOLLOW_UP_ACCURATE_TOL
      ? `Speed target update seems accurate — last run came in within ${Math.max(pct, 1)}%.`
      : `Speed target still off by about ${pct}% after the update — may need another look.`;
  }
  if (Math.abs(latest.freezerTime - suggestion.recommendedValue) > 0.11) return null;
  const t = runObservedTunnelMin(latest);
  if (t === null || latest.freezerTime <= 0) return null;
  const dev = (t - latest.freezerTime) / latest.freezerTime;
  const speedDev = runSpeedDeviation(latest);
  if (speedDev !== null && Math.abs(speedDev) >= INSIGHT_DEVIATION_THRESHOLD) return null;
  const pct = Math.round(Math.abs(dev) * 100);
  return Math.abs(dev) <= FOLLOW_UP_ACCURATE_TOL
    ? `Tunnel time update seems accurate — last run came in within ${Math.max(pct, 1)}%.`
    : `Tunnel time still off by about ${pct}% after the update — may need another look.`;
}

/** Build a FinishedRunStat from a mobile RunState. Returns null if the run can't be measured. */
export function statFromRunState(run: RunState): FinishedRunStat | null {
  if (!run.startedAt || !run.endedAt || run.endedAt <= run.startedAt) return null;
  const s = run.settings;
  // Use the actual tracked cases if available; fall back to progress count; then casesNeeded.
  const cases =
    run.actualCases ??
    (run.progress.skidsCompleted * s.casesPerSkid + run.progress.casesOnCurrentSkid) ||
    s.casesNeeded;
  const pizzas = cases * (s.pizzasPerCase || 0);
  const stoppedMs = run.stoppages
    .filter((st) => st.endedAt != null)
    .reduce((acc, st) => acc + Math.max(0, (st.endedAt as number) - st.startedAt), 0);
  const netMin = (run.endedAt - run.startedAt - stoppedMs) / 60000;
  const cycleSpeed = s.cycleSpeed || 0;
  const configuredPpm = (s.crustsPerCycle || 0) * cycleSpeed * (s.speedAdjustment || 0);
  if (pizzas <= 0 || netMin <= 0 || configuredPpm <= 0) return null;
  return {
    brand: s.brand ?? "",
    flavor: s.flavor ?? "",
    dieType: s.dieType ?? "",
    pizzas,
    netMin,
    configuredPpm,
    cycleSpeed,
    freezerTime: s.freezerTime || 0,
    endedAt: run.endedAt,
  };
}

// ─── Server glue ────────────────────────────────────────────────────────────

async function apiCall(path: string, opts?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  return fetch(`${base}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export async function fetchRunSuggestions(): Promise<RunSuggestion[]> {
  const res = await apiCall("/run-suggestions");
  if (!res.ok) throw new Error(`List run suggestions failed (${res.status})`);
  const data = (await res.json()) as { suggestions?: RunSuggestion[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export async function observeRunSuggestion(candidate: SuggestionCandidate): Promise<void> {
  const res = await apiCall("/run-suggestions/observe", {
    method: "POST",
    body: JSON.stringify(candidate),
  });
  if (!res.ok) throw new Error(`Observe run suggestion failed (${res.status})`);
}

export async function updateRunSuggestion(
  id: string,
  patch: { status?: "accepted" | "dismissed"; clearFollowUp?: boolean },
): Promise<RunSuggestion[]> {
  const res = await apiCall("/run-suggestions/update", {
    method: "POST",
    body: JSON.stringify({ id, ...patch }),
  });
  if (!res.ok) throw new Error(`Update run suggestion failed (${res.status})`);
  const data = (await res.json()) as { suggestions?: RunSuggestion[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export async function followUpRunSuggestion(id: string, note: string): Promise<void> {
  const res = await apiCall("/run-suggestions/follow-up", {
    method: "POST",
    body: JSON.stringify({ id, note }),
  });
  if (!res.ok) throw new Error(`Run suggestion follow-up failed (${res.status})`);
}

/**
 * Fire-and-forget: called after run(s) finalise on mobile. Evaluates the
 * scopes of the just-ended runs from today's run list, posts any suggestion
 * candidates, and reports post-accept follow-up accuracy notes. Every step is
 * best-effort — a failure never disturbs the run flow.
 *
 * Mobile only looks at today's runs (no local history store). The server
 * persists suggestions cross-device, so patterns from web finalisations also
 * surface here.
 */
export async function reportRunInsightsAfterFinalize(
  endedRuns: RunState[],
  todayRuns: RunState[],
): Promise<void> {
  try {
    const scopes = new Set<string>();
    for (const r of endedRuns) {
      const s = r.settings;
      if (s.brand || s.flavor) {
        scopes.add(insightScopeKey(s.brand ?? "", s.flavor ?? "", s.dieType ?? ""));
      }
    }
    if (scopes.size === 0) return;

    const stats: FinishedRunStat[] = [];
    for (const r of todayRuns) {
      if (!r.startedAt || !r.endedAt) continue;
      const s = statFromRunState(r);
      if (s) stats.push(s);
    }

    const candidates = evaluateRunInsights(stats, scopes);
    for (const c of candidates) {
      await observeRunSuggestion(c).catch(() => {});
    }

    // Post-accept feedback: if an accepted suggestion for one of these scopes
    // has no follow-up note yet, judge the just-finished run against it.
    if (candidates.length < scopes.size || candidates.length === 0) {
      const suggestions = await fetchRunSuggestions().catch(() => [] as RunSuggestion[]);
      const accepted = suggestions.filter((s) => s.status === "accepted" && !s.followUpNote);
      for (const s of accepted) {
        const key = insightScopeKey(s.brand, s.flavor, s.dieType);
        if (!scopes.has(key)) continue;
        const latest = stats
          .filter((st) => insightScopeKey(st.brand, st.flavor, st.dieType) === key)
          .sort((a, b) => b.endedAt - a.endedAt)[0];
        if (!latest) continue;
        const note = computeFollowUpNote(latest, s);
        if (note) await followUpRunSuggestion(s.id, note).catch(() => {});
      }
    }
  } catch {
    // best-effort
  }
}
