// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Home sync manager boundary", () => {
  it("keeps transport primitives out of Home", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");

    // These are manager-owned coordination concerns. Home only supplies the
    // canonical state/form callbacks that preserve the existing merge policy.
    expect(home).not.toContain("Event" + "Source");
    expect(home).not.toContain("SingleFlight" + "SyncQueue");
    expect(home).not.toContain("createSync" + "BaselineGate");
    expect(home).not.toMatch(/fetch\(`\/api\/sync\/today[^`]*`,\s*\{\s*method:\s*"PUT"/);
  });

  it("keeps every terminal local-write diagnostic classified for the manager alert", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");
    const terminalWriteSections = [
      home.slice(
        home.indexOf("if (res.status === 401 || res.status === 403)"),
        home.indexOf("// Any other non-success response must follow the retry path below."),
      ),
      home.slice(
        home.indexOf("if (stale) {"),
        home.indexOf("const latencyMs ="),
      ),
      home.slice(
        home.indexOf('recordSyncEvent(\n        "ack"'),
        home.indexOf("// Record the synced signature ONLY after a successful PUT"),
      ),
      home.slice(
        home.indexOf("if (isPermanentSyncWriteRejection(responseStatus))"),
        home.indexOf(
          "syncPushQueueRef.current.finish({ drainQueued: false });",
          home.indexOf("if (isPermanentSyncWriteRejection(responseStatus))"),
        ),
      ),
      home.slice(
        home.indexOf("// All retries exhausted"),
        home.indexOf("syncPushQueueRef.current.finish({ drainQueued: false });", home.indexOf("// All retries exhausted")),
      ),
    ];

    expect(terminalWriteSections.every((section) => section.includes("syncWriteFieldCheck"))).toBe(true);
    expect(home.match(/syncWriteFieldCheck\(/g)).toHaveLength(5);
  });

  it("records duplicate suppression as reconciliation, not a new server acknowledgement", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");
    const duplicateSuppressionEvents = home.match(
      /recordSyncEvent\(\s*"merge",\s*"Queued change already matches the confirmed server state; no duplicate write was sent",\s*"duplicate-suppressed"/g,
    );

    expect(duplicateSuppressionEvents).toHaveLength(3);
    expect(home).not.toMatch(
      /recordSyncEvent\(\s*"ack",\s*"Queued change already matches the confirmed server state; no duplicate write was sent",\s*"duplicate-suppressed"/,
    );
  });

  it("keeps scheduled profile propagation on the causally fenced write contract", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");
    const start = home.indexOf("async function propagateProfileToPendingRunsNow");
    const end = home.indexOf("// Recipe-manager acknowledgements", start);
    const propagation = home.slice(start, end);

    expect(propagation).toContain("!payloadResult.snapshotId");
    expect(propagation).toContain('completeness: "complete"');
    expect(propagation).toContain("baseSnapshotId: payloadResult.snapshotId");
    expect(propagation).toContain("fallback?.partialFallback");
  });

  it("routes stale-base recovery through persisted run-value and live-form adoption", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");
    const recoveryStart = home.indexOf("function rebasePendingSyncWork(");
    const recoveryEnd = home.indexOf("\n  function ", recoveryStart + 1);
    const recovery = home.slice(recoveryStart, recoveryEnd);
    const sentValuesCapture = recovery.indexOf(
      "const sentRunValues = work.payload.runValues ?? {};",
    );
    const recoveredPayloadReplace = recovery.indexOf("work.payload = recovery.payload;");

    expect(sentValuesCapture).toBeGreaterThanOrEqual(0);
    expect(sentValuesCapture).toBeLessThan(recoveredPayloadReplace);
    expect(recovery).toContain("selectUnchangedRunValueIdsForRecovery(");
    expect(recovery).toContain("acceptCanonicalRunValueIds: canonicalRunValueIds,");
    expect(home).toContain("shouldResetLiveFormForSync({");
    expect(home).toContain("explicitRebaseAdoption: explicitCanonicalRunAdoption,");
    expect(home).toContain("if (canResetLiveForm) {");
  });
});
