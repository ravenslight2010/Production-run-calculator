import { AiForecastBody } from "@workspace/api-zod";
import * as z from "zod";

// AI demand forecasting. Given recent FINISHED production history (grouped by
// day) plus any already-scheduled future runs, predict a suggested run plan for
// ONE upcoming day: what to run, rough case quantities, and a sensible
// sequence — with a plain-language rationale and an honest confidence level.
//
// Design posture (mirrors the other /ai/* endpoints): heavy data shaping lives
// server-side so both clients stay thin and identical; the model output is
// untrusted and validated leniently; nothing is ever committed — the manager
// reviews the suggestion into the editable schedule. Crucially this endpoint is
// explicit about uncertainty and refuses to fabricate when history is too thin.

export type ForecastConfidence = "high" | "medium" | "low";

// Bound how much the model is asked to do / can return so one request can't
// blow up cost or latency. Mirrors the other AI endpoint guards.
export const FORECAST_MAX_TOTAL_RUNS = 600;
// Minimum finished history before we'll forecast at all. A single finished run is
// not a pattern; below this we refuse honestly instead of fabricating demand.
export const FORECAST_MIN_RUNS = 2;
export const FORECAST_MAX_RUNS_OUT = 20;
export const FORECAST_MAX_SUMMARY_CHARS = 900;
export const FORECAST_MAX_RATIONALE_CHARS = 280;
export const FORECAST_MAX_NAME_CHARS = 80;
export const FORECAST_MAX_DIE_CHARS = 40;
export const FORECAST_MAX_NOTE_CHARS = 400;
// Generous upper bound on a suggested case target; guards absurd model values.
export const FORECAST_MAX_CASES = 1_000_000;

export type ForecastInput = z.infer<typeof AiForecastBody>;

export type ForecastRunOut = {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  rationale: string;
};

export type ForecastPlanOut = {
  targetDate: string;
  confidence: ForecastConfidence;
  summary: string;
  runs: ForecastRunOut[];
};

