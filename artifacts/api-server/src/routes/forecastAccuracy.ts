import { AiForecastAccuracyBody } from "@workspace/api-zod";
import type { FacilityKnowledge } from "@workspace/ai-memory";
import * as z from "zod";
import type { ForecastConfidence, ForecastPlanOut } from "./aiForecast";

// Forecast-accuracy review. Compares previously-recorded demand forecasts (kept
// in shared facility memory under domain "forecast", key `plan:<date>`) against
// the actual finished production history the client supplies for those dates.
//
// Design posture mirrors the other AI endpoints: all the comparison lives
// server-side as pure, deterministic, testable functions so both clients stay
// thin and identical. Unlike /ai/forecast this needs NO AI call — grading a
// past prediction against what actually ran is just arithmetic. The recorded
// forecast facts are the only source the client can't see, so the server reads
// and parses them and returns the finished comparison.

// Bound how many runs the body can carry (mirrors the forecast guard) and how
// many dated reviews we return so one request can't blow up.
export const ACCURACY_MAX_TOTAL_RUNS = 600;
export const ACCURACY_MAX_REVIEWS = 60;
// A predicted vs. actual case count is a "hit" when within this fraction of the
// larger of the two (forecasts are rough targets, never exact).
export const ACCURACY_HIT_TOLERANCE = 0.1;

export type ForecastAccuracyInput = z.infer<typeof AiForecastAccuracyBody>;

export type ProductStatus = "hit" | "over" | "under" | "missed" | "unexpected";

export type ForecastAccuracyProductOut = {
  label: string;
  predictedCases: number;
  actualCases: number;
  status: ProductStatus;
};

export type ForecastAccuracyReviewOut = {
  date: string;
  confidence: ForecastConfidence;
  predictedTotalCases: number;
  actualTotalCases: number;
  caseAccuracyPct: number;
  products: ForecastAccuracyProductOut[];
};

// A product the forecast has consistently mis-predicted across several reviewed
// days. `daysOver`/`daysUnder` count the days it landed in that status and
// `daysScored` is how many reviewed days the product appeared in at all, so the
// UI can say "over-predicted 3 of 4 days".
export type AccuracyTrendProductOut = {
  label: string;
  daysOver: number;
  daysUnder: number;
  daysScored: number;
};

// Rolling, cross-day calibration signal: average case accuracy over the reviewed
// days plus the products that are chronically over- or under-predicted. Turns the
// per-day reviews into a "is forecasting improving / where does it keep missing"
// summary.
export type AccuracyTrendOut = {
  daysScored: number;
  averageCaseAccuracyPct: number;
  chronicOver: AccuracyTrendProductOut[];
  chronicUnder: AccuracyTrendProductOut[];
};

