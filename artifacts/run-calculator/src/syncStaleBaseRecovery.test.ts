// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SyncPayload } from "./types";
import {
  describeServerWinsConflictOutcome,
  rebaseStaleSyncIntent,
  selectUnchangedRunValueIdsForRecovery,
  shouldResetLiveFormForSync,
} from "./syncStaleBaseRecovery";

function snapshot(): SyncPayload {
  return {
    syncVersion: 1,
    completeness: "complete",
    baseSnapshotId: "base",
    dayState: {
      date: "2030-01-01",
      resetAt: 10,
      runs: [{ id: "run-1", brand: "Acme", metaUpdatedAt: 10 }],
    },
    runValues: {
      "run-1": { casesNeeded: 240, casesOnCurrentSkid: 12, casesPerSkid: 48 },
    },
    runValuesUpdatedAt: { "run-1": 10 },
    brands: ["Acme"],
  };
}

describe("stale-base intent recovery", () => {
  it("clearly reports that conflicting local values are discarded in favor of server values", () => {
    expect(describeServerWinsConflictOutcome(0)).toBe("");
    expect(describeServerWinsConflictOutcome(1)).toBe(
      "kept the server value for 1 conflict; discarded the conflicting local value; review the current value before editing again",
    );
    expect(describeServerWinsConflictOutcome(2)).toBe(
      "kept server values for 2 conflicts; discarded the conflicting local values; review the current values before editing again",
    );
    expect(() => describeServerWinsConflictOutcome(-1)).toThrow(RangeError);
    expect(() => describeServerWinsConflictOutcome(1.5)).toThrow(RangeError);
  });

  it("selects the rebased result when the live run still matches the sent request", () => {
    const sent = {
      "run-1": { casesNeeded: 777, casesOnCurrentSkid: 12 },
    };
    const recovered = {
      "run-1": { casesNeeded: 999, casesOnCurrentSkid: 15 },
    };

    // The recovered value is not the server snapshot: it keeps a distinct
    // local edit while discarding the conflicting casesNeeded value.
    expect(selectUnchangedRunValueIdsForRecovery(
      sent,
      recovered,
      structuredClone(sent),
    )).toEqual(["run-1"]);
  });

  it("does not select a run whose live values changed after the request was sent", () => {
    expect(selectUnchangedRunValueIdsForRecovery(
      { "run-1": { casesNeeded: 777 } },
      { "run-1": { casesNeeded: 999 } },
      { "run-1": { casesNeeded: 888 } },
    )).toEqual([]);
  });

  it("does not select a run missing from the recovered or current snapshot", () => {
    expect(selectUnchangedRunValueIdsForRecovery(
      { "run-1": { casesNeeded: 777 }, "run-2": { casesNeeded: 300 } },
      { "run-1": { casesNeeded: 999 } },
      { "run-1": { casesNeeded: 777 } },
    )).toEqual(["run-1"]);
  });

  it("allows an explicitly rebased run to reset the live form without an ack", () => {
    expect(shouldResetLiveFormForSync({
      currentRunId: "run-1",
      hasCurrentRunValues: true,
      adoptedPackaging: false,
      explicitRebaseAdoption: true,
      localUpdatedAt: 20,
      remoteUpdatedAt: 10,
      allowForegroundCanonicalFormReset: false,
      localEditQuietMs: 100,
      pushAcknowledged: false,
      emptyOverPopulated: false,
    })).toBe(true);
  });

  it("keeps the empty-over-populated safeguard for explicit rebase adoption", () => {
    expect(shouldResetLiveFormForSync({
      currentRunId: "run-1",
      hasCurrentRunValues: true,
      adoptedPackaging: false,
      explicitRebaseAdoption: true,
      localUpdatedAt: 20,
      remoteUpdatedAt: 10,
      allowForegroundCanonicalFormReset: false,
      localEditQuietMs: 100,
      pushAcknowledged: false,
      emptyOverPopulated: true,
    })).toBe(false);
  });

  it("retains the quiet-period and acknowledgment guard for ordinary updates", () => {
    const base = {
      currentRunId: "run-1",
      hasCurrentRunValues: true,
      adoptedPackaging: false,
      explicitRebaseAdoption: false,
      localUpdatedAt: 10,
      remoteUpdatedAt: 10,
      allowForegroundCanonicalFormReset: false,
      emptyOverPopulated: false,
    };
    expect(shouldResetLiveFormForSync({
      ...base,
      localEditQuietMs: 3000,
      pushAcknowledged: true,
    })).toBe(true);
    expect(shouldResetLiveFormForSync({
      ...base,
      localEditQuietMs: 1000,
      pushAcknowledged: true,
    })).toBe(false);
  });

  it("keeps distinct offline edits and retains the server's conflicting value", () => {
    const base = snapshot();
    const local = structuredClone(base);
    local.runValues["run-1"] = {
      ...local.runValues["run-1"],
      casesNeeded: 777,
      casesOnCurrentSkid: 50,
      pizzasPerCase: 8,
    };
    const canonical = structuredClone(base);
    canonical.runValues["run-1"] = {
      ...canonical.runValues["run-1"],
      casesNeeded: 999,
      casesPerSkid: 60,
    };

    const result = rebaseStaleSyncIntent(base, local, canonical, {
      snapshotId: "canonical-2",
      serverTime: 20,
    });

    expect(result.payload.runValues["run-1"]).toEqual({
      casesNeeded: 999,
      casesOnCurrentSkid: 50,
      casesPerSkid: 60,
      pizzasPerCase: 8,
    });
    expect(result.payload.baseSnapshotId).toBe("canonical-2");
    expect(result.payload.completeness).toBe("complete");
    expect(result.reappliedChanges).toBe(2);
    expect(result.retainedServerConflicts).toBe(1);
  });

  it("materializes a partial queued snapshot over its exact base before rebasing", () => {
    const base = snapshot();
    const canonical = snapshot();
    canonical.runValues["run-1"].casesPerSkid = 60;
    const partial: SyncPayload = {
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId: "base",
      dayState: {
        ...base.dayState,
        runs: [{ ...base.dayState.runs[0], brand: "New Brand", metaUpdatedAt: 11 }],
      },
      runValues: { "run-1": { ...base.runValues["run-1"], casesNeeded: 260 } },
      runValuesUpdatedAt: { "run-1": 11 },
    };

    const result = rebaseStaleSyncIntent(base, partial, canonical, {
      snapshotId: "canonical-3",
      serverTime: 30,
    });

    expect(result.payload.runValues["run-1"]).toEqual({
      casesNeeded: 260,
      casesOnCurrentSkid: 12,
      casesPerSkid: 60,
    });
    expect(result.payload.dayState.runs).toEqual([
      { id: "run-1", brand: "New Brand", metaUpdatedAt: 11 },
    ]);
  });

  it("survives JSON persistence/reload and applying the same intent twice is idempotent", () => {
    const base = snapshot();
    const queued = structuredClone(base);
    queued.runValues["run-1"].casesOnCurrentSkid = 22;
    const canonical = snapshot();
    canonical.runValues["run-1"].casesNeeded = 300;
    const persisted = JSON.parse(JSON.stringify({ base, queued })) as {
      base: SyncPayload;
      queued: SyncPayload;
    };

    const first = rebaseStaleSyncIntent(persisted.base, persisted.queued, canonical, {
      snapshotId: "canonical-4",
      serverTime: 40,
    });
    const afterReload = JSON.parse(JSON.stringify(first.payload)) as SyncPayload;
    const second = rebaseStaleSyncIntent(persisted.base, persisted.queued, canonical, {
      snapshotId: "canonical-4",
      serverTime: 40,
    });

    expect(afterReload.runValues).toEqual(second.payload.runValues);
    expect(second.payload.runValues["run-1"]).toEqual({
      casesNeeded: 300,
      casesOnCurrentSkid: 22,
      casesPerSkid: 48,
    });
  });
});
