/**
 * Sauce barrel timer — pure-calculation tests.
 *
 * Covers the pause-aware Sauce barrel countdown used by the live stations.
 * All logic under test is pure math — no React, no DOM. Automatic staged
 * supply and claim cadence are covered by the shared live-calc and auto-track
 * suites; this file intentionally has no legacy alert contracts.
 *
 * Scenarios:
 *   1. sauceDepletionSec formula — basic, edge cases (0-valued inputs)
 *   2. netElapsedSec (pause-aware) — freeze during pause, resume after pause
 *   3. Barrel elapsed calculation — derived from netElapsedSec and barrel anchor
 */

import { describe, it, expect } from "vitest";

// ── Inline replicas of the pure-math formulas ────────────────────────────────
// Each replica mirrors its source in RunContext.tsx / LiveRunContext.tsx so the
// test can run in plain Node without the React Native / browser import graph.

interface Stoppage {
  startedAt: number;
  endedAt?: number;
}

/** Mirrors the mobile computeCalc netElapsedSec formula. */
function mobileNetElapsedSec(
  startedAt: number,
  nowMs: number,
  stoppages: Stoppage[],
): number {
  const grossMs = Math.max(0, nowMs - startedAt);

  const completedDownMs = stoppages
    .filter(s => s.endedAt != null)
    .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);

  // Active stoppage: freeze the clock at the moment the pause started
  const activeStop = stoppages.find(s => s.endedAt == null);
  const activeDownMs = activeStop
    ? Math.max(0, nowMs - activeStop.startedAt)
    : 0;

  return Math.max(0, (grossMs - completedDownMs - activeDownMs) / 1000);
}

/**
 * Mirrors the sauceDepletionSec formula used in both clients:
 *   sauceEffBarrel × 16 ÷ sauceOzPerPizza ÷ ppm × 60
 */
function sauceDepletionSec(
  sauceEffBarrel: number,
  sauceOzPerPizza: number,
  ppm: number,
): number {
  if (ppm <= 0 || sauceEffBarrel <= 0 || sauceOzPerPizza <= 0) return 0;
  return (sauceEffBarrel * 16 / sauceOzPerPizza / ppm) * 60;
}

/**
 * Barrel elapsed seconds — pause-aware (derived from net elapsed, not wall-clock).
 */
function barrelElapsed(netElapsed: number, lastBarrelNetSec: number): number {
  return Math.max(0, netElapsed - lastBarrelNetSec);
}

// ── Shared fixture ────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;           // arbitrary epoch for run start
const BARREL_LBS = 30;                  // 30 lb barrel
const OZ_PER_PIZZA = 1.5;              // 1.5 oz sauce per pizza
const PPM = 600;                        // 600 pizzas / minute
// Expected depletion: 30 × 16 / 1.5 / 600 × 60 = 32 seconds
const EXPECTED_DEPLETION_SEC = (BARREL_LBS * 16 / OZ_PER_PIZZA / PPM) * 60;

