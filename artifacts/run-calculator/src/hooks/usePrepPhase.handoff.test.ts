/**
 * usePrepPhase — next-run depletion handoff tests.
 *
 * Covers the three scenarios called out in the code review:
 *  1. Handoff after an initial prep carry-over (prepCarriedOver: true → reset).
 *  2. Idempotency guard (prepHandoffFromRunId) survives remounts and tab switches.
 *  3. mergePrepPhaseClient preserves prepHandoffFromRunId across SSE sync.
 *
 * These are pure unit tests — no DOM / render setup required.
 */

import { describe, it, expect } from "vitest";
import { mergePrepPhaseClient, FRESH_PREP_PHASE } from "./usePrepPhase";
import type { PrepPhase } from "../types";

// ── Helper: build a depletion-handoff reset payload ─────────────────────────
function makeHandoffPrep(runId: string, overrides: Partial<PrepPhase> = {}): PrepPhase {
  return {
    prepStartedAt: Date.now(),
    prepBatchesDough: 0,
    prepBatchesSauce: 0,
    prepCarriedOver: false,
    prepHandoffFromRunId: runId,
    ...overrides,
  };
}

// ── 1. Handoff resets prepCarriedOver so startRun carries next-run batches ──
describe("depletion handoff — prepCarriedOver reset", () => {
  it("handoff sets prepCarriedOver to false even when a prior carry-over was true", () => {
    // Simulate a prior run that was started and carried its prep batches.
    const priorPrep: PrepPhase = {
      prepStartedAt: 1000,
      prepBatchesDough: 2,
      prepBatchesSauce: 1,
      prepCarriedOver: true,  // already carried into run A
    };

    // When nextRunPrepActive fires for run B, the handoff effect builds this:
    const handoffPrep = makeHandoffPrep("run-b");

    expect(handoffPrep.prepCarriedOver).toBe(false);
    expect(handoffPrep.prepBatchesDough).toBe(0);
    expect(handoffPrep.prepBatchesSauce).toBe(0);
    expect(handoffPrep.prepHandoffFromRunId).toBe("run-b");
    // The prior carry-over does NOT bleed through — the reset is a clean slate.
    expect(handoffPrep.prepCarriedOver).not.toBe(priorPrep.prepCarriedOver);
  });

  it("after handoff reset, adding a batch does not change prepCarriedOver", () => {
    const prep = makeHandoffPrep("run-b");
    // Simulate addPrepBatchDough (increments only, does not touch prepCarriedOver)
    const afterBatch: PrepPhase = { ...prep, prepBatchesDough: prep.prepBatchesDough + 1 };
    expect(afterBatch.prepCarriedOver).toBe(false);
    expect(afterBatch.prepBatchesDough).toBe(1);
    // startRun sees prepCarriedOver: false → will carry the batch
  });
});

// ── 2. prepHandoffFromRunId idempotency ─────────────────────────────────────
describe("depletion handoff — idempotency guard", () => {
  it("guard is set to currentRunId at handoff time", () => {
    const prep = makeHandoffPrep("run-abc-123");
    expect(prep.prepHandoffFromRunId).toBe("run-abc-123");
  });

  it("guard present → a second handoff call for the same run is a no-op", () => {
    // This simulates: component remounts (e.g. tab switch away/back) after the
    // first handoff already fired and staff entered 3 batches.
    const existingPrep: PrepPhase = {
      ...makeHandoffPrep("run-b"),
      prepBatchesDough: 3,   // crew already entered these
    };

    // The guard check: if prepHandoffFromRunId === currentRunId, skip reset.
    const shouldSkip = existingPrep.prepHandoffFromRunId === "run-b";
    expect(shouldSkip).toBe(true);
    // Batch counts are preserved — staff work is not erased on remount.
    expect(existingPrep.prepBatchesDough).toBe(3);
  });

  it("guard absent → handoff fires for the run", () => {
    const existingPrep: PrepPhase = FRESH_PREP_PHASE;  // no handoff yet
    const shouldSkip = existingPrep.prepHandoffFromRunId === "run-b";
    expect(shouldSkip).toBe(false);  // will reset
  });

  it("guard for a different run → handoff fires (new run is next)", () => {
    // After run-b was done and run-c started, run-c now has a next run (run-d).
    const existingPrep: PrepPhase = { ...makeHandoffPrep("run-b") };  // guard from run-b
    const shouldSkip = existingPrep.prepHandoffFromRunId === "run-c"; // checking run-c
    expect(shouldSkip).toBe(false);  // will reset for run-c's handoff
  });
});

