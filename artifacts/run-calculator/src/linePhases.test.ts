// Unit tests for computeLinePhases covering all phase transitions:
//   • Filling sequence (Stage 1 → 2 → 3 in virtual elapsed order)
//   • Persisted-policy pause sequence (safe stop-tunnel or normal line drain)
//   • Resume propagation — short pause (Stage 2 never stopped, no resuming shown)
//   • Resume propagation — long pause (Stage 2 + Stage 3 both show resuming)
//   • Drain sequence (Stage 1 drains first, Stage 3 drains last — pressDone)
//   • Ended run wall-clock drain (Stage 1 empties first, Stage 3 last)
//   • Normalization (oversized stage times clamped to fit freezerTime)

import { describe, it, expect } from "vitest";
import { computeLinePhases, pickMostActivePhase, computeEndedRunElapsedSec } from "./linePhases";

const BASE = {
  preTunnelMin: 2.5,
  postTunnelMin: 2.5,
  freezerTime: 20,        // tunnel = 20 - 2.5 - 2.5 = 15 min
  ppm: 100,
  pizzasPerCase: 10,
  pressDone: false,
  casesInFreezer: 0,
  pausedAt: null as number | null,
  lastResumeWallMs: 0,
  lastPauseStartWallMs: 0,
  endedAt: undefined as number | undefined,
};

const T0 = 1_700_000_000_000; // fixed wall-clock anchor

// ── Filling sequence ─────────────────────────────────────────────────────────
describe("computeLinePhases — filling sequence", () => {
  it("Stage 1 filling, Stage 2 & 3 empty when elapsed < preTunnelMin", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 60,   // 1 min → still in Stage 1 fill window (2.5 min)
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("filling");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
    // remainMs should reflect time left to complete Stage 1 fill: (2.5-1)*60000
    expect(phases.stage1.remainMs).toBeCloseTo(1.5 * 60000, -2);
  });

  it("Stage 1 active, Stage 2 filling, Stage 3 empty when preTunnelMin < elapsed < preTunnelMin+tunnelMin", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 5 * 60,   // 5 min → past Stage 1 (2.5 min), in tunnel fill (2.5..17.5 min)
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("active");
    expect(phases.stage2.state).toBe("filling");
    expect(phases.stage3.state).toBe("empty");
    // remainMs = (2.5 + 15 - 5) * 60000 = 12.5 * 60000
    expect(phases.stage2.remainMs).toBeCloseTo(12.5 * 60000, -2);
  });

  it("Stage 1 & 2 active, Stage 3 filling when preTunnelMin+tunnelMin < elapsed < freezerTime", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 18 * 60,  // 18 min → past tunnel fill (17.5 min), in Stage 3 fill
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("active");
    expect(phases.stage2.state).toBe("active");
    expect(phases.stage3.state).toBe("filling");
    // remainMs = (20 - 18) * 60000 = 2 * 60000
    expect(phases.stage3.remainMs).toBeCloseTo(2 * 60000, -2);
  });

  it("all stages active once elapsed >= freezerTime (steady state, strip hides)", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,  // 25 min → past the full 20-min fill
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("active");
    expect(phases.stage2.state).toBe("active");
    expect(phases.stage3.state).toBe("active");
  });

  it("at exactly preTunnelMin boundary Stage 1 becomes active and Stage 2 starts filling", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 2.5 * 60,
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("active");
    expect(phases.stage2.state).toBe("filling");
  });
});