// ── 1. sauceDepletionSec formula ─────────────────────────────────────────────
describe("sauceDepletionSec formula", () => {
  it("computes correctly from barrel lbs, oz/pizza, and PPM", () => {
    const result = sauceDepletionSec(BARREL_LBS, OZ_PER_PIZZA, PPM);
    expect(result).toBeCloseTo(EXPECTED_DEPLETION_SEC, 6);
  });

  it("returns 0 when PPM is zero (run not started / no speed set)", () => {
    expect(sauceDepletionSec(BARREL_LBS, OZ_PER_PIZZA, 0)).toBe(0);
  });

  it("returns 0 when oz/pizza is zero (sauce not configured)", () => {
    expect(sauceDepletionSec(BARREL_LBS, 0, PPM)).toBe(0);
  });

  it("returns 0 when barrel lbs is zero (no barrel size configured)", () => {
    expect(sauceDepletionSec(0, OZ_PER_PIZZA, PPM)).toBe(0);
  });

  it("scales linearly — doubling PPM halves depletion time", () => {
    const base = sauceDepletionSec(BARREL_LBS, OZ_PER_PIZZA, PPM);
    const fast = sauceDepletionSec(BARREL_LBS, OZ_PER_PIZZA, PPM * 2);
    expect(fast).toBeCloseTo(base / 2, 6);
  });

  it("scales linearly — doubling barrel lbs doubles depletion time", () => {
    const base = sauceDepletionSec(BARREL_LBS, OZ_PER_PIZZA, PPM);
    const big = sauceDepletionSec(BARREL_LBS * 2, OZ_PER_PIZZA, PPM);
    expect(big).toBeCloseTo(base * 2, 6);
  });
});
// ── 2. netElapsedSec — pause/resume behaviour ─────────────────────────────────
describe("netElapsedSec — pause-aware elapsed time", () => {
  it("equals gross elapsed when no stoppages", () => {
    const elapsed = mobileNetElapsedSec(T0, T0 + 30000, []);
    expect(elapsed).toBeCloseTo(30, 6);
  });

  it("freezes during an active stoppage (does not advance while paused)", () => {
    const pauseStart = T0 + 15000; // paused 15 s in
    const stoppages: Stoppage[] = [{ startedAt: pauseStart }];

    // 15 s net elapsed at pause start
    const atPause = mobileNetElapsedSec(T0, pauseStart, stoppages);
    expect(atPause).toBeCloseTo(15, 6);

    // 60 s wall-clock later — still frozen at 15 s net
    const sixtySecLater = mobileNetElapsedSec(T0, pauseStart + 60000, stoppages);
    expect(sixtySecLater).toBeCloseTo(15, 6);
  });

  it("resumes correctly after pause — pause duration excluded", () => {
    const pauseStart = T0 + 15000;
    const pauseEnd   = T0 + 45000; // 30-s pause
    const stoppages: Stoppage[] = [{ startedAt: pauseStart, endedAt: pauseEnd }];

    // Immediately after resume: wall=45 s, downtime=30 s → net=15 s
    const atResume = mobileNetElapsedSec(T0, pauseEnd, stoppages);
    expect(atResume).toBeCloseTo(15, 6);

    // 10 s after resume: wall=55 s, downtime=30 s → net=25 s
    const tenSecAfter = mobileNetElapsedSec(T0, pauseEnd + 10000, stoppages);
    expect(tenSecAfter).toBeCloseTo(25, 6);
  });
});

// ── 3. Barrel elapsed — derives from net elapsed + barrel anchor ───────────
describe("barrel elapsed — pause-aware barrel countdown", () => {
  it("starts at 0 when the run has just begun (lastBarrelNetSec = 0)", () => {
    const elapsed = barrelElapsed(0, 0);
    expect(elapsed).toBe(0);
  });

  it("advances with net elapsed time while running", () => {
    // 10 s into run, barrel started at run start
    expect(barrelElapsed(10, 0)).toBe(10);
    // 25 s into run
    expect(barrelElapsed(25, 0)).toBe(25);
  });

  it("does NOT advance while paused (because netElapsedSec freezes)", () => {
    const pauseStart = T0 + 15000;
    const stoppages: Stoppage[] = [{ startedAt: pauseStart }];
    const netAtPause  = mobileNetElapsedSec(T0, pauseStart, stoppages);
    const netLater    = mobileNetElapsedSec(T0, pauseStart + 60000, stoppages);

    // Both calls return the same netElapsedSec → same barrelElapsed
    expect(barrelElapsed(netAtPause, 0)).toBeCloseTo(15, 6);
    expect(barrelElapsed(netLater,   0)).toBeCloseTo(15, 6);
  });

  it("resets to 0 when a barrel is consumed (anchor advances to current net)", () => {
    const netNow = 20; // 20 s into run when crew taps "+1 Barrel"
    const newAnchor = netNow; // this is what the UI writes to lastBarrelNetSecRef

    // Immediately after consume: elapsed from NEW barrel = 0
    expect(barrelElapsed(netNow, newAnchor)).toBe(0);

    // 5 s later: new barrel has been running for 5 s
    expect(barrelElapsed(netNow + 5, newAnchor)).toBe(5);
  });
});
