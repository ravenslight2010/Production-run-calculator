// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSyncBaselineGate,
  shouldAcceptSyncDaySnapshot,
  shouldAtomicallyAdoptFirstSnapshot,
} from "./storage";

describe("SSE sync baseline gate", () => {
  it("queues reconnect pushes until a populated initial snapshot is applied", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();

    // EventSource can report open before the server's first data frame. The
    // reconnect push must wait, or a new device can overwrite the shared row.
    expect(gate.requestPush()).toBe(false);
    expect(gate.isReady()).toBe(false);

    // The caller applies the populated payload first, then releases exactly one
    // queued recovery push against that adopted state.
    expect(gate.completeInitialSnapshot()).toBe(true);
    expect(gate.isReady()).toBe(true);
    expect(gate.requestPush()).toBe(true);
  });

  it("treats the server's explicit empty initial frame as a safe baseline", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();
    expect(gate.requestPush()).toBe(false);
    expect(gate.completeInitialSnapshot()).toBe(true);
    expect(gate.requestPush()).toBe(true);
  });

  it("resets readiness on each reconnect", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();
    gate.completeInitialSnapshot();
    expect(gate.requestPush()).toBe(true);

    gate.beginConnection();
    expect(gate.requestPush()).toBe(false);
    expect(gate.completeInitialSnapshot()).toBe(true);
  });

  it("accepts a populated initial snapshot even when the local marker is newer", () => {
    expect(shouldAcceptSyncDaySnapshot({
      remoteDate: "2030-06-01",
      localDate: "2030-06-01",
      remoteResetAt: 1000,
      localResetAt: 2000,
      initialSnapshot: true,
    })).toBe(true);
  });

  it("still rejects an ordinary stale non-initial frame when local state is newer", () => {
    expect(shouldAcceptSyncDaySnapshot({
      remoteDate: "2030-06-01",
      localDate: "2030-06-01",
      remoteResetAt: 1000,
      localResetAt: 2000,
      initialSnapshot: false,
    })).toBe(false);
  });

  it("uses the atomic path only for the first untouched automatic placeholder", () => {
    const seeded = { id: "seed", brand: "", flavor: "", seeded: true };
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [seeded],
        hasLocalUserEdit: false,
      }),
    ).toBe(true);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: false,
        localRuns: [seeded],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [{ id: "new-run", brand: "", flavor: "" }],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [{ ...seeded, brand: "Acme" }],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [seeded],
        hasLocalUserEdit: true,
      }),
    ).toBe(false);
  });

  it("wires the first SSE frame as authoritative and re-arms the gate on reconnect errors", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const coordinationSource = readFileSync(
      resolve(process.cwd(), "src/hooks/useHomeSyncCoordination.ts"),
      "utf8",
    );
    const lifecycleSource = readFileSync(
      resolve(process.cwd(), "src/hooks/useHomeFormLifecycle.ts"),
      "utf8",
    );
    expect(source).toContain("initialSnapshot: msg.initial === true");
    expect(source).toContain("shouldAtomicallyAdoptFirstSnapshot");
    expect(source).toContain("hasLocalUserEdit: form.formState.isDirty");
    expect(source).toContain("const isReset = atomicSeedSnapshot || remoteResetAt > localResetAt;");
    expect(source).toContain("useHomeFormIdentityFences()");
    expect(lifecycleSource).toContain("formHandoffRef: useRef(false)");
    expect(source).toContain("useHomeSyncCoordination()");
    expect(coordinationSource).toContain("createSyncBaselineGate(synchronizationStateMachineRef.current)");
    const errorHandler = source.match(/es\.onerror = \(\) => \{([\s\S]*?)\n    \};/);
    expect(errorHandler?.[1]).toContain("syncBaselineGateRef.current.beginConnection()");
  });

  it("routes bounded configuration invalidations through canonical sources and recovers all families at a baseline", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain('family?: "master-data" | "profiles" | "factory-data" | "die-types" | "supervisor-pin" | "name-links" | "merged-away"');
    expect(source).toContain("const reconcileConfigurationBaseline");
    expect(source).toContain('"master-data", "profiles", "factory-data", "die-types", "supervisor-pin", "name-links", "merged-away"');
    expect(source).toContain("await invalidateMasterDataBootstrap(cycleCountQc)");
    expect(source).toContain("await reconcileProfilesFromServerDetailed()");
    expect(source).toContain("await fetchFactoryData()");
    expect(source).toContain("await reconcileServerDieTypes()");
    expect(source).toContain('queryKey: ["supervisorPin"]');
    expect(source).toContain("fetchSpecImportAliases().catch");
    expect(source).toContain("refreshPhotoAliasesCache()");
    expect(source).toContain("await fetchMergedAwayNames()");
    expect(source).toContain("if (msg.initial) {");
    expect(source).toContain("reconcileConfigurationBaseline();");
  });

  it("does not refresh configuration from this client's own SSE echo", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const routing = source.slice(
      source.indexOf("(msg.configurationInvalidated || msg.masterDataChanged)"),
      source.indexOf("if (msg.autoTrackSchedule)", source.indexOf("(msg.configurationInvalidated || msg.masterDataChanged)")),
    );
    expect(routing).toContain("shouldRefreshMasterData(msg.senderId, clientId.current)");
  });

  it("replaces profile and master-data interval polling with baseline and foreground reconciliation", () => {
    const home = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const masterData = readFileSync(resolve(process.cwd(), "src/masterData.ts"), "utf8");
    const supervisorPin = readFileSync(resolve(process.cwd(), "src/hooks/useSupervisorPin.ts"), "utf8");
    expect(home).not.toContain('id: "profile-reconcile"');
    expect(home).toContain("reconcileProfilesFromServerDetailed()");
    expect(masterData).toContain("refetchInterval: false");
    expect(masterData).not.toContain("MASTER_DATA_ACTIVE_INTERVAL_MS");
    expect(supervisorPin).toContain("refetchInterval: false");
    expect(supervisorPin).not.toContain("useIdle");
  });

  it("binds the adopted form before it publishes the incoming run selection", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const handoff = source.slice(
      source.indexOf("if (atomicSeedSnapshot) {"),
      source.indexOf("// ── Merge tombstones"),
    );
    expect(handoff).toContain("formHandoffRef.current = true;");
    expect(handoff.indexOf("form.reset(adoptedValues)")).toBeGreaterThan(-1);
    expect(handoff).toContain("lastFormRunIdRef.current = adopted.id;");
    // The state merge is intentionally after the complete form binding block.
    expect(source.indexOf("setDayState(prev =>")).toBeGreaterThan(
      source.indexOf("form.reset(adoptedValues)"),
    );
  });

  it("claims a seed after a genuine form edit without replacing newer day state", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/hooks/useHomeFormLifecycle.ts"),
      "utf8",
    );
    const autosave = source.slice(
      source.indexOf("if (!shouldAutosaveHomeForm("),
      source.indexOf("flashSaved();"),
    );
    expect(autosave).toContain("clearSeededFlagForAutosave(");
    expect(autosave).toContain("dayStateRef.current,");
    expect(autosave).toContain("saveDayState(seededPatch.dayState);");
    expect(autosave).toContain('schedulePush(dayStateRef.current, undefined, "edit");');
    expect(autosave).not.toContain("capturedDayState");
  });

  it("coalesces ordinary edits quickly while keeping recovery pushes immediate", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("const SYNC_EDIT_DEBOUNCE_MS = 120;");
    expect(source).toContain("function schedulePush(");
    expect(source).toContain("delay = SYNC_EDIT_DEBOUNCE_MS");
    expect(source).toContain('id: "periodic-sync-push"');
    expect(source).toContain('run: () => schedulePush(dayStateRef.current, 0, "periodic")');
    expect(source).toMatch(
      /pushTimerRef\.current = setTimeout\(\(\) => \{\s*if \(document\.hidden\) \{\s*foregroundPushPendingRef\.current = true;/,
    );
    expect(source).toContain("syncMeta: { queuedAt: timing.queuedAtEpoch }");
    expect(source).toContain("X-Sync-Response-Bytes");
  });

  it("omits unchanged history from hot pushes and records it only after acknowledgement", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("lastSyncedHistorySigRef");
    expect(source).toContain("historySig !== lastSyncedHistorySigRef.current");
    expect(source).toContain("if (payload.history !== undefined)");
    expect(source).toContain("lastSyncedHistorySigRef.current = JSON.stringify(payload.history)");
  });
});