// ── Pause propagation ────────────────────────────────────────────────────────
// ── Occupancy-awareness: early-run pause / early-run end ─────────────────────
// Key physical rule: product in Stage 1 propagates through ALL downstream stages.
// Even if Stage 2 or 3 hadn't filled yet at pause/end time, Stage 1's contents
// drain into them during the propagation delay. The ONLY gate is elapsedMin > 0
// (any product was pressed at all). The line isn't clear until freezerTime from
// when the press stopped.
describe("computeLinePhases — occupancy gates (early-run pause)", () => {
  it("defaults legacy pauses to safe frontline drain before the tunnel stops", () => {
    // Pause 1 min in — only Stage 1 filled, but Stage 1's product drains into
    // Stage 2 (and eventually Stage 3) during the propagation delay.
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 1 * 60,
      runStatus: "paused",
      pausedAt: T0,
      nowMs: T0 + 30 * 1000,  // 30s after pause — stop-wave not yet reached Stage 2
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("uses the same safe default for a run that was already full", () => {
    // Pause at 5 min: Stage 1 done filling, Stage 2 partially filled, Stage 3 not yet
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 5 * 60,   // past preTunnelMin (2.5) but not past preTunnel+tunnel (17.5)
      runStatus: "paused",
      pausedAt: T0,
      nowMs: T0 + 30 * 1000,    // 30s after pause — stop-wave has not yet reached Stage 2
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("all stages empty when pausing before any product is pressed", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 0,
      runStatus: "paused",
      pausedAt: T0,
      nowMs: T0 + 1000,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });
});

describe("computeLinePhases — occupancy gates (early-run ended)", () => {
  it("shows only Stage 1's countdown when a run ends early", () => {
    // Product still travels through every stage, but the display counts down one
    // operator-facing stage at a time.
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 1 * 60,
      runStatus: "ended",
      nowMs: T0 + 30 * 1000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("keeps later drain phases hidden until their turn when a run ends mid-tunnel", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 5 * 60,
      runStatus: "ended",
      nowMs: T0 + 30 * 1000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("all stages empty when no product was ever pressed", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 0,
      runStatus: "ended",
      nowMs: T0 + 30 * 1000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });
});

// ── computeEndedRunElapsedSec ─────────────────────────────────────────────────
// applyResumeToRun shifts `startedAt` forward by each pause duration on resume,
// so `endedAt - startedAt` already excludes closed pauses. Only open (unclosed)
// stoppages — which occur when a run is auto-ended while still paused — need to
// be subtracted. Closed stoppages must NOT be subtracted (double-counting).
describe("computeEndedRunElapsedSec", () => {
  it("returns 0 when no startedAt", () => {
    expect(computeEndedRunElapsedSec({ endedAt: T0 + 10 * 60000, stoppages: [] })).toBe(0);
  });

  it("returns wall duration when no pauses at all", () => {
    const sec = computeEndedRunElapsedSec({
      startedAt: T0,
      endedAt: T0 + 10 * 60000,
      stoppages: [],
    });
    expect(sec).toBeCloseTo(10 * 60, 1);
  });

  it("does NOT subtract closed pause stoppages (startedAt already shifted by applyResumeToRun)", () => {
    // After a 2-min pause that was resumed, applyResumeToRun shifts startedAt by 2 min.
    // So the stored startedAt = T0+2min. endedAt - startedAt is already the virtual elapsed.
    const sec = computeEndedRunElapsedSec({
      startedAt: T0 + 2 * 60000,  // already shifted forward by the 2-min pause
      endedAt: T0 + 10 * 60000,
      stoppages: [{ type: "pause", startedAt: T0 + 3 * 60000, endedAt: T0 + 5 * 60000 }],
    });
    expect(sec).toBeCloseTo(8 * 60, 1);  // (10min - 2min shifted) = 8min, stoppage NOT re-subtracted
  });

  it("subtracts open pause (auto-ended-while-paused case)", () => {
    // Run paused at T0+3min; auto-ended at T0+8min without closing the pause.
    // startedAt was NOT shifted (applyResumeToRun was never called for this pause).
    // The open pause (T0+3min → T0+8min = 5 minutes) must be subtracted.
    const sec = computeEndedRunElapsedSec({
      startedAt: T0,
      endedAt: T0 + 8 * 60000,
      stoppages: [{ type: "pause", startedAt: T0 + 3 * 60000 /* no endedAt */ }],
    });
    expect(sec).toBeCloseTo(3 * 60, 1);  // only 3 min of production before the pause
  });

  it("returns 0 when immediately paused then auto-ended (no product pressed)", () => {
    // Paused at the very start (T0) and auto-ended 5 min later — no production time.
    const sec = computeEndedRunElapsedSec({
      startedAt: T0,
      endedAt: T0 + 5 * 60000,
      stoppages: [{ type: "pause", startedAt: T0 /* open, no endedAt */ }],
    });
    expect(sec).toBe(0);
  });

  it("correctly handles a normal resume followed by auto-end-while-paused (mixed closed + open)", () => {
    // Run: started T0. Paused at T0+3min, resumed at T0+5min (2-min pause, now startedAt=T0+2min).
    // Paused again at T0+7min, auto-ended at T0+10min (open stoppage).
    const sec = computeEndedRunElapsedSec({
      startedAt: T0 + 2 * 60000,  // shifted by the first (closed) 2-min pause
      endedAt: T0 + 10 * 60000,
      stoppages: [
        { type: "pause", startedAt: T0 + 3 * 60000, endedAt: T0 + 5 * 60000 }, // closed, already baked in
        { type: "pause", startedAt: T0 + 7 * 60000 /* open */ },
      ],
    });
    // Wall: T0+10min - (T0+2min shifted) = 8min. Open pause: T0+7min to T0+10min = 3min.
    // Effective production = 8min - 3min = 5min.
    expect(sec).toBeCloseTo(5 * 60, 1);
  });
});

describe("computeLinePhases — pause propagation", () => {
  const pausedAt = T0;

  it("frontline drains first after a safe stop-tunnel pause", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 30 * 1000,   // 30s after pause
    });
    expect(phases.stage1.state).toBe("draining");
  });

  it("the tunnel is not marked stopped until frontline has drained", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 1 * 60000,   // 1 min after pause — before the 2.5 min delay
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage1.remainMs).toBeCloseTo(1.5 * 60000, -2);
    expect(phases.stage2.state).toBe("empty");
  });

  it("Stage 2 stopped at pausedAt + 3 min (past 2.5 min preTunnelMin)", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 3 * 60000,   // 3 min after pause — past the 2.5 min propagation
    });
    expect(phases.stage2.state).toBe("paused");
  });

  it("wrapper drains after the tunnel stops", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 20 * 60,  // 20 min — Stage 3 is occupied (17.5 min threshold passed)
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 3 * 60000,
    });
    expect(phases.stage2.state).toBe("paused");
    expect(phases.stage3.state).toBe("draining");
  });

  it("wrapper is clear after its own drain window", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 20 * 60,  // 20 min — Stage 3 is occupied
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 6 * 60000,
    });
    expect(phases.stage3.state).toBe("empty");
  });

  it("compact strip chooses the current frontline drain countdown", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      nowMs: T0 + 1 * 60000,  // 1 min — Stage 2 still draining 1.5 min remaining
    });
    const pick = pickMostActivePhase(phases);
    expect(pick?.state).toBe("draining");
    expect(pick?.label).toContain("Frontline");
  });

  it("keeps the tunnel running only when the saved policy explicitly says No", () => {
    const beforeTunnel = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      pauseStopsTunnel: false,
      nowMs: T0 + 1 * 60000,
    });
    const tunnelDraining = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      pauseStopsTunnel: false,
      nowMs: T0 + 3 * 60000,
    });
    const wrapperDraining = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt,
      pauseStopsTunnel: false,
      nowMs: T0 + 18 * 60000,
    });

    expect(beforeTunnel.stage1.state).toBe("draining");
    expect(tunnelDraining.stage2.state).toBe("draining");
    expect(wrapperDraining.stage3.state).toBe("draining");
  });
});

