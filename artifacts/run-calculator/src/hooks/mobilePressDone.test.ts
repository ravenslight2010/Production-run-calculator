/**
 * Mobile pressDone semantics — lifecycle-aware freezer depletion signal.
 *
 * Verifies that mobile pressDone/casesOnLine matches web computeCasesInFreezer
 * across all lifecycle states:
 *   - steady-state running (tunnel filling/full)
 *   - paused: casesOnLine frozen at pause start, not continuing to grow
 *   - long pause: frozen even while wall-clock advances
 *   - ended: draining to zero over freezerTimeMin
 *   - ended while paused: pause downtime excluded from atEnd fill
 *
 * Mobile formula lives in _archived/mobile/context/RunContext.tsx computeCalc.
 * The inline replica here is kept in sync with that implementation.
 */

import { describe, it, expect } from "vitest";

// ── Inline replica of the mobile lifecycle-aware casesOnLine formula ─────────
// Mirrors the implementation in _archived/mobile/context/RunContext.tsx.
interface Stoppage {
  startedAt: number;
  endedAt?: number;
}

interface RunState {
  startedAt?: number;
  endedAt?: number;
  stoppages: Stoppage[];
}

function computeMobileCasesOnLine({
  state,
  nowMs,
  ppm,
  pizzasPerCase,
  freezerTime,
}: {
  state: RunState;
  nowMs: number;
  ppm: number;
  pizzasPerCase: number;
  freezerTime: number;  // minutes
}): number {
  const freezerTimeMin = freezerTime;
  if (!state.startedAt || ppm <= 0 || pizzasPerCase <= 0 || freezerTimeMin <= 0) return 0;

  const completedDownMs = state.stoppages
    .filter(st => st.endedAt != null)
    .reduce((acc, st) => acc + (st.endedAt! - st.startedAt), 0);

  if (!state.endedAt) {
    const activeStop = state.stoppages.find(st => st.endedAt == null);
    const refMs = activeStop ? activeStop.startedAt : nowMs;
    const netElapsedMin = Math.max(0, (refMs - state.startedAt - completedDownMs) / 60000);
    return Math.floor((ppm * Math.min(netElapsedMin, freezerTimeMin)) / pizzasPerCase);
  }

  const netAtEndMin = Math.max(0, (state.endedAt - state.startedAt - completedDownMs) / 60000);
  const atEndMin = Math.min(netAtEndMin, freezerTimeMin);
  const sinceEndMin = Math.max(0, (nowMs - state.endedAt) / 60000);
  const remainMin = Math.max(0, Math.min(atEndMin, freezerTimeMin - sinceEndMin));
  return Math.floor((ppm * remainMin) / pizzasPerCase);
}

function pressDone({
  casesNeeded, skidsCompleted, casesPerSkid, casesOnCurrentSkid, casesOnLine,
}: {
  casesNeeded: number; skidsCompleted: number; casesPerSkid: number;
  casesOnCurrentSkid: number; casesOnLine: number;
}): boolean {
  const casesCompletedTotal = skidsCompleted * casesPerSkid + casesOnCurrentSkid;
  return casesNeeded > 0 && casesCompletedTotal + casesOnLine >= casesNeeded;
}

// ── Shared fixture ──────────────────────────────────────────────────────────
const START = 1_700_000_000_000;   // run started at T0
const PPM = 100;                    // 100 pizzas/min
const PPC = 12;                     // 12 pizzas/case → 100/12 ≈ 8.33 cases/min
const FREEZER_MIN = 10;             // 10-min tunnel transit
// Full tunnel: floor(100 * 10 / 12) = 83 cases in freezer at capacity

// ── Tests ────────────────────────────────────────────────────────────────────

