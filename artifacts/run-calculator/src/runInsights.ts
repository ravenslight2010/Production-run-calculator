// Run Insights — AI run coaching (Task: pattern-based setting suggestions).
//
// After a run finalizes, the client DETERMINISTICALLY compares what actually
// happened against what was configured for that product+die:
//   - observed throughput vs the configured speed target (cycleSpeed), and
//   - the implied tunnel/drain time vs the configured freezerTime.
// When the deviation is significant (≥5%) and consistent (≥2 recent runs of
// the same product+die, same direction, under the SAME configured value), a
// suggestion candidate is posted to the server, where a manager reviews it in
// the Setup tab's Run Insights card. Nothing is ever auto-applied.
//
// The "same configured value" filter is what resets the consistency window
// after a manager accepts a suggestion: older runs recorded under the previous
// setting no longer count, so a fresh pattern needs ≥2 NEW runs to re-fire.
//
// Web-only for now (manager approval UI is web-only per task scope).

import { inventoryClientId } from "./inventoryShared";
import { loadHistory, loadRunValues } from "./storage";
import { computeSummaryStats } from "./utils";
import { withTempOverrides, type FormValues, type RunMeta } from "./types";

// ─── Pure evaluation ────────────────────────────────────────────────────────

/** Relative deviation that counts as "significant". */
export const INSIGHT_DEVIATION_THRESHOLD = 0.05;
/** Minimum consistent recent runs before a suggestion may fire. */
export const INSIGHT_MIN_RUNS = 2;
/** How closely a prior run's configured values must match the latest run's. */
export const CONFIG_MATCH_TOL = 0.02;
/** Tunnel suggestions also need at least this many minutes of absolute gap. */
export const TUNNEL_MIN_ABS_GAP_MIN = 1;

export interface FinishedRunStat {
  brand: string;
  flavor: string;
  dieType: string;
  /** Pizzas produced (cases × pizzasPerCase). */
  pizzas: number;
  /**
   * Net run minutes: gross wall-clock minus ALL completed stoppages,
   * including pauses — a paused line isn't producing, so counting pause time
   * would unfairly deflate observed throughput. (The Products-tab history
   * aggregate keeps pause time in; this module deliberately does not.)
   */
  netMin: number;
  /** Configured pizzas/minute = crustsPerCycle × cycleSpeed × speedAdjustment. */
  configuredPpm: number;
  /** Configured cycle speed (the setting a speed suggestion would change). */
  cycleSpeed: number;
  /** Configured tunnel time in minutes (freezerTime). */
  freezerTime: number;
  endedAt: number;
}

export type SuggestionType = "speed-target" | "tunnel-time";

export interface SuggestionCandidate {
  type: SuggestionType;
  brand: string;
  flavor: string;
  dieType: string;
  /** In the unit of the setting being recommended (cycles/min or minutes). */
  observedValue: number;
  configuredValue: number;
  recommendedValue: number;
  unit: string;
  runCount: number;
  statsLine: string;
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

// Relative speed deviation for one run: observed ppm over the production
// window (net minutes minus the tunnel dwell) vs configured ppm. Returns null
// when the run can't be measured sanely.
export function runSpeedDeviation(s: FinishedRunStat): number | null {
  if (s.configuredPpm <= 0 || s.pizzas <= 0 || s.netMin <= 0) return null;
  const prodMin = s.netMin - s.freezerTime;
  if (prodMin <= 0) return null;
  const observedPpm = s.pizzas / prodMin;
  return observedPpm / s.configuredPpm - 1;
}

// Observed tunnel minutes: whatever run time is left after producing the
// pizzas at the CONFIGURED rate. Only meaningful when the speed itself was
// close to configured (otherwise the residual is attributing a speed problem
// to the tunnel) — the caller enforces that gate.
export function runObservedTunnelMin(s: FinishedRunStat): number | null {
  if (s.configuredPpm <= 0 || s.pizzas <= 0 || s.netMin <= 0) return null;
  return s.netMin - s.pizzas / s.configuredPpm;
}

function configMatches(a: FinishedRunStat, b: FinishedRunStat): boolean {
  if (a.configuredPpm <= 0 || b.configuredPpm <= 0) return false;
  const ppmOk = Math.abs(a.configuredPpm - b.configuredPpm) / b.configuredPpm <= CONFIG_MATCH_TOL;
  const ftOk =
    Math.abs(a.freezerTime - b.freezerTime) <= Math.max(b.freezerTime * CONFIG_MATCH_TOL, 0.11);
  return ppmOk && ftOk;
}

/**
 * Evaluate finished runs and return at most ONE suggestion candidate per
 * product+die scope. Speed wins over tunnel when both could fire (a wrong
 * speed target contaminates the tunnel residual, so it must be fixed first).
 *
 * `stats` may contain runs of many products/days; only scopes present in
 * `onlyScopes` (when provided) are evaluated — pass the scopes of the runs
 * that just finished so old patterns don't re-fire on unrelated finalizes.
 */
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
    // Only prior runs recorded under the SAME configuration count toward
    // consistency (this is the natural reset after an accepted change).
    const comparable = group.filter((s) => configMatches(s, latest));

