// Pure, deterministic predictive-maintenance / anomaly detection. Compares
// today's finished runs against a per-product baseline built from recent
// history and flags meaningful drift in downtime, yield, and stoppage count.
//
// Posture mirrors the waste-insight feature: the DETECTION is fully
// deterministic and testable here, and the server only asks the AI to NARRATE
// when at least one anomaly is flagged (no flags → no paid call). Advisory and
// read-only — nothing here ever edits a run.

export type AnomalyMetric = "downtime" | "yield" | "stoppages";
export type AnomalySeverity = "low" | "medium" | "high";

// One finished run, in the flat shape both apps already produce for summaries.
export interface AnomalyRun {
  brand: string;
  flavor: string;
  casesPlanned: number;
  casesProduced: number;
  downtimeMinutes: number;
  stoppageCount: number;
}

export interface AnomalyInput {
  // Today's finished runs to check.
  today: AnomalyRun[];
  // Recent finished runs from prior days, used to build the baseline.
  history: AnomalyRun[];
}

export interface Anomaly {
  runLabel: string;
  brand: string;
  flavor: string;
  metric: AnomalyMetric;
  observed: number;
  baseline: number;
  severity: AnomalySeverity;
  // How many runs the baseline was computed from (confidence signal).
  baselineSamples: number;
  description: string;
}

export interface AnomalyResult {
  anomalies: Anomaly[];
  checkedRuns: number;
  baselineRuns: number;
}

// At least this many baseline samples (product-specific OR global fallback) are
// needed before we trust a comparison enough to flag drift.
export const MIN_BASELINE_SAMPLES = 3;

// Drift thresholds. Each requires BOTH a relative and an absolute gap so tiny
// runs and noise don't trip a flag.
const DOWNTIME_RATIO = 1.5; // observed >= 1.5x baseline
const DOWNTIME_ABS_MIN = 10; // and at least +10 min over baseline
const DOWNTIME_HIGH_RATIO = 2; // >= 2x baseline → high
const DOWNTIME_HIGH_ABS = 30; // or +30 min → high

const YIELD_DROP_PTS = 10; // observed yield% <= baseline% - 10pts
const YIELD_CEILING = 95; // and below 95% (near-target runs are fine)
const YIELD_HIGH_DROP = 25; // >= 25pt drop → high

const STOPPAGE_RATIO = 1.5;
const STOPPAGE_ABS_MIN = 2; // and at least +2 stoppages
const STOPPAGE_HIGH_ABS = 5;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function productKey(run: AnomalyRun): string {
  return `${norm(run.brand)}::${norm(run.flavor)}`;
}