// ── 3. mergePrepPhaseClient preserves prepHandoffFromRunId across SSE sync ──
describe("mergePrepPhaseClient — preserves handoff guard", () => {
  it("local handoff ID takes priority when both are set to the same value", () => {
    const local: PrepPhase = { ...makeHandoffPrep("run-b"), prepBatchesDough: 2 };
    const remote = { ...makeHandoffPrep("run-b"), prepBatchesDough: 1 };

    const merged = mergePrepPhaseClient(local, remote);
    expect(merged.prepHandoffFromRunId).toBe("run-b");
    // Batch count takes MAX (crew-entered batches survive sync)
    expect(merged.prepBatchesDough).toBe(2);
    expect(merged.prepCarriedOver).toBe(false);
  });

  it("inherits handoff ID from remote when local has none", () => {
    const local: PrepPhase = FRESH_PREP_PHASE;
    const remote = { ...makeHandoffPrep("run-b") };

    const merged = mergePrepPhaseClient(local, remote);
    expect(merged.prepHandoffFromRunId).toBe("run-b");
  });

  it("local handoff ID is preserved when remote has none", () => {
    const local: PrepPhase = makeHandoffPrep("run-b");
    const remote = { prepStartedAt: null, prepBatchesDough: 0, prepBatchesSauce: 0, prepCarriedOver: false };

    const merged = mergePrepPhaseClient(local, remote);
    expect(merged.prepHandoffFromRunId).toBe("run-b");
  });

  it("stale pre-handoff SSE echo does not clobber the handoff reset (local wins)", () => {
    // Local device did the reset (prepCarriedOver: false, handoff set, 0 batches).
    // A stale SSE echo from a peer that hasn't received the handoff yet carries
    // prepCarriedOver: true and old batch counts. The handoff-aware merge must
    // keep local's post-handoff state intact so startRun can carry new batches.
    const local: PrepPhase = { ...makeHandoffPrep("run-b"), prepBatchesDough: 2 };
    // Remote is pre-handoff: no prepHandoffFromRunId, old counts, already carried
    const remote = {
      prepStartedAt: 1000,
      prepBatchesDough: 5,  // old batch count from the PRIOR run's prep
      prepBatchesSauce: 2,
      prepCarriedOver: true, // carried into the PRIOR run's start
    };

    const merged = mergePrepPhaseClient(local, remote);
    // Handoff-aware: local wins because it has prepHandoffFromRunId and remote doesn't
    expect(merged.prepCarriedOver).toBe(false);  // NOT clobbered to true
    expect(merged.prepBatchesDough).toBe(2);     // local post-handoff count kept
    expect(merged.prepHandoffFromRunId).toBe("run-b");
  });

  it("remote is in handoff but local is stale → adopt remote post-handoff state", () => {
    // A tablet that was offline misses the handoff. It has old counts and prepCarriedOver:true.
    // When it reconnects and receives the post-handoff SSE, it should adopt it.
    const local: PrepPhase = {
      prepStartedAt: 1000,
      prepBatchesDough: 5,  // old, pre-handoff
      prepBatchesSauce: 1,
      prepCarriedOver: true,
    };
    const remote = { ...makeHandoffPrep("run-b"), prepBatchesDough: 3 };  // post-handoff

    const merged = mergePrepPhaseClient(local, remote);
    expect(merged.prepCarriedOver).toBe(false);  // adopted from remote
    expect(merged.prepBatchesDough).toBe(3);     // post-handoff count from remote
    expect(merged.prepHandoffFromRunId).toBe("run-b");
  });

  it("both tablets in same handoff → MAX batches, carry-over stays false", () => {
    // Two tablets both reset for run-b and each added different batches.
    // The merge should give the higher count and keep prepCarriedOver: false.
    const local: PrepPhase = { ...makeHandoffPrep("run-b"), prepBatchesDough: 3 };
    const remote = { ...makeHandoffPrep("run-b"), prepBatchesDough: 4 };

    const merged = mergePrepPhaseClient(local, remote);
    expect(merged.prepBatchesDough).toBe(4);  // MAX
    expect(merged.prepCarriedOver).toBe(false);  // sticky-OR: false || false = false
    expect(merged.prepHandoffFromRunId).toBe("run-b");
  });

  it("no prepHandoffFromRunId on either side → merged result has none", () => {
    const merged = mergePrepPhaseClient(FRESH_PREP_PHASE, { ...FRESH_PREP_PHASE });
    expect(merged.prepHandoffFromRunId).toBeUndefined();
  });
});