// ── Resume propagation during the filling phase (mid-fill pause) ─────────────
describe("computeLinePhases — resume propagation during filling phase (mid-fill pause)", () => {
  // Run paused at 10 min elapsed (Stage 2 still filling, 7.5 min remaining).
  // Pause lasted 3 min (> preTunnelMin=2.5) → Stage 2 was stopped.
  it("Stage 2 shows resuming (not filling) after long pause mid-tunnel-fill", () => {
    const pauseStart = T0 + 10 * 60000;
    const resumeAt = pauseStart + 3 * 60000;  // 3 min pause > preTunnelMin (2.5)
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeAt,
      lastPauseStartWallMs: pauseStart,
      nowMs: resumeAt + 30 * 1000,  // 30s after resume — restart-wave not arrived
    });
    expect(phases.stage1.state).toBe("active");   // Stage 1 full & running
    expect(phases.stage2.state).toBe("resuming"); // stopped during pause; product en route
    expect(phases.stage2.remainMs).toBeGreaterThan(0);
  });

  it("Stage 2 returns to filling after resume propagation delay elapses", () => {
    const pauseStart = T0 + 10 * 60000;
    const resumeAt = pauseStart + 3 * 60000;
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeAt,
      lastPauseStartWallMs: pauseStart,
      nowMs: resumeAt + 4 * 60000,  // 4 min after resume — past preTunnelMin (2.5)
    });
    expect(phases.stage2.state).toBe("filling");  // back to filling
  });

  it("Stage 3 shows resuming after very long pause during Stage 2 filling (pause > preTunnelMin+tunnelMin)", () => {
    // Pause at 18 min (Stage 3 filling: 2 min into the 2.5-min Stage 3 window).
    // Pause for 20 min → Stage 2 & 3 were stopped.
    const pauseStart = T0 + 18 * 60000;
    const resumeAt = pauseStart + 20 * 60000;
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 18 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeAt,
      lastPauseStartWallMs: pauseStart,
      nowMs: resumeAt + 30 * 1000,
    });
    expect(phases.stage2.state).toBe("resuming");  // Stage 2 also stopped
    expect(phases.stage3.state).toBe("resuming");  // stopped; resuming takes precedence over filling
  });
});