function runLabel(run: AnomalyRun): string {
  const brand = run.brand.trim();
  const flavor = run.flavor.trim();
  if (brand && flavor) return `${brand} ${flavor}`;
  return brand || flavor || "Run";
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Yield (attainment) as a percentage. Runs with no plan can't have a meaningful
// yield, so they're excluded from yield baselines and checks (returns null).
export function yieldPct(run: AnomalyRun): number | null {
  if (!(run.casesPlanned > 0)) return null;
  return (run.casesProduced / run.casesPlanned) * 100;
}

interface Baseline {
  downtime: number;
  stoppages: number;
  yieldPct: number;
  downtimeSamples: number;
  stoppageSamples: number;
  yieldSamples: number;
}

function buildBaseline(runs: AnomalyRun[]): Baseline {
  const yields = runs.map(yieldPct).filter((v): v is number => v !== null);
  return {
    downtime: mean(runs.map((r) => r.downtimeMinutes)),
    stoppages: mean(runs.map((r) => r.stoppageCount)),
    yieldPct: mean(yields),
    downtimeSamples: runs.length,
    stoppageSamples: runs.length,
    yieldSamples: yields.length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Detect anomalies in today's runs vs history. Deterministic and order-stable
// (highest severity first, then largest relative gap).
export function detectAnomalies(input: AnomalyInput): AnomalyResult {
  const history = input.history ?? [];
  const today = input.today ?? [];

  // Per-product baselines + a global fallback for products with thin history.
  const byProduct = new Map<string, AnomalyRun[]>();
  for (const r of history) {
    const key = productKey(r);
    const arr = byProduct.get(key);
    if (arr) arr.push(r);
    else byProduct.set(key, [r]);
  }
  const globalBaseline = buildBaseline(history);

  const anomalies: Anomaly[] = [];

  for (const run of today) {
    const productRuns = byProduct.get(productKey(run)) ?? [];
    const useProduct = productRuns.length >= MIN_BASELINE_SAMPLES;
    const baseline = useProduct ? buildBaseline(productRuns) : globalBaseline;

    // Downtime drift.
    if (baseline.downtimeSamples >= MIN_BASELINE_SAMPLES && baseline.downtime > 0) {
      const obs = run.downtimeMinutes;
      const over = obs - baseline.downtime;
      if (obs >= baseline.downtime * DOWNTIME_RATIO && over >= DOWNTIME_ABS_MIN) {
        const high = obs >= baseline.downtime * DOWNTIME_HIGH_RATIO || over >= DOWNTIME_HIGH_ABS;
        anomalies.push({
          runLabel: runLabel(run),
          brand: run.brand,
          flavor: run.flavor,
          metric: "downtime",
          observed: round1(obs),
          baseline: round1(baseline.downtime),
          severity: high ? "high" : "medium",
          baselineSamples: baseline.downtimeSamples,
          description: `${runLabel(run)} had ${round1(obs)} min of downtime vs a usual ${round1(baseline.downtime)} min.`,
        });
      }
    }

    // Yield (attainment) drop.
    const y = yieldPct(run);
    if (y !== null && baseline.yieldSamples >= MIN_BASELINE_SAMPLES) {
      const drop = baseline.yieldPct - y;
      if (drop >= YIELD_DROP_PTS && y < YIELD_CEILING) {
        anomalies.push({
          runLabel: runLabel(run),
          brand: run.brand,
          flavor: run.flavor,
          metric: "yield",
          observed: round1(y),
          baseline: round1(baseline.yieldPct),
          severity: drop >= YIELD_HIGH_DROP ? "high" : "medium",
          baselineSamples: baseline.yieldSamples,
          description: `${runLabel(run)} hit ${round1(y)}% of plan vs a usual ${round1(baseline.yieldPct)}%.`,
        });
      }
    }

    // Stoppage-count spike.
    if (baseline.stoppageSamples >= MIN_BASELINE_SAMPLES && baseline.stoppages > 0) {
      const obs = run.stoppageCount;
      const over = obs - baseline.stoppages;
      if (obs >= baseline.stoppages * STOPPAGE_RATIO && over >= STOPPAGE_ABS_MIN) {
        anomalies.push({
          runLabel: runLabel(run),
          brand: run.brand,
          flavor: run.flavor,
          metric: "stoppages",
          observed: round1(obs),
          baseline: round1(baseline.stoppages),
          severity: obs >= STOPPAGE_HIGH_ABS ? "high" : "medium",
          baselineSamples: baseline.stoppageSamples,
          description: `${runLabel(run)} had ${obs} stoppages vs a usual ${round1(baseline.stoppages)}.`,
        });
      }
    }
  }

  const rank: Record<AnomalySeverity, number> = { high: 3, medium: 2, low: 1 };
  anomalies.sort((a, b) => {
    if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity];
    const aGap = a.baseline > 0 ? a.observed / a.baseline : 0;
    const bGap = b.baseline > 0 ? b.observed / b.baseline : 0;
    return bGap - aGap;
  });

  return { anomalies, checkedRuns: today.length, baselineRuns: history.length };
}

// Compact prompt block describing the flagged anomalies for the AI narrator.
// Only called when there is at least one anomaly.
export function buildAnomalyPromptBlock(result: AnomalyResult): string {
  if (result.anomalies.length === 0) return "No anomalies detected.";
  const lines = result.anomalies.map(
    (a) =>
      `- [${a.severity}] ${a.metric}: ${a.description} (baseline from ${a.baselineSamples} past runs)`,
  );
  return (
    `Flagged ${result.anomalies.length} anomaly(ies) across ${result.checkedRuns} run(s) today, ` +
    `baseline drawn from ${result.baselineRuns} past runs:\n` +
    lines.join("\n")
  );
}
