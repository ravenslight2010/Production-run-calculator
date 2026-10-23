import { describe, expect, it } from "vitest";
import { isExactOperationalCommandRetry } from "./operationalCommandIdentity";

describe("operational command retry identity", () => {
  const command = {
    actorId: "operator", deviceId: "device", baseRevision: 7,
    actionData: { runId: "run", action: "correction", values: { traysOnLine: 2 } },
  };
  const receipt = { ...command, commandType: "operational-intent" };

  it("permits the exact operation independently of JSON key order", () => {
    expect(isExactOperationalCommandRetry(receipt, {
      ...command,
      actionData: { values: { traysOnLine: 2 }, action: "correction", runId: "run" },
    })).toBe(true);
  });

  it.each([
    { actorId: "other-operator" },
    { deviceId: "other-device" },
    { baseRevision: 8 },
    { actionData: { ...command.actionData, values: { traysOnLine: 9 } } },
    { actionData: { ...command.actionData, runId: "other-run" } },
  ])("rejects a substituted operation: %j", (patch) => {
    expect(isExactOperationalCommandRetry(receipt, { ...command, ...patch })).toBe(false);
  });

  it("does not reuse another command channel's receipt", () => {
    expect(isExactOperationalCommandRetry({ ...receipt, commandType: "auto-track" }, command)).toBe(false);
  });
});