// ── Resume propagation ───────────────────────────────────────────────────────
describe("computeLinePhases — resume propagation: SHORT pause (< preTunnelMin)", () => {
  it("Stage 2 does NOT show resuming after a short pause (stop-wave never reached it)", () => {
    // Short pause: started 1 min before resume → duration 1 min < preTunnelMin (2.5 min)
    const pauseStart = T0 - 1 * 60000;
    const resumeTime = T0; // resumed at T0
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,  // past fill phase
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 30 * 1000,     // 30s after resume
    });
    // Stage 2 was never stopped — it was flowing throughout the short pause
    expect(phases.stage2.state).toBe("active");
  });

  it("Stage 3 does NOT show resuming after a short pause (stop-wave never reached it)", () => {
    const pauseStart = T0 - 1 * 60000;
    const resumeTime = T0;
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 30 * 1000,
    });
    expect(phases.stage3.state).toBe("active");
  });
});

describe("computeLinePhases — resume propagation: LONG pause (> preTunnelMin + tunnelMin)", () => {
  // Long pause: duration = 20 min > preTunnelMin (2.5) + tunnelMin (15) = 17.5 min
  // Both Stage 2 and Stage 3 were stopped. Resuming now (30s after resume).
  const pauseStart = T0 - 20 * 60000;
  const resumeTime = T0;

  it("Stage 2 shows resuming for first preTunnelMin of wall time after long-pause resume", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 30 * 1000,    // 30s after resume — well within 2.5 min window
    });
    expect(phases.stage2.state).toBe("resuming");
    expect(phases.stage2.remainMs).toBeCloseTo(2 * 60000, -2); // ~2 min left of 2.5
  });

  it("Stage 2 returns to active once preTunnelMin has elapsed since resume", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 3 * 60000,   // 3 min after resume — past 2.5 min window
    });
    expect(phases.stage2.state).toBe("active");
  });

  it("Stage 3 shows resuming for preTunnelMin + tunnelMin of wall time after long-pause resume", () => {
    // Stage 3 restart travel time = preTunnelMin + tunnelMin = 2.5 + 15 = 17.5 min
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 5 * 60000,    // 5 min after resume — within 17.5 min Stage 3 window
    });
    expect(phases.stage3.state).toBe("resuming");
    expect(phases.stage3.remainMs).toBeCloseTo(12.5 * 60000, -2); // 17.5-5 = 12.5 min left
  });

  it("Stage 3 returns to active once preTunnelMin + tunnelMin has elapsed since resume", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 18 * 60000,  // 18 min — past 17.5 min Stage 3 restart window
    });
    expect(phases.stage3.state).toBe("active");
  });

  it("Stage 1 is immediately active after resume with no propagation delay", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 10 * 1000,  // 10s after resume
    });
    expect(phases.stage1.state).toBe("active");
  });
});