export type ForecastAccuracyValidationResult =
  | { ok: true; data: ForecastAccuracyInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/forecast-accuracy.
export function validateForecastAccuracyBody(body: unknown): ForecastAccuracyValidationResult {
  const parsed = AiForecastAccuracyBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const totalRuns = data.history.reduce((acc, d) => acc + d.runs.length, 0);
  if (totalRuns > ACCURACY_MAX_TOTAL_RUNS) {
    return { ok: false, status: 400, error: `Too many runs (max ${ACCURACY_MAX_TOTAL_RUNS})` };
  }
  return { ok: true, data };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Canonical, human-readable text we store a produced forecast as in facility
// memory. Kept here so the write side (recording a forecast) and the read side
// (parsing it back for accuracy) share ONE format and can never drift — the
// round-trip is covered by tests.
export function formatForecastFact(forecast: ForecastPlanOut): string {
  const products = forecast.runs
    .map((r) => {
      const label = [r.brand.trim(), r.flavor.trim()].filter(Boolean).join(" ");
      const cases = Math.max(0, Math.round(r.casesNeeded));
      return `${label} (~${cases}cs)`;
    })
    .join(", ");
  return `Forecast for ${forecast.targetDate} [${forecast.confidence} confidence]: ${products}.`;
}

export type ParsedForecast = {
  date: string;
  confidence: ForecastConfidence;
  products: Array<{ label: string; cases: number }>;
};

function normLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapConfidence(raw: string | undefined): ForecastConfidence {
  const c = (raw ?? "").trim().toLowerCase();
  if (c === "high") return "high";
  if (c === "low") return "low";
  return "medium";
}

// Parse a stored facility-knowledge entry back into a structured forecast. Only
// `plan:<date>` entries are forecasts; everything else (incl. our own
// `accuracy:<date>` notes) returns null. Tolerant of a truncated tail: it scans
// for every "<label> (~<n>cs)" pair after the "]: " marker, so a fact that was
// length-capped mid-list still yields the products that survived.
export function parseForecastFact(entry: {
  key: string;
  fact: string;
}): ParsedForecast | null {
  const key = entry.key.trim();
  if (!key.toLowerCase().startsWith("plan:")) return null;
  const date = key.slice("plan:".length).trim();
  if (!ISO_DATE.test(date)) return null;

  const fact = entry.fact ?? "";
  const confMatch = /\[(high|medium|low) confidence\]/i.exec(fact);
  const confidence = mapConfidence(confMatch?.[1]);

  const sepIdx = fact.indexOf("]: ");
  const productsText = sepIdx >= 0 ? fact.slice(sepIdx + 3) : fact;

  const products: Array<{ label: string; cases: number }> = [];
  const seen = new Set<string>();
  const re = /([^,]+?)\s*\(~(\d+)cs\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(productsText)) !== null) {
    const label = m[1].trim();
    const cases = Number(m[2]);
    if (!label || !Number.isFinite(cases)) continue;
    const k = normLabel(label);
    if (seen.has(k)) continue;
    seen.add(k);
    products.push({ label, cases });
  }
  return { date, confidence, products };
}

export type ActualDay = {
  date: string;
  products: Map<string, { label: string; cases: number }>;
  totalCases: number;
};

// Roll up one actual finished day into per-product case totals keyed by a
// normalized brand+flavor label (so the same product split across runs sums).
export function summarizeActualDay(day: {
  date: string;
  runs: Array<{ brand: string; flavor: string; cases: number }>;
}): ActualDay {
  const products = new Map<string, { label: string; cases: number }>();
  let totalCases = 0;
  for (const run of day.runs) {
    const label = [run.brand.trim(), run.flavor.trim()].filter(Boolean).join(" ");
    if (!label) continue;
    const cases = Math.max(0, Math.round(run.cases));
    totalCases += cases;
    const k = normLabel(label);
    const existing = products.get(k);
    if (existing) existing.cases += cases;
    else products.set(k, { label, cases });
  }
  return { date: day.date, products, totalCases };
}

// 0–100 closeness of a predicted total to an actual total. Equal totals (incl.
// both zero) score 100; the score falls linearly with the relative gap.
export function caseAccuracyPct(predicted: number, actual: number): number {
  const base = Math.max(predicted, actual);
  if (base <= 0) return 100;
  const pct = 100 * (1 - Math.abs(predicted - actual) / base);
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function productStatus(predicted: number, actual: number): ProductStatus {
  if (predicted > 0 && actual === 0) return "missed";
  if (predicted === 0 && actual > 0) return "unexpected";
  const tol = Math.max(1, Math.ceil(ACCURACY_HIT_TOLERANCE * Math.max(predicted, actual)));
  if (Math.abs(predicted - actual) <= tol) return "hit";
  return predicted > actual ? "over" : "under";
}

// Grade one parsed forecast against one actual day. Unions predicted and actual
// products so misses (predicted, didn't run) and surprises (ran, not predicted)
// both surface. Products are ordered predicted-first by predicted volume, then
// the unexpected ones by actual volume.
export function compareForecastToActual(
  forecast: ParsedForecast,
  actual: ActualDay,
): ForecastAccuracyReviewOut {
  const predicted = new Map<string, { label: string; cases: number }>();
  for (const p of forecast.products) {
    const k = normLabel(p.label);
    const existing = predicted.get(k);
    if (existing) existing.cases += p.cases;
    else predicted.set(k, { label: p.label, cases: p.cases });
  }

  const keys = new Set<string>([...predicted.keys(), ...actual.products.keys()]);
  const products: ForecastAccuracyProductOut[] = [];
  let predictedTotal = 0;
  for (const k of keys) {
    const pred = predicted.get(k);
    const act = actual.products.get(k);
    const predictedCases = pred?.cases ?? 0;
    const actualCases = act?.cases ?? 0;
    predictedTotal += predictedCases;
    products.push({
      label: pred?.label ?? act?.label ?? "",
      predictedCases,
      actualCases,
      status: productStatus(predictedCases, actualCases),
    });
  }

  products.sort(
    (a, b) =>
      b.predictedCases - a.predictedCases ||
      b.actualCases - a.actualCases ||
      a.label.localeCompare(b.label),
  );

  return {
    date: forecast.date,
    confidence: forecast.confidence,
    predictedTotalCases: predictedTotal,
    actualTotalCases: actual.totalCases,
    caseAccuracyPct: caseAccuracyPct(predictedTotal, actual.totalCases),
    products,
  };
}

// Combine recorded forecast facts with actual finished history into per-date
// reviews. Only dates that BOTH were forecast AND have finished actual runs
// produce a review (you can't grade a forecast for a day that hasn't run).
// Newest first, capped at ACCURACY_MAX_REVIEWS.
export function buildForecastReviews(
  knowledge: ReadonlyArray<FacilityKnowledge>,
  history: ReadonlyArray<{
    date: string;
    runs: Array<{ brand: string; flavor: string; cases: number }>;
  }>,
): ForecastAccuracyReviewOut[] {
  const actualByDate = new Map<string, ActualDay>();
  for (const day of history) {
    if (!ISO_DATE.test(day.date)) continue;
    const summary = summarizeActualDay(day);
    if (summary.products.size === 0) continue;
    actualByDate.set(day.date, summary);
  }

  const reviews: ForecastAccuracyReviewOut[] = [];
  const seenDates = new Set<string>();
  for (const entry of knowledge) {
    if (entry.domain.trim().toLowerCase() !== "forecast") continue;
    const parsed = parseForecastFact(entry);
    if (!parsed) continue;
    if (seenDates.has(parsed.date)) continue;
    const actual = actualByDate.get(parsed.date);
    if (!actual) continue;
    seenDates.add(parsed.date);
    reviews.push(compareForecastToActual(parsed, actual));
  }

  reviews.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return reviews.slice(0, ACCURACY_MAX_REVIEWS);
}

// A product must land in the same mis-prediction direction on at least this many
// reviewed days before we flag it as a chronic miss (one bad day is noise).
export const CHRONIC_MIN_DAYS = 2;

// Roll the per-day reviews up into a cross-day calibration summary: average case
// accuracy over the reviewed days, the count of days scored, and the products
// that keep landing on the same wrong side (over- vs. under-predicted). Pure and
// deterministic so it's covered by unit tests alongside the rest of the scoring.
export function summarizeAccuracyTrend(
  reviews: ReadonlyArray<ForecastAccuracyReviewOut>,
): AccuracyTrendOut {
  const daysScored = reviews.length;
  const averageCaseAccuracyPct =
    daysScored === 0
      ? 0
      : Math.round(reviews.reduce((acc, r) => acc + r.caseAccuracyPct, 0) / daysScored);

  type Agg = { label: string; daysOver: number; daysUnder: number; daysSeen: number };
  const byLabel = new Map<string, Agg>();
  for (const rev of reviews) {
    for (const p of rev.products) {
      const k = normLabel(p.label);
      if (!k) continue;
      let agg = byLabel.get(k);
      if (!agg) {
        agg = { label: p.label, daysOver: 0, daysUnder: 0, daysSeen: 0 };
        byLabel.set(k, agg);
      }
      agg.daysSeen += 1;
      if (p.status === "over") agg.daysOver += 1;
      else if (p.status === "under") agg.daysUnder += 1;
    }
  }

  const chronicOver: AccuracyTrendProductOut[] = [];
  const chronicUnder: AccuracyTrendProductOut[] = [];
  for (const agg of byLabel.values()) {
    const out: AccuracyTrendProductOut = {
      label: agg.label,
      daysOver: agg.daysOver,
      daysUnder: agg.daysUnder,
      daysScored: agg.daysSeen,
    };
    if (agg.daysOver >= CHRONIC_MIN_DAYS && agg.daysOver > agg.daysUnder) {
      chronicOver.push(out);
    } else if (agg.daysUnder >= CHRONIC_MIN_DAYS && agg.daysUnder > agg.daysOver) {
      chronicUnder.push(out);
    }
  }
  chronicOver.sort((a, b) => b.daysOver - a.daysOver || a.label.localeCompare(b.label));
  chronicUnder.sort((a, b) => b.daysUnder - a.daysUnder || a.label.localeCompare(b.label));

  return { daysScored, averageCaseAccuracyPct, chronicOver, chronicUnder };
}

// One-line accuracy fact we record back to facility memory (best-effort) so
// future forecast prompts are grounded in how the last prediction actually did.
export function formatAccuracyFact(review: ForecastAccuracyReviewOut): string {
  return (
    `Forecast accuracy for ${review.date}: predicted ${review.predictedTotalCases}cs vs ` +
    `actual ${review.actualTotalCases}cs (${review.caseAccuracyPct}% case accuracy, ` +
    `${review.confidence} confidence).`
  );
}
