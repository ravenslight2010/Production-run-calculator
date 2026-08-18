// @vitest-environment node
//
// Mobile RunContext — dough-timer pause / resume correctness.
//
// Loads the production applySuppress / applyResume helpers from
// _archived/mobile/utils/autoTrackTimers.ts via typescript.transpileModule +
// new Function(), bypassing Vite's tsconfig resolution (which cannot find
// expo/tsconfig.base in the web vitest context). The test therefore exercises
// the REAL production code, not an inline replica.
//
// The tray-consumption tick (RunContext.tsx:4653-4696) is exercised through a
// minimal inline replica clearly labelled as such, since the full auto-track
// useEffect cannot be imported without the RN graph. Its job is only to apply
// the refs that applyResume() mutates and confirm the no-jump property.
//
// Web reference: useAutoTrack.pauseResume.test.ts test 4 (isDoughTimerPaused).
// Production file: _archived/mobile/utils/autoTrackTimers.ts

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ── Load production functions via transpile (avoids Expo tsconfig) ─────────

const here = path.dirname(fileURLToPath(import.meta.url));
const TIMERS_FILE = path.resolve(
  here,
  "../../../../../_archived/mobile/utils/autoTrackTimers.ts",
);

// The interface is duplicated here so TypeScript can type the test correctly.
// The REAL shape lives in autoTrackTimers.ts and is what's tested below.
interface AutoTrackRefs {
  autoSuppressRef:   { current: number };
  caseNextDueMsRef:  { current: number };
  trayNextDueMsRef:  { current: number };
  batchNextDueMsRef: { current: number };
  trayLastMsRef:     { current: number };
  batchLastMsRef:    { current: number };
}

let applySuppress: (refs: AutoTrackRefs, nowMs: number) => number;
let applyResume:   (refs: AutoTrackRefs) => 0;