describe("computeLinePhases — resume propagation: MEDIUM pause (preTunnelMin < pause < preTunnelMin+tunnelMin)", () => {
  // Medium pause: duration = 5 min > preTunnelMin (2.5) but < preTunnelMin+tunnelMin (17.5)
  // Stage 2 was stopped; Stage 3 was NOT stopped.
  const pauseStart = T0 - 5 * 60000;
  const resumeTime = T0;

  it("both downstream stages use the persisted stop-tunnel restart path", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      lastResumeWallMs: resumeTime,
      lastPauseStartWallMs: pauseStart,
      nowMs: T0 + 30 * 1000,   // 30s after resume
    });
    expect(phases.stage2.state).toBe("resuming");
    expect(phases.stage3.state).toBe("resuming");
  });
});

// ── pickMostActivePhase ──────────────────────────────────────────────────────
describe("pickMostActivePhase — compact strip selection priority", () => {
  it("prefers draining (with countdown) over paused", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt: T0,
      nowMs: T0 + 1 * 60000,  // Stage 2 still draining
    });
    const pick = pickMostActivePhase(phases);
    expect(pick?.state).toBe("draining");
  });

  it("falls back to paused when all transitions are gone", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 10 * 60,
      runStatus: "paused",
      pausedAt: T0,
      nowMs: T0 + 18 * 60000,  // All stages fully paused (past 17.5 min propagation)
    });
    const pick = pickMostActivePhase(phases);
    expect(pick?.state).toBe("paused");
  });

  it("returns undefined when all stages are active or empty", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 25 * 60,
      runStatus: "running",
      nowMs: T0,
    });
    const pick = pickMostActivePhase(phases);
    expect(pick).toBeUndefined();
  });

  it("picks nearest deadline among multiple filling stages", () => {
    // Stage 1 filling with 1.5 min remaining, Stage 2 & 3 empty
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 1 * 60,
      runStatus: "running",
      nowMs: T0,
    });
    const pick = pickMostActivePhase(phases);
    expect(pick?.state).toBe("filling");
    expect(pick?.label).toContain("Press");
  });
});