    // Speed target -----------------------------------------------------------
    const latestSpeedDev = runSpeedDeviation(latest);
    if (latestSpeedDev !== null && Math.abs(latestSpeedDev) >= INSIGHT_DEVIATION_THRESHOLD) {
      const devs: number[] = [];
      for (const s of comparable) {
        const d = runSpeedDeviation(s);
        if (d !== null && Math.abs(d) >= INSIGHT_DEVIATION_THRESHOLD && d * latestSpeedDev > 0) {
          devs.push(d);
        }
        if (devs.length >= 5) break; // recent window is enough
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
        continue; // never emit both types for one scope
      }
    }

    // Tunnel time -------------------------------------------------------------
    // Gated on speed being close to configured; a speed problem would corrupt
    // the tunnel residual.
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

// ─── Post-accept follow-up ──────────────────────────────────────────────────

/** Deviation tolerance for calling an accepted adjustment "accurate". */
export const FOLLOW_UP_ACCURATE_TOL = 0.03;

/**
 * Given the latest finished run of a scope with an accepted (note-less)
 * suggestion, produce the follow-up note. Returns null when the run can't be
 * measured or the run's configuration doesn't yet reflect the accepted value.
 */
export function computeFollowUpNote(
  latest: FinishedRunStat,
  suggestion: Pick<RunSuggestion, "type" | "recommendedValue">,
): string | null {
  if (suggestion.type === "speed-target") {
    // Only judge once the run actually ran with the accepted cycle speed.
    if (Math.abs(latest.cycleSpeed - suggestion.recommendedValue) > 0.011) return null;
    const dev = runSpeedDeviation(latest);
    if (dev === null) return null;
    const pct = Math.round(Math.abs(dev) * 100);
    return Math.abs(dev) <= FOLLOW_UP_ACCURATE_TOL
      ? `Speed target update seems accurate — last run came in within ${Math.max(pct, 1)}%.`
      : `Speed target still off by about ${pct}% after the update — may need another look.`;
  }
  // tunnel-time
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

// ─── Accept-time helpers ─────────────────────────────────────────────────────

/**
 * Build the die-default entry that applies an accepted tunnel-time
 * recommendation. Returns null when there is no complete existing base
 * (built-in or override) for the die — an unknown/custom die must NOT get an
 * all-zero override minted for it, which would break future run setup for
 * that die. Callers then apply the recommendation to the product setup only.
 */
export function buildTunnelDieDefaultEntry(
  dieType: string,
  base: {
    crustsPerCycle: number;
    cycleSpeed: number;
    speedAdjustment: number;
    casesPerLayer: number;
    preTunnelMin?: number;
    postTunnelMin?: number;
  } | null,
  recommendedFreezerTime: number,
): {
  name: string;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  freezerTime: number;
  casesPerLayer: number;
  preTunnelMin?: number;
  postTunnelMin?: number;
} | null {
  if (!dieType || !base) return null;
  // A "base" with non-finite/zero line settings is not a usable default —
  // refuse rather than persist zeros.
  for (const k of ["crustsPerCycle", "cycleSpeed", "speedAdjustment", "casesPerLayer"] as const) {
    const n = Number(base[k]);
    if (!Number.isFinite(n) || n <= 0) return null;
  }
  if (!Number.isFinite(recommendedFreezerTime) || recommendedFreezerTime <= 0) return null;
  return {
    name: dieType,
    crustsPerCycle: base.crustsPerCycle,
    cycleSpeed: base.cycleSpeed,
    speedAdjustment: base.speedAdjustment,
    casesPerLayer: base.casesPerLayer,
    freezerTime: recommendedFreezerTime,
    ...(base.preTunnelMin != null ? { preTunnelMin: base.preTunnelMin } : {}),
    ...(base.postTunnelMin != null ? { postTunnelMin: base.postTunnelMin } : {}),
  };
}

// ─── Finalize-time reporting glue ───────────────────────────────────────────

/** Days of history to include when looking for a consistent pattern. */
const HISTORY_LOOKBACK_DAYS = 14;

/** Build a FinishedRunStat from a run's meta + saved values; null if unusable. */
export function statFromRun(meta: RunMeta, vals: FormValues): FinishedRunStat | null {
  if (!meta.startedAt || !meta.endedAt || meta.endedAt <= meta.startedAt) return null;
  const v = withTempOverrides(vals);
  const cases = meta.actualCases ?? computeSummaryStats(vals).totalCases;
  const pizzas = cases * (Number(v.pizzasPerCase) || 0);
  // Net minutes: gross minus ALL completed stoppages including pauses (a
  // paused line isn't producing — see FinishedRunStat.netMin note).
  const stoppedMs = (meta.stoppages ?? [])
    .filter((s) => s.endedAt)
    .reduce((a, s) => a + Math.max(0, (s.endedAt as number) - s.startedAt), 0);
  const netMin = (meta.endedAt - meta.startedAt - stoppedMs) / 60000;
  const cycleSpeed = Number(v.cycleSpeed) || 0;
  const configuredPpm =
    (Number(v.crustsPerCycle) || 0) * cycleSpeed * (Number(v.speedAdjustment) || 0);
  if (pizzas <= 0 || netMin <= 0 || configuredPpm <= 0) return null;
  return {
    brand: meta.brand ?? "",
    flavor: meta.flavor ?? "",
    dieType: String(v.dieType ?? ""),
    pizzas,
    cases,
    netMin,
    configuredPpm,
    cycleSpeed,
    freezerTime: Number(v.freezerTime) || 0,
    endedAt: meta.endedAt,
  } as FinishedRunStat;
}

/**
 * Fire-and-forget hook called after run(s) finalize (explicit Stop Run or the
 * start-another-run auto-finalize). Gathers today's finished runs plus recent
 * history, evaluates ONLY the scopes of the runs that just ended, posts any
 * suggestion candidates, and reports post-accept follow-up accuracy notes.
 * Every step is best-effort — a network/AI failure never disturbs the run flow.
 */
export async function reportRunInsightsAfterFinalize(
  endedRuns: RunMeta[],
  todayRuns: RunMeta[],
): Promise<void> {
  try {
    const scopes = new Set<string>();
    for (const r of endedRuns) {
      if (r.brand || r.flavor) {
        const vals = loadRunValues(r.id);
        scopes.add(insightScopeKey(r.brand ?? "", r.flavor ?? "", String(withTempOverrides(vals).dieType ?? "")));
      }
    }
    if (scopes.size === 0) return;

    const stats: FinishedRunStat[] = [];
    for (const r of todayRuns) {
      if (!r.startedAt || !r.endedAt) continue;
      const s = statFromRun(r, loadRunValues(r.id));
      if (s) stats.push(s);
    }
    const cutoff = Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    for (const day of loadHistory()) {
      for (const r of day.runs ?? []) {
        if (!r.startedAt || !r.endedAt || r.endedAt < cutoff) continue;
        const vals = day.runValues?.[r.id];
        if (!vals) continue;
        const s = statFromRun(r, vals as FormValues);
        if (s) stats.push(s);
      }
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
    // best-effort by design
  }
}

// ─── Server glue (pattern: productionRules.ts) ──────────────────────────────

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

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", "x-client-id": inventoryClientId() };
}

export async function fetchRunSuggestions(): Promise<RunSuggestion[]> {
  const res = await fetch("/api/run-suggestions", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List run suggestions failed (${res.status})`);
  const data = (await res.json()) as { suggestions?: RunSuggestion[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export async function observeRunSuggestion(candidate: SuggestionCandidate): Promise<void> {
  const res = await fetch("/api/run-suggestions/observe", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(candidate),
  });
  if (!res.ok) throw new Error(`Observe run suggestion failed (${res.status})`);
}

export async function updateRunSuggestion(
  id: string,
  patch: { status?: "accepted" | "dismissed" | "pending"; clearFollowUp?: boolean },
): Promise<RunSuggestion[]> {
  const res = await fetch("/api/run-suggestions/update", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id, ...patch }),
  });
  if (!res.ok) throw new Error(`Update run suggestion failed (${res.status})`);
  const data = (await res.json()) as { suggestions?: RunSuggestion[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export async function followUpRunSuggestion(id: string, note: string): Promise<void> {
  const res = await fetch("/api/run-suggestions/follow-up", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id, note }),
  });
  if (!res.ok) throw new Error(`Run suggestion follow-up failed (${res.status})`);
}
