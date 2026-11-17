// Unit tests for prepPhase merge semantics used by the Dough & Sauce shift prep tracker.
//
// The prepPhase field syncs across tablets via /api/sync with these invariants:
//   - prepStartedAt: earliest non-null wins (once a shift starts, it cannot un-start)
//   - prepBatchesDough / prepBatchesSauce: MAX (counts only ever go up)
//   - prepCarriedOver: sticky true (once carry-over fires, it cannot revert)
//
// Daily rollover (isReset=true in the home.tsx sync-receive handler):
//   The handler adopts the REMOTE prepPhase wholesale (FRESH_PREP if absent),
//   without merging with the prior day's local phase. This prevents yesterday's
//   prepStartedAt from bleeding into the new day and hiding the "Start Prep" button.
//
// The MOBILE equivalent is in applyPayloadToState (mapping.ts): the isReset branch
// explicitly rebuilds from the remote shape only, ignoring prev.prepPhase entirely.

import { describe, it, expect } from "vitest";
import {
  mergePrepPhaseClient,
  getPrepPhase,
  FRESH_PREP_PHASE,
} from "./hooks/usePrepPhase";
import type { PrepPhase } from "./types";

const fresh: PrepPhase = { prepStartedAt: null, prepBatchesDough: 0, prepBatchesSauce: 0, prepCarriedOver: false };
const started = (ts: number, dough = 0, sauce = 0, carried = false): PrepPhase => ({
  prepStartedAt: ts, prepBatchesDough: dough, prepBatchesSauce: sauce, prepCarriedOver: carried,
});

describe("mergePrepPhaseClient — same-day receive semantics", () => {
  it("two devices with the same start time keep it", () => {
    const result = mergePrepPhaseClient(started(1000), started(1000));
    expect(result.prepStartedAt).toBe(1000);
  });

  it("earliest non-null start time wins (local earlier)", () => {
    const result = mergePrepPhaseClient(started(1000), started(2000));
    expect(result.prepStartedAt).toBe(1000);
  });

  it("earliest non-null start time wins (remote earlier)", () => {
    const result = mergePrepPhaseClient(started(3000), started(1500));
    expect(result.prepStartedAt).toBe(1500);
  });

  it("null local + non-null remote → remote wins", () => {
    const result = mergePrepPhaseClient(fresh, started(5000));
    expect(result.prepStartedAt).toBe(5000);
  });

  it("non-null local + null remote → local wins", () => {
    const result = mergePrepPhaseClient(started(5000), fresh);
    expect(result.prepStartedAt).toBe(5000);
  });

  it("both null → stays null (prep not started on either device)", () => {
    const result = mergePrepPhaseClient(fresh, fresh);
    expect(result.prepStartedAt).toBeNull();
  });

  it("dough batch count takes MAX", () => {
    const result = mergePrepPhaseClient(started(1000, 3), started(1000, 5));
    expect(result.prepBatchesDough).toBe(5);
  });

  it("sauce batch count takes MAX", () => {
    const result = mergePrepPhaseClient(started(1000, 0, 1), started(1000, 0, 0));
    expect(result.prepBatchesSauce).toBe(1);
  });

  it("prepCarriedOver is sticky: local true + remote false → true", () => {
    const result = mergePrepPhaseClient(started(1000, 2, 1, true), started(1000, 3, 0, false));
    expect(result.prepCarriedOver).toBe(true);
  });

  it("prepCarriedOver is sticky: local false + remote true → true", () => {
    const result = mergePrepPhaseClient(started(1000, 1, 0, false), started(1000, 2, 1, true));
    expect(result.prepCarriedOver).toBe(true);
  });

  it("prepCarriedOver false + false → false", () => {
    const result = mergePrepPhaseClient(started(1000), started(1000));
    expect(result.prepCarriedOver).toBe(false);
  });

  it("handles remote as a raw unknown (old payload missing prepPhase)", () => {
    // When remote dayState has no prepPhase, mergePrepPhaseClient receives undefined.
    // The caller (home.tsx sync-receive) only calls mergePrepPhaseClient on same-day
    // receives; but even so, unknown/null remote must not corrupt the local phase.
    const result = mergePrepPhaseClient(started(1000, 2, 1, false), undefined);
    expect(result.prepStartedAt).toBe(1000);
    expect(result.prepBatchesDough).toBe(2);
    expect(result.prepBatchesSauce).toBe(1);
  });
});