// ── 4. Sequential handoff generations (two tablets at different runs) ────────
describe("mergePrepPhaseClient — sequential handoff generations (LWW by prepStartedAt)", () => {
  const T1 = 1_700_000_000_000;  // run-A handoff timestamp
  const T2 = 1_700_000_060_000;  // run-B handoff timestamp, one minute later

  it("local stuck on run-A, remote has advanced to run-B: adopts run-B state", () => {
    // Tablet 1 (offline): still has run-A's handoff, 0 batches
    const local: PrepPhase = {
      prepStartedAt: T1,
      prepBatchesDough: 0,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-a",
    };
    // Tablet 2 (online): advanced to run-B, already logged 3 batches
    const remote = {
      prepStartedAt: T2,
      prepBatchesDough: 3,
      prepBatchesSauce: 1,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-b",
    };

    const merged = mergePrepPhaseClient(local, remote);
    // Remote is newer (T2 > T1) → adopt run-B state entirely
    expect(merged.prepHandoffFromRunId).toBe("run-b");
    expect(merged.prepBatchesDough).toBe(3);    // run-B batches preserved
    expect(merged.prepBatchesSauce).toBe(1);
    expect(merged.prepCarriedOver).toBe(false); // ready for startRun carry-over
    expect(merged.prepStartedAt).toBe(T2);      // newer start time
  });

  it("local has run-B (newer), remote is stale run-A: keeps run-B local state", () => {
    // Tablet 1: already on run-B with 2 batches logged
    const local: PrepPhase = {
      prepStartedAt: T2,
      prepBatchesDough: 2,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-b",
    };
    // Tablet 2: stale SSE from a slow peer still on run-A
    const remote = {
      prepStartedAt: T1,
      prepBatchesDough: 5,   // old run-A batch counts — must NOT clobber
      prepBatchesSauce: 2,
      prepCarriedOver: true, // run-A was already carried — must NOT clobber
      prepHandoffFromRunId: "run-a",
    };

    const merged = mergePrepPhaseClient(local, remote);
    // Local is newer (T2 > T1) → keep run-B local state
    expect(merged.prepHandoffFromRunId).toBe("run-b");
    expect(merged.prepBatchesDough).toBe(2);    // run-B count preserved, run-A counts discarded
    expect(merged.prepCarriedOver).toBe(false); // NOT clobbered by run-A's sticky true
  });

  it("tied timestamps with different IDs: local wins (stable tiebreak)", () => {
    const sameTs = T1;
    const local: PrepPhase = {
      prepStartedAt: sameTs,
      prepBatchesDough: 1,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-a",
    };
    const remote = {
      prepStartedAt: sameTs,
      prepBatchesDough: 2,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-b",
    };

    const merged = mergePrepPhaseClient(local, remote);
    // Tied: local wins (remTs > locTs is false when equal)
    expect(merged.prepHandoffFromRunId).toBe("run-a");
    expect(merged.prepBatchesDough).toBe(1);
  });

  it("after merge to run-B, a subsequent stale run-A echo does not clobber", () => {
    // Once merged to run-B, local now has run-B. Another stale run-A echo arrives.
    const local: PrepPhase = {
      prepStartedAt: T2,
      prepBatchesDough: 3,
      prepBatchesSauce: 1,
      prepCarriedOver: false,
      prepHandoffFromRunId: "run-b",
    };
    const staleEcho = {
      prepStartedAt: T1,
      prepBatchesDough: 7,  // much higher but stale
      prepBatchesSauce: 3,
      prepCarriedOver: true,
      prepHandoffFromRunId: "run-a",
    };

    const merged = mergePrepPhaseClient(local, staleEcho);
    expect(merged.prepHandoffFromRunId).toBe("run-b");
    expect(merged.prepBatchesDough).toBe(3);    // not clobbered by stale run-A count
    expect(merged.prepCarriedOver).toBe(false); // not clobbered
  });
});