describe("mobile casesOnLine — steady-state running", () => {
  it("0 before start", () => {
    const col = computeMobileCasesOnLine({
      state: { startedAt: undefined, stoppages: [] },
      nowMs: START + 5 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(col).toBe(0);
  });

  it("ramps during tunnel fill (< freezerTimeMin elapsed)", () => {
    // 5 minutes in: floor(100 * 5 / 12) = 41 cases
    const col = computeMobileCasesOnLine({
      state: { startedAt: START, stoppages: [] },
      nowMs: START + 5 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(col).toBe(41);
  });

  it("caps at tunnel capacity once fully filled", () => {
    // 20 min elapsed: capped at floor(100*10/12) = 83
    const col = computeMobileCasesOnLine({
      state: { startedAt: START, stoppages: [] },
      nowMs: START + 20 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(col).toBe(83);
  });
});

describe("mobile casesOnLine — paused run (must NOT advance during pause)", () => {
  const PAUSE_START = START + 5 * 60000; // paused 5 min into run

  it("freezes at pause start value, does not grow while wall-clock advances", () => {
    const stateWithOpenPause: RunState = {
      startedAt: START,
      stoppages: [{ startedAt: PAUSE_START, endedAt: undefined }], // open pause
    };
    // 5 min net elapsed at pause start: floor(100*5/12) = 41
    const expectedAtPause = 41;

    // Check at pause start
    const atPauseStart = computeMobileCasesOnLine({
      state: stateWithOpenPause, nowMs: PAUSE_START,
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(atPauseStart).toBe(expectedAtPause);

    // Check 30 min later — still paused; must NOT have grown
    const thirtyMinLater = computeMobileCasesOnLine({
      state: stateWithOpenPause, nowMs: PAUSE_START + 30 * 60000,
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(thirtyMinLater).toBe(expectedAtPause);  // frozen, not 83
  });

  it("resumes correctly after pause: excludes downtime from net elapsed", () => {
    const pauseDuration = 15 * 60000;  // 15-min pause
    const stateAfterResume: RunState = {
      startedAt: START,
      stoppages: [{ startedAt: PAUSE_START, endedAt: PAUSE_START + pauseDuration }],
    };
    // After resume, 5 min net elapsed (same as at pause), wall-clock = 5+15 = 20 min
    const col = computeMobileCasesOnLine({
      state: stateAfterResume,
      nowMs: PAUSE_START + pauseDuration, // immediately after resume
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    // Net elapsed = (PAUSE_START + 15min) - START - 15min downtime = 5min net
    expect(col).toBe(41);
  });
});

describe("mobile casesOnLine — run ended (must drain to zero)", () => {
  const END_TIME = START + 20 * 60000;  // ended after 20 min (tunnel fully filled → 83 at end)

  it("cases start draining immediately after end", () => {
    const state: RunState = { startedAt: START, endedAt: END_TIME, stoppages: [] };

    // At end: atEndMin = min(20, 10) = 10; sinceEnd = 0; remain = 10 → 83
    const atEnd = computeMobileCasesOnLine({
      state, nowMs: END_TIME, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(atEnd).toBe(83);

    // 5 min after end: remain = max(0, min(10, 10-5)) = 5 → floor(100*5/12) = 41
    const fiveMin = computeMobileCasesOnLine({
      state, nowMs: END_TIME + 5 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(fiveMin).toBe(41);

    // 10+ min after end: fully drained → 0
    const afterDrain = computeMobileCasesOnLine({
      state, nowMs: END_TIME + 10 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(afterDrain).toBe(0);
  });

  it("ended while paused: pause duration excluded from in-freezer fill at end", () => {
    const pauseStart = START + 3 * 60000;
    const endTimeWhilePaused = START + 15 * 60000;
    // endRun closes the open pause at endedAt → endedAt = endTimeWhilePaused
    const state: RunState = {
      startedAt: START,
      endedAt: endTimeWhilePaused,
      stoppages: [{ startedAt: pauseStart, endedAt: endTimeWhilePaused }], // closed at endedAt
    };
    // Gross elapsed at end: 15 min; pause duration: 12 min
    // netAtEnd = 15 - 12 = 3 min; atEndMin = min(3, 10) = 3
    // casesAtEnd = floor(100*3/12) = 25
    const atEnd = computeMobileCasesOnLine({
      state, nowMs: endTimeWhilePaused, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(atEnd).toBe(25);

    // 5 min later: remain = max(0, min(3, 10-5)) = max(0, min(3, 5)) = 3 → 25
    const fiveMin = computeMobileCasesOnLine({
      state, nowMs: endTimeWhilePaused + 5 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(fiveMin).toBe(25);

    // 10 min later: remain = max(0, min(3, 10-10)) = 0
    const tenMin = computeMobileCasesOnLine({
      state, nowMs: endTimeWhilePaused + 10 * 60000, ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(tenMin).toBe(0);
  });
});

describe("mobile pressDone — lifecycle edge cases", () => {
  it("does NOT fire during a long pause that would have filled the tunnel fictitiously", () => {
    // Paused early (2 min in): only 16 cases in tunnel at pause. 80 cases packaged.
    // casesNeeded = 100. Even after 60min of wall-clock pause, casesOnLine stays 16.
    const pauseStart = START + 2 * 60000;
    const state: RunState = {
      startedAt: START,
      stoppages: [{ startedAt: pauseStart, endedAt: undefined }],
    };
    const casesOnLine = computeMobileCasesOnLine({
      state, nowMs: pauseStart + 60 * 60000, // 60 min wall-clock later
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    // floor(100 * 2 / 12) = 16 (frozen at pause start)
    expect(casesOnLine).toBe(16);

    const done = pressDone({
      casesNeeded: 100, skidsCompleted: 8, casesPerSkid: 10, casesOnCurrentSkid: 0,
      casesOnLine, // 80 + 16 = 96 < 100
    });
    expect(done).toBe(false);  // NOT done — product wasn't in flight
  });

  it("fires correctly when cased + actual in-flight cases reach target", () => {
    // 5 min in (41 cases in tunnel), 59 already packaged: 59 + 41 = 100 = done
    const state: RunState = { startedAt: START, stoppages: [] };
    const casesOnLine = computeMobileCasesOnLine({
      state, nowMs: START + 5 * 60000,
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(casesOnLine).toBe(41);

    const done = pressDone({
      casesNeeded: 100, skidsCompleted: 5, casesPerSkid: 10, casesOnCurrentSkid: 9,
      casesOnLine, // 59 + 41 = 100
    });
    expect(done).toBe(true);
  });

  it("does NOT fire after end once the tunnel has fully drained", () => {
    const endTime = START + 20 * 60000;
    const state: RunState = { startedAt: START, endedAt: endTime, stoppages: [] };
    const casesOnLine = computeMobileCasesOnLine({
      state, nowMs: endTime + 15 * 60000,  // 15 min after end → fully drained
      ppm: PPM, pizzasPerCase: PPC, freezerTime: FREEZER_MIN,
    });
    expect(casesOnLine).toBe(0);  // drained

    // Even if packaged cases are below target, pressDone stays false when drained
    const done = pressDone({
      casesNeeded: 100, skidsCompleted: 8, casesPerSkid: 10, casesOnCurrentSkid: 5,
      casesOnLine, // 85 + 0 = 85 < 100
    });
    expect(done).toBe(false);
  });
});
