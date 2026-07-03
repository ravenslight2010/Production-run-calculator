// Downtime trends + stall detection — pure, deterministic, shared logic.
//
// Aggregates the stoppages recorded on runs across a window of days (the
// client's synced 14-day history plus today) into a trends summary, and
// provides the stall-detection decision the live "line looks stalled" nudge is
// built on. No I/O, no Date.now() — callers pass `nowMs` — so every branch is
// unit-testable.

export type StoppageIn = {
  reason?: string;
  startedAt: number;
  endedAt?: number | null;
  type?: string;
};

export type RunIn = {
  brand?: string;
  flavor?: string;
  stoppages?: StoppageIn[] | null;
  mergedAway?: boolean;
};

export type DayIn = {
  date: string; // ISO YYYY-MM-DD
  runs: RunIn[];
};

export type BucketOut = { key: string; minutes: number; count: number };
export type DayOut = { date: string; minutes: number; count: number };
export type LongestOut = {
  date: string;
  runLabel: string;
  reason: string;
  minutes: number;
};

export type DowntimeTrendsOut = {
  /** Oldest → newest, one entry per input day (including zero-downtime days). */
  days: DayOut[];
  totalMinutes: number;
  totalCount: number;
  /** Days in the window that had at least one counted stoppage. */
  daysWithDowntime: number;
  byType: BucketOut[];
  byRun: BucketOut[];
  byHour: BucketOut[]; // key = "0".."23" (local hour via tzOffsetMin), only non-zero hours
  topReasons: BucketOut[];
  longest: LongestOut[];
};

// A stoppage someone forgot to end would otherwise dominate every chart; a
// single stoppage longer than this is clamped (open stoppages are first capped
// at `nowMs`).
export const MAX_SINGLE_STOPPAGE_MS = 12 * 60 * 60 * 1000;
export const TOP_REASONS_LIMIT = 6;
export const LONGEST_LIMIT = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normReason(raw: string | undefined): string {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s.length ? s : "(no reason given)";
}

function normType(raw: string | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  return s.length ? s : "other";
}

function runLabel(run: RunIn): string {
  const label = [run.brand?.trim(), run.flavor?.trim()].filter(Boolean).join(" ");
  return label.length ? label : "(no brand)";
}

/** Clamped duration in ms for one stoppage; 0 when unusable. */
export function stoppageDurationMs(s: StoppageIn, nowMs: number): number {
  if (!Number.isFinite(s.startedAt) || s.startedAt <= 0) return 0;
  const rawEnd = s.endedAt != null && Number.isFinite(s.endedAt) ? s.endedAt : nowMs;
  const dur = rawEnd - s.startedAt;
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  return Math.min(dur, MAX_SINGLE_STOPPAGE_MS);
}

function toMinutes(ms: number): number {
  return Math.round(ms / 60000);
}

function bumpBucket(map: Map<string, { minutes: number; count: number }>, key: string, ms: number): void {
  const cur = map.get(key) ?? { minutes: 0, count: 0 };
  cur.minutes += ms; // accumulate in ms, round once at the end
  cur.count += 1;
  map.set(key, cur);
}

function bucketsOut(map: Map<string, { minutes: number; count: number }>): BucketOut[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, minutes: toMinutes(v.minutes), count: v.count }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count || a.key.localeCompare(b.key));
}

// Reasons are free text, so "Jam at wrapper" and "jam at wrapper" must land in
// ONE bucket: group case-insensitively, display the first spelling seen.
function bumpLabeled(
  map: Map<string, { label: string; minutes: number; count: number }>,
  label: string,
  ms: number,
): void {
  const k = label.toLowerCase();
  const cur = map.get(k) ?? { label, minutes: 0, count: 0 };
  cur.minutes += ms;
  cur.count += 1;
  map.set(k, cur);
}