// ── Drain sequence (pressDone) ───────────────────────────────────────────────
describe("computeLinePhases — drain sequence (pressDone, running)", () => {
  it("shows only Stage 1 while a full line begins draining", () => {
    // casesInFreezer=200, ppm=100, ppc=10 → drainTotal=20min > tunnelMin+postTun=17.5
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 200,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage1.remainMs).toBeCloseTo(2.5 * 60000, -2);
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
    expect(pickMostActivePhase(phases)?.label).toContain("Frontline");
  });

  it("starts Stage 2 only after Stage 1's drain window reaches zero", () => {
    // casesInFreezer=100 → drainTotal=10min; s1Rem=max(0,10-15-2.5)=0
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 100,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("draining");
    expect(phases.stage3.state).toBe("empty");
    expect(phases.stage2.remainMs).toBeCloseTo(7.5 * 60000, -2);
  });

  it("starts Stage 3 only after Stage 2's drain window reaches zero", () => {
    // casesInFreezer=20 → drainTotal=2min; s3Rem=2min
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 20,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("draining");
    expect(phases.stage3.remainMs).toBeCloseTo(2 * 60000, -2);
  });

  it("switches from Stage 1 to Stage 2 at the exact boundary", () => {
    // 175 cases = 17.5 min of remaining flow, exactly Stage 1 + Tunnel boundaries.
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 175,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("draining");
    expect(phases.stage2.remainMs).toBeCloseTo(15 * 60000, -2);
    expect(phases.stage3.state).toBe("empty");
  });

  it("switches from Stage 2 to Stage 3 at the exact boundary", () => {
    // 25 cases = 2.5 min of remaining flow, exactly the wrapper phase.
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 25,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("draining");
    expect(phases.stage3.remainMs).toBeCloseTo(2.5 * 60000, -2);
  });

  it("keeps a single visible stage when drain speed is unavailable", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 200,
      ppm: 0,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("all stages empty when casesInFreezer reaches 0", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: 30 * 60,
      runStatus: "running",
      pressDone: true,
      casesInFreezer: 0,
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });
});

// ── Normalization ────────────────────────────────────────────────────────────
describe("computeLinePhases — normalization (oversized stage times)", () => {
  it("scales preTunnelMin + postTunnelMin proportionally when they exceed freezerTime", () => {
    // preTunnel=10, postTunnel=10, freezerTime=5 → each gets 2.5, tunnelMin=0
    const phases = computeLinePhases({
      ...BASE,
      preTunnelMin: 10,
      postTunnelMin: 10,
      freezerTime: 5,
      elapsedBatchSec: 1 * 60,  // 1 min — in Stage 1 fill of normalized 2.5 min
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("filling");
    expect(phases.stage2.state).toBe("empty");
  });

  it("all stages active with oversized outer times when elapsed >= freezerTime", () => {
    const phases = computeLinePhases({
      ...BASE,
      preTunnelMin: 10,
      postTunnelMin: 10,
      freezerTime: 5,
      elapsedBatchSec: 6 * 60,  // past entire 5-min window
      runStatus: "running",
      nowMs: T0,
    });
    expect(phases.stage1.state).toBe("active");
    expect(phases.stage2.state).toBe("active");
    expect(phases.stage3.state).toBe("active");
  });
});

// ── Ended run wall-clock drain ───────────────────────────────────────────────
describe("computeLinePhases — ended run wall-clock drain", () => {
  // For ended-run drain tests the run must have run long enough for all three
  // stages to have received product. Use elapsedBatchSec = 25 * 60 (past the
  // 20-min full fill) so the occupancy gates don't hide any stage.
  const FULL_ELAPSED = 25 * 60;

  it("shows only Stage 1 immediately after an ended run begins draining", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: FULL_ELAPSED,
      runStatus: "ended",
      nowMs: T0 + 1 * 60000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("draining");
    expect(phases.stage1.remainMs).toBeCloseTo(1.5 * 60000, -2);
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });

  it("starts Stage 2 after Stage 1 empties", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: FULL_ELAPSED,
      runStatus: "ended",
      nowMs: T0 + 3 * 60000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("draining");
    expect(phases.stage3.state).toBe("empty");
  });

  it("Stage 3 is last to become empty at freezerTime after end", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: FULL_ELAPSED,
      runStatus: "ended",
      nowMs: T0 + 19 * 60000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("draining");
    expect(phases.stage3.remainMs).toBeCloseTo(1 * 60000, -2);
  });

  it("all stages empty once freezerTime has elapsed since end", () => {
    const phases = computeLinePhases({
      ...BASE,
      elapsedBatchSec: FULL_ELAPSED,
      runStatus: "ended",
      nowMs: T0 + 21 * 60000,
      endedAt: T0,
    });
    expect(phases.stage1.state).toBe("empty");
    expect(phases.stage2.state).toBe("empty");
    expect(phases.stage3.state).toBe("empty");
  });
});