export type ForecastValidationResult =
  | { ok: true; data: ForecastInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/forecast.
export function validateForecastBody(body: unknown): ForecastValidationResult {
  const parsed = AiForecastBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const historyRuns = data.history.reduce((acc, d) => acc + d.runs.length, 0);
  const total = historyRuns + (data.scheduledRuns?.length ?? 0);
  if (total > FORECAST_MAX_TOTAL_RUNS) {
    return { ok: false, status: 400, error: `Too many runs (max ${FORECAST_MAX_TOTAL_RUNS})` };
  }
  return { ok: true, data };
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Deterministic day-of-week (0=Sun) for an ISO YYYY-MM-DD date string. Parsed as
// a local calendar date so it matches how the clients group days.
export function dayOfWeek(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return new Date(isoDate).getDay();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d).getDay();
}

export type ProductPattern = {
  brand: string;
  flavor: string;
  /** Most-common die type seen for this product (empty if never specified). */
  dieType: string;
  /** Number of distinct history days this product ran on. */
  daysSeen: number;
  /** Number of those days that fell on the target day-of-week. */
  daysOnTargetDow: number;
  /** Average cases per day it ran (rounded). */
  avgCases: number;
};

export type ForecastAggregates = {
  targetDow: number;
  totalDays: number;
  totalRuns: number;
  /** Days in history that fall on the same weekday as the target date. */
  matchingDowDays: number;
  /** Average total cases produced across all history days (rounded). */
  avgDailyCases: number;
  /** Average total cases on history days matching the target weekday, if any. */
  avgDowCases: number | null;
  /** Products ranked by relevance to the target weekday then frequency. */
  products: ProductPattern[];
};

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// Pure, deterministic roll-up of the supplied history into demand patterns the
// prompt (and a future accuracy check) can reason over. No I/O, no AI — easy to
// test and identical regardless of which client sent the data.
export function aggregateForecastHistory(input: ForecastInput): ForecastAggregates {
  const targetDow = dayOfWeek(input.targetDate);

  type Acc = {
    brand: string;
    flavor: string;
    dies: string[];
    days: Set<string>;
    dowDays: Set<string>;
    cases: number;
  };
  const byProduct = new Map<string, Acc>();

  let totalRuns = 0;
  const perDayCases: number[] = [];
  const dowDayCases: number[] = [];

  for (const day of input.history) {
    const dow = dayOfWeek(day.date);
    let dayTotal = 0;
    for (const run of day.runs) {
      totalRuns++;
      dayTotal += run.cases;
      const key = `${run.brand.trim().toLowerCase()}|||${run.flavor.trim().toLowerCase()}`;
      let acc = byProduct.get(key);
      if (!acc) {
        acc = {
          brand: run.brand.trim(),
          flavor: run.flavor.trim(),
          dies: [],
          days: new Set(),
          dowDays: new Set(),
          cases: 0,
        };
        byProduct.set(key, acc);
      }
      if (run.dieType) acc.dies.push(run.dieType);
      acc.days.add(day.date);
      if (dow === targetDow) acc.dowDays.add(day.date);
      acc.cases += run.cases;
    }
    perDayCases.push(dayTotal);
    if (dow === targetDow) dowDayCases.push(dayTotal);
  }

  const avg = (xs: number[]): number =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  const products: ProductPattern[] = [...byProduct.values()]
    .map((a) => ({
      brand: a.brand,
      flavor: a.flavor,
      dieType: mostCommon(a.dies),
      daysSeen: a.days.size,
      daysOnTargetDow: a.dowDays.size,
      avgCases: a.days.size ? Math.round(a.cases / a.days.size) : 0,
    }))
    // Most relevant first: products that recur on the target weekday, then the
    // most frequent overall, then the highest typical volume.
    .sort(
      (x, y) =>
        y.daysOnTargetDow - x.daysOnTargetDow ||
        y.daysSeen - x.daysSeen ||
        y.avgCases - x.avgCases,
    );

  return {
    targetDow,
    totalDays: input.history.length,
    totalRuns,
    matchingDowDays: dowDayCases.length,
    avgDailyCases: avg(perDayCases),
    avgDowCases: dowDayCases.length ? avg(dowDayCases) : null,
    products,
  };
}

// ── Lenient validation of the untrusted model response ───────────────────────
const RunSchema = z.object({
  brand: z.coerce.string().optional(),
  flavor: z.coerce.string().optional(),
  dieType: z.coerce.string().optional(),
  casesNeeded: z.coerce.number().optional(),
  rationale: z.coerce.string().optional(),
});
const PlanSchema = z.object({
  targetDate: z.coerce.string().optional(),
  confidence: z.coerce.string().optional(),
  summary: z.coerce.string().optional(),
  runs: z.array(z.unknown()).optional(),
});
const ResponseSchema = z.object({
  forecast: z.unknown().nullish(),
  note: z.coerce.string().optional(),
});

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function mapConfidence(raw: string | undefined): ForecastConfidence {
  const c = (raw ?? "").trim().toLowerCase();
  if (c.startsWith("high")) return "high";
  if (c.startsWith("low")) return "low";
  return "medium";
}

// The model returns structured JSON but is untrusted: validate leniently, drop
// malformed runs, clamp free text, and collapse to a null forecast (with note)
// when the top-level shape is wrong or no usable runs survive. A null forecast
// is a valid "not enough to predict" outcome.
export function sanitizeForecast(
  raw: unknown,
  targetDate: string,
): { forecast: ForecastPlanOut | null; note?: string } {
  const top = ResponseSchema.safeParse(raw);
  if (!top.success) return { forecast: null };
  const note = (top.data.note ?? "").trim();
  const withNote = (forecast: ForecastPlanOut | null) =>
    note ? { forecast, note: clamp(note, FORECAST_MAX_NOTE_CHARS) } : { forecast };

  if (top.data.forecast == null) return withNote(null);

  const parsed = PlanSchema.safeParse(top.data.forecast);
  if (!parsed.success) return withNote(null);
  const p = parsed.data;

  const runs: ForecastRunOut[] = [];
  for (const item of p.runs ?? []) {
    if (runs.length >= FORECAST_MAX_RUNS_OUT) break;
    const r = RunSchema.safeParse(item);
    if (!r.success) continue;
    const brand = clamp(r.data.brand ?? "", FORECAST_MAX_NAME_CHARS);
    const flavor = clamp(r.data.flavor ?? "", FORECAST_MAX_NAME_CHARS);
    if (!brand && !flavor) continue;
    const cases = Math.round(r.data.casesNeeded ?? NaN);
    const casesNeeded =
      Number.isFinite(cases) && cases > 0 && cases <= FORECAST_MAX_CASES ? cases : 0;
    runs.push({
      brand,
      flavor,
      dieType: clamp(r.data.dieType ?? "", FORECAST_MAX_DIE_CHARS),
      casesNeeded,
      rationale: clamp(r.data.rationale ?? "", FORECAST_MAX_RATIONALE_CHARS),
    });
  }

  const summary = clamp(p.summary ?? "", FORECAST_MAX_SUMMARY_CHARS);
  // A plan with no usable runs is not a plan; surface it as "no forecast" so the
  // client shows the honest empty state instead of a blank card.
  if (runs.length === 0) {
    return note
      ? { forecast: null, note: clamp(note, FORECAST_MAX_NOTE_CHARS) }
      : summary
        ? { forecast: null, note: clamp(summary, FORECAST_MAX_NOTE_CHARS) }
        : { forecast: null };
  }

  // Never let a malformed model-supplied date reach the client's schedule
  // seeding; require a real ISO YYYY-MM-DD and fall back to the requested date.
  const modelDate = (p.targetDate ?? "").trim();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(modelDate) ? modelDate : targetDate;

  return withNote({
    targetDate: safeDate,
    confidence: mapConfidence(p.confidence),
    summary,
    runs,
  });
}

// Shape the validated input + deterministic aggregates into a compact,
// model-friendly prompt. The aggregates do the pattern-finding so the model only
// has to reason and explain; the instructions force it to be honest about
// uncertainty and never invent demand that the history doesn't support.
export function buildForecastPrompt(
  input: ForecastInput,
  // Optional compact summary of how recent forecasts actually performed (from
  // forecastAccuracy.formatAccuracyGrounding). When present it's surfaced as its
  // own prompt section so the model self-corrects known over-/under-prediction
  // biases instead of leaving the signal buried in the generic memory dump.
  accuracyGrounding?: string,
): {
  system: string;
  user: string;
} {
  const agg = aggregateForecastHistory(input);

  const system =
    "You are a demand-forecasting assistant for a frozen-pizza factory. " +
    "Given recent FINISHED production history (grouped by day) and any runs " +
    "already scheduled for future days, predict a sensible run plan for ONE " +
    "upcoming day: which products to run, a rough case target for each, and a " +
    "reasonable production sequence (group by die type to minimise changeovers). " +
    "Ground every suggestion in the supplied history — especially what tends to " +
    "run on the same weekday — and in the shared facility memory. If a RECENT " +
    "FORECAST ACCURACY section is provided, use it to correct yourself: scale " +
    "back products you have consistently over-predicted and raise those you have " +
    "consistently under-predicted. Be explicit " +
    "and HONEST about uncertainty: set confidence to \"low\" when history is thin " +
    "or inconsistent, and never invent demand, products, or quantities the data " +
    "does not support. If there is not enough history to predict responsibly, " +
    "return a null forecast with a short explanation in \"note\" instead of " +
    "guessing. Do not suggest formula or recipe changes. This is advisory only — " +
    "a manager will review and adjust it before anything is scheduled.";

  const lines: string[] = [];
  lines.push(`TARGET DATE: ${input.targetDate} (${DOW[agg.targetDow]})`);
  lines.push(
    `HISTORY DEPTH: ${agg.totalDays} day(s), ${agg.totalRuns} finished run(s); ` +
      `${agg.matchingDowDays} of those day(s) were ${DOW[agg.targetDow]}s.`,
  );
  lines.push(
    `TYPICAL DAILY VOLUME: ~${agg.avgDailyCases} cases/day overall` +
      (agg.avgDowCases != null
        ? `, ~${agg.avgDowCases} cases on ${DOW[agg.targetDow]}s.`
        : ` (no ${DOW[agg.targetDow]} history yet).`),
  );

  lines.push("");
  lines.push("PRODUCT PATTERNS (most relevant to the target weekday first):");
  if (agg.products.length) {
    lines.push(
      agg.products
        .slice(0, 40)
        .map(
          (p) =>
            `- "${p.brand} ${p.flavor}" die=${p.dieType || "?"} ` +
            `ranOn=${p.daysSeen}day(s) onThisWeekday=${p.daysOnTargetDow} ` +
            `avgCases=${p.avgCases}`,
        )
        .join("\n"),
    );
  } else {
    lines.push("(no finished history provided)");
  }

  lines.push("");
  lines.push("RECENT DAYS (most recent context):");
  const recent = [...input.history]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 21);
  if (recent.length) {
    for (const d of recent) {
      const runs = d.runs
        .map((r) => `"${r.brand} ${r.flavor}"=${r.cases}cs`)
        .join(", ");
      lines.push(`- ${d.date} (${DOW[dayOfWeek(d.date)]}): ${runs || "(no runs)"}`);
    }
  } else {
    lines.push("(none)");
  }

  if (input.scheduledRuns?.length) {
    lines.push("");
    lines.push("ALREADY-SCHEDULED FUTURE RUNS (do not double-book these):");
    lines.push(
      input.scheduledRuns
        .map(
          (s) =>
            `- date=${s.date} "${s.brand} ${s.flavor}" die=${s.dieType || "?"} casesNeeded=${s.casesNeeded}`,
        )
        .join("\n"),
    );
  }

  if (accuracyGrounding && accuracyGrounding.trim()) {
    lines.push("");
    lines.push(accuracyGrounding.trim());
  }

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"forecast":{"targetDate":string,"confidence":"high"|"medium"|"low",' +
      '"summary":string,"runs":[{"brand":string,"flavor":string,"dieType":string,' +
      '"casesNeeded":number,"rationale":string}]}|null,"note":string}. ' +
      `Provide at most ${FORECAST_MAX_RUNS_OUT} runs, ordered in a sensible production ` +
      "sequence. Use brand/flavor names EXACTLY as they appear in the history. " +
      "casesNeeded is a rough whole-number target grounded in the typical volumes above. " +
      'rationale is one short sentence tying the run to the history (e.g. "runs most ' +
      'Tuesdays, ~300 cases"). summary is a plain-language overview that names the ' +
      "confidence level and any caveats. " +
      'If the history is too thin or inconsistent to predict responsibly, set ' +
      '"forecast" to null and put a short, honest explanation in "note".',
  );

  return { system, user: lines.join("\n") };
}