beforeAll(() => {
  const source = fs.readFileSync(TIMERS_FILE, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module:            ts.ModuleKind.CommonJS,
      target:            ts.ScriptTarget.ES2020,
      removeComments:    false,
      strict:            false,
    },
  });
  const exports: Record<string, unknown> = {};
  // Execute the transpiled CommonJS module in an isolated scope.
  // eslint-disable-next-line no-new-func
  new Function("exports", outputText)(exports);
  applySuppress = exports["applySuppress"] as typeof applySuppress;
  applyResume   = exports["applyResume"]   as typeof applyResume;
  if (typeof applySuppress !== "function" || typeof applyResume !== "function") {
    throw new Error(
      "autoTrackTimers.ts must export applySuppress and applyResume — " +
      "check that the functions are exported correctly.",
    );
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRefs(): AutoTrackRefs {
  return {
    autoSuppressRef:   { current: 0 },
    caseNextDueMsRef:  { current: 0 },
    trayNextDueMsRef:  { current: 0 },
    batchNextDueMsRef: { current: 0 },
    trayLastMsRef:     { current: 0 },
    batchLastMsRef:    { current: 0 },
  };
}

// ── Inline replica of the tray consumption tick ────────────────────────────
// Mirrors RunContext.tsx:4653-4696 (tray cadence block).
// Only used to confirm the no-jump property that results from applyResume()
// zeroing trayLastMsRef. The suppress/resume assertions use the real functions.
function clampAutoPeriodMs(ms: number): number {
  return Math.max(500, Math.min(ms, 300_000));
}

function runTrayTick(
  refs: Pick<AutoTrackRefs, "autoSuppressRef" | "trayLastMsRef" | "trayNextDueMsRef">,
  nowMs: number,
  traysOnLine: number,
  ppm: number,
  perTray: number,
  doughFeedComplete: boolean,
): number {
  const suppressed = nowMs < refs.autoSuppressRef.current;
  if (perTray <= 0 || nowMs < refs.trayNextDueMsRef.current) return traysOnLine;

  const trayPeriodMs = clampAutoPeriodMs((perTray / ppm) * 60_000);
  const prevMs = refs.trayLastMsRef.current;
  const durationMin =
    prevMs > 0
      ? Math.min((trayPeriodMs * 2) / 60_000, (nowMs - prevMs) / 60_000)
      : trayPeriodMs / 60_000; // first tick → assume one full period

  refs.trayNextDueMsRef.current = nowMs + trayPeriodMs;
  refs.trayLastMsRef.current    = nowMs;

  if (!suppressed && !doughFeedComplete) {
    const consumed = Math.floor((durationMin * ppm) / perTray);
    if (consumed > 0) return Math.max(0, traysOnLine - consumed);
  }
  return traysOnLine;
}

// ── Constants ──────────────────────────────────────────────────────────────
// ppm=100, perTray=200  →  TRAY_PERIOD_MS = (200/100)*60 000 = 120 000 ms
const PPM          = 100;
const PER_TRAY     = 200;
const TRAY_PERIOD_MS = 120_000;
const T0           = 1_600_000_000_000;

// ── Tests ──────────────────────────────────────────────────────────────────
describe("mobile RunContext — applySuppress / applyResume (dough-timer pause / resume)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. applyResume clears autoSuppressRef and returns 0.
  //    This is the direct mobile equivalent of the web assertion:
  //      expect(result.current.isDoughTimerPaused).toBe(false)
  // ──────────────────────────────────────────────────────────────────────────
  it("1. applyResume clears autoSuppressRef — isDoughTimerPaused becomes false", () => {
    const refs = makeRefs();

    // Initially not suppressed.
    expect(refs.autoSuppressRef.current).toBe(0);
    expect(Date.now() < refs.autoSuppressRef.current).toBe(false);

    // applySuppress sets a 60-second window and returns the new until value.
    const until = applySuppress(refs, Date.now());
    expect(until).toBeGreaterThan(Date.now());
    expect(refs.autoSuppressRef.current).toBe(until);
    expect(Date.now() < refs.autoSuppressRef.current).toBe(true); // suppressed

    // applyResume clears it; return value is the new autoSuppressUntil for setState.
    const newUntil = applyResume(refs);
    expect(newUntil).toBe(0);
    expect(refs.autoSuppressRef.current).toBe(0);
    expect(Date.now() < refs.autoSuppressRef.current).toBe(false); // not suppressed
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. applyResume zeros trayLastMsRef and trayNextDueMsRef so the first
  //    post-resume tray tick uses ONE period's duration, not the accumulated
  //    pause span — preventing the "jump" in traysOnLine.
  //
  //    Without zeroing trayLastMsRef, prevMs would hold the pre-pause
  //    timestamp.  Elapsed ≈ TRAY_PERIOD_MS+1 ms, capped at 2 periods (4 min)
  //    → 2 trays consumed instead of 1.
  // ──────────────────────────────────────────────────────────────────────────
  it("2. tray ticks are suppressed while paused and resume without a jump after applyResume()", () => {
    const refs = makeRefs();
    let trays = 5;

    // ── Tick 1 at T0 ──────────────────────────────────────────────────────
    // nextDueMsRef=0 → fires immediately; prevMs=0 → 1 period → 1 tray down.
    // trays: 5→4.  trayLastMsRef ← T0.  trayNextDueMsRef ← T0+TRAY_PERIOD_MS.
    trays = runTrayTick(refs, T0, trays, PPM, PER_TRAY, false);
    expect(trays).toBe(4);
    expect(refs.trayLastMsRef.current).toBe(T0);

    // ── Suppress when the next tick is overdue ─────────────────────────────
    // tPause is just past TRAY_PERIOD_MS, so the tick cadence has elapsed and
    // the tick would fire — but suppression gates the write.
    const tPause = T0 + TRAY_PERIOD_MS + 1;
    vi.setSystemTime(tPause);
    applySuppress(refs, tPause);

    trays = runTrayTick(refs, tPause, trays, PPM, PER_TRAY, false);
    expect(trays).toBe(4); // write suppressed

    // ── applyResume: production function must zero all timing refs ─────────
    const returned = applyResume(refs);
    expect(returned).toBe(0);                          // new autoSuppressUntil
    expect(refs.autoSuppressRef.current).toBe(0);     // suppression cleared
    expect(refs.trayLastMsRef.current).toBe(0);       // zeroed — no stale prevMs
    expect(refs.trayNextDueMsRef.current).toBe(0);    // zeroed — fires immediately

    // ── First post-resume tick ─────────────────────────────────────────────
    // trayNextDueMsRef=0  → fires immediately.
    // trayLastMsRef=0     → prevMs=0 → durationMin = 1 period (2 min).
    // consumed = floor(2*100/200) = 1 → 4→3.  NOT 2 (no jump).
    const tResume = tPause + 2;
    vi.setSystemTime(tResume);
    const before = trays; // 4
    trays = runTrayTick(refs, tResume, trays, PPM, PER_TRAY, false);

    expect(before - trays).toBe(1); // exactly one period consumed
    expect(trays).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. applyResume zeros every ref (case, tray, batch — last-tick and next-due)
  //    so all counters re-baseline fresh on the next tick.
  // ──────────────────────────────────────────────────────────────────────────
  it("3. applyResume zeros all six timing refs unconditionally", () => {
    const refs = makeRefs();

    // Populate all refs with non-zero sentinel values.
    refs.autoSuppressRef.current   = T0 + 60_000;
    refs.caseNextDueMsRef.current  = T0 + 5_000;
    refs.trayNextDueMsRef.current  = T0 + 120_000;
    refs.batchNextDueMsRef.current = T0 + 30_000;
    refs.trayLastMsRef.current     = T0 + 1_000;
    refs.batchLastMsRef.current    = T0 + 2_000;

    const result = applyResume(refs);

    expect(result).toBe(0);
    expect(refs.autoSuppressRef.current).toBe(0);
    expect(refs.caseNextDueMsRef.current).toBe(0);
    expect(refs.trayNextDueMsRef.current).toBe(0);
    expect(refs.batchNextDueMsRef.current).toBe(0);
    expect(refs.trayLastMsRef.current).toBe(0);
    expect(refs.batchLastMsRef.current).toBe(0);
  });
});