function labeledOut(
  map: Map<string, { label: string; minutes: number; count: number }>,
): BucketOut[] {
  return [...map.values()]
    .map((v) => ({ key: v.label, minutes: toMinutes(v.minutes), count: v.count }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Aggregate the stoppages across `days` into a trends summary.
 *
 * `tzOffsetMin` is JS `Date#getTimezoneOffset()` semantics (minutes to ADD to
 * local time to reach UTC — positive west of UTC), so hour-of-day buckets land
 * in the caller's local clock no matter where this runs.
 */
export function aggregateDowntime(
  days: ReadonlyArray<DayIn>,
  opts: { nowMs: number; tzOffsetMin?: number },
): DowntimeTrendsOut {
  const nowMs = opts.nowMs;
  const tzOffsetMin = opts.tzOffsetMin ?? 0;

  const seenDates = new Set<string>();
  const dayRows: Array<{ date: string; ms: number; count: number }> = [];
  const byType = new Map<string, { minutes: number; count: number }>();
  const byRun = new Map<string, { minutes: number; count: number }>();
  const byHour = new Map<string, { minutes: number; count: number }>();
  const byReason = new Map<string, { label: string; minutes: number; count: number }>();
  const longest: LongestOut[] = [];

  let totalMs = 0;
  let totalCount = 0;

  for (const day of days) {
    if (!ISO_DATE.test(day.date) || seenDates.has(day.date)) continue;
    seenDates.add(day.date);
    let dayMs = 0;
    let dayCount = 0;

    for (const run of day.runs ?? []) {
      if (run.mergedAway) continue;
      for (const s of run.stoppages ?? []) {
        const ms = stoppageDurationMs(s, nowMs);
        if (ms <= 0) continue;
        dayMs += ms;
        dayCount += 1;
        totalMs += ms;
        totalCount += 1;
        bumpBucket(byType, normType(s.type), ms);
        bumpBucket(byRun, runLabel(run), ms);
        bumpLabeled(byReason, normReason(s.reason), ms);
        const localHour = new Date(s.startedAt - tzOffsetMin * 60000).getUTCHours();
        bumpBucket(byHour, String(localHour), ms);
        longest.push({
          date: day.date,
          runLabel: runLabel(run),
          reason: normReason(s.reason),
          minutes: toMinutes(ms),
        });
      }
    }
    dayRows.push({ date: day.date, ms: dayMs, count: dayCount });
  }

  dayRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  longest.sort((a, b) => b.minutes - a.minutes || (a.date < b.date ? 1 : -1));

  const hourBuckets = [...byHour.entries()]
    .map(([key, v]) => ({ key, minutes: toMinutes(v.minutes), count: v.count }))
    .sort((a, b) => Number(a.key) - Number(b.key));

  return {
    days: dayRows.map((d) => ({ date: d.date, minutes: toMinutes(d.ms), count: d.count })),
    totalMinutes: toMinutes(totalMs),
    totalCount,
    daysWithDowntime: dayRows.filter((d) => d.count > 0).length,
    byType: bucketsOut(byType),
    byRun: bucketsOut(byRun),
    byHour: hourBuckets,
    topReasons: labeledOut(byReason).slice(0, TOP_REASONS_LIMIT),
    longest: longest.slice(0, LONGEST_LIMIT),
  };
}

// ── Stall detection ──────────────────────────────────────────────────────────
//
// The live pace math already computes expected cases from the run's rate:
//   expectedCases = floor((ppm * elapsedMinAfterTunnel) / pizzasPerCase)
// A stall is "the reported progress is N+ minutes behind what the line should
// have produced, while the run is RUNNING, has a real rate, and nobody has an
// open stoppage logged". Advisory only — the caller shows a nudge; nothing is
// written automatically.
//
// Known blind spot (accepted): with auto-track ON the counters self-advance at
// the expected pace, so this detector only sees stalls when staff-maintained
// counts fall behind (auto-track off, or a manual correction downward).

export const STALL_DEFAULT_THRESHOLD_MIN = 10;

export type StallInput = {
  running: boolean;
  hasOpenStoppage: boolean;
  ppm: number;
  pizzasPerCase: number;
  elapsedMinAfterTunnel: number;
  casesCompleted: number;
  thresholdMin?: number;
};

export type StallResult = { stalled: boolean; behindMinutes: number };

/**
 * Same decision, but fed from an already-computed pace delta (cases ahead(+)
 * / behind(−) of expected) — matches the web pace gauge's `paceDelta`.
 */
export function detectStallFromDelta(input: {
  running: boolean;
  hasOpenStoppage: boolean;
  ppm: number;
  pizzasPerCase: number;
  paceDelta: number;
  thresholdMin?: number;
}): StallResult {
  const threshold = input.thresholdMin ?? STALL_DEFAULT_THRESHOLD_MIN;
  if (
    !input.running ||
    input.hasOpenStoppage ||
    !(input.ppm > 0) ||
    !(input.pizzasPerCase > 0) ||
    !Number.isFinite(input.paceDelta) ||
    input.paceDelta >= 0
  ) {
    return { stalled: false, behindMinutes: 0 };
  }
  const behindMinutes = (-input.paceDelta * input.pizzasPerCase) / input.ppm;
  return { stalled: behindMinutes >= threshold, behindMinutes: Math.round(behindMinutes) };
}

export function detectStall(input: StallInput): StallResult {
  const threshold = input.thresholdMin ?? STALL_DEFAULT_THRESHOLD_MIN;
  if (
    !input.running ||
    input.hasOpenStoppage ||
    !(input.ppm > 0) ||
    !(input.pizzasPerCase > 0) ||
    !Number.isFinite(input.elapsedMinAfterTunnel) ||
    input.elapsedMinAfterTunnel <= 0
  ) {
    return { stalled: false, behindMinutes: 0 };
  }
  const expectedCases = Math.floor((input.ppm * input.elapsedMinAfterTunnel) / input.pizzasPerCase);
  const behindCases = expectedCases - Math.max(0, input.casesCompleted);
  if (behindCases <= 0) return { stalled: false, behindMinutes: 0 };
  const behindMinutes = (behindCases * input.pizzasPerCase) / input.ppm;
  return { stalled: behindMinutes >= threshold, behindMinutes: Math.round(behindMinutes) };
}