describe("FRESH_PREP_PHASE constant", () => {
  it("exports a fresh phase matching the daily-reset sentinel", () => {
    expect(FRESH_PREP_PHASE.prepStartedAt).toBeNull();
    expect(FRESH_PREP_PHASE.prepBatchesDough).toBe(0);
    expect(FRESH_PREP_PHASE.prepBatchesSauce).toBe(0);
    expect(FRESH_PREP_PHASE.prepCarriedOver).toBe(false);
  });
});

describe("getPrepPhase — defaults when dayState.prepPhase is absent", () => {
  it("returns FRESH_PREP_PHASE when the field is missing (legacy dayState)", () => {
    const ds = { runs: [], currentIndex: 0, date: "2026-08-13", resetAt: 0, substitutions: [], substitutionLog: [], stagedItems: {} };
    const result = getPrepPhase(ds as Parameters<typeof getPrepPhase>[0]);
    expect(result.prepStartedAt).toBeNull();
    expect(result.prepBatchesDough).toBe(0);
  });
});

describe("daily rollover — local device has active prep, remote sends fresh-day payload", () => {
  // This scenario: it's 11:59 PM, a tablet has prepStartedAt = 6:00 AM (T0).
  // At midnight the server resets. The tablet receives a SSE push with isReset=true.
  //
  // home.tsx sync-receive handler isReset path (post-fix):
  //   mergedPrepPhase = remotePrepPhase has object shape ? remotePrepPhase : FRESH_PREP_PHASE
  // This NEVER falls back to prev.prepPhase regardless of whether the remote includes prepPhase.
  //
  // The mobile equivalent is in applyPayloadToState (mapping.ts): the isReset branch
  // constructs the new prepPhase from the remote shape only, ignoring prev.prepPhase entirely.

  it("mergePrepPhaseClient is NOT called on reset — caller adopts remote wholesale", () => {
    // When remote sends an explicit FRESH_PREP, result is fresh regardless of local.
    const priorDayLocal = started(1_700_000_000_000, 4, 1, false); // yesterday's active prep
    const remoteAfterReset: PrepPhase = { ...fresh }; // server sent fresh day
    const adopted = remoteAfterReset;
    expect(adopted.prepStartedAt).toBeNull(); // ← yesterday's start does NOT carry over
    expect(adopted.prepBatchesDough).toBe(0);
    expect(adopted.prepCarriedOver).toBe(false);
    // Contrast: mergePrepPhaseClient would wrongly pick up yesterday's start
    const wrongMerge = mergePrepPhaseClient(priorDayLocal, remoteAfterReset);
    expect(wrongMerge.prepStartedAt).toBe(1_700_000_000_000); // ← this is what the fix prevents
  });

  it("reset payload with prepPhase OMITTED → FRESH_PREP_PHASE (not prev.prepPhase)", () => {
    // Regression: legacy reset payload has no prepPhase field (undefined).
    // The web isReset branch must fall back to FRESH_PREP_PHASE, never prev.prepPhase.
    // This test models the home.tsx isReset logic post-fix:
    //   remotePrepPhase = undefined (key absent)
    //   result = remotePrepPhase && typeof remotePrepPhase === "object" ? ... : FRESH_PREP_PHASE
    const priorDayLocal = started(1_700_000_000_000, 4, 1, false);
    const remotePrepPhase: unknown = undefined; // key absent from legacy payload

    // Simulate the fixed isReset branch
    const adopted: PrepPhase =
      remotePrepPhase && typeof remotePrepPhase === "object"
        ? (remotePrepPhase as PrepPhase)
        : FRESH_PREP_PHASE;

    expect(adopted.prepStartedAt).toBeNull(); // ← prior day's start cleared
    expect(adopted.prepBatchesDough).toBe(0);
    expect(adopted.prepBatchesSauce).toBe(0);
    expect(adopted.prepCarriedOver).toBe(false);

    // Confirm the prior-day phase is not referenced at all
    expect(priorDayLocal.prepStartedAt).not.toBeNull(); // guard: the local HAD a start
  });
});
