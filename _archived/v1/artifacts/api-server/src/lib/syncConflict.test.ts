import { describe, expect, it } from "vitest";
import { detectConflicts } from "./syncConflict";

const existing = { dayState: { runs: [{ id: "r1" }] }, runValues: { r1: { casesNeeded: 100 } } };

describe("detectConflicts", () => {
  it("flags a blank-over-populated run value", () => {
    const incoming = { ...existing, runValues: { r1: {} } };
    const merged = { ...existing };
    const result = detectConflicts(incoming, existing, merged);

    expect(result?.fieldsWithConflicts).toEqual(["runValues:r1"]);
    expect(result?.conflictCount).toBe(1);
  });

  it("flags a stale-stamp run value when the stored value wins", () => {
    const incoming = {
      ...existing,
      runValues: { r1: { casesNeeded: 200 } },
      runValuesUpdatedAt: { r1: 10 },
    };
    const merged = {
      ...existing,
      runValuesUpdatedAt: { r1: 20 },
    };
    const result = detectConflicts(incoming, existing, merged);

    expect(result?.fieldsWithConflicts).toEqual(["runValues:r1"]);
  });

  it("flags runs appended from the stored row", () => {
    const incoming = { dayState: { runs: [{ id: "r1" }] }, runValues: {} };
    const merged = {
      dayState: { runs: [{ id: "r1" }, { id: "r2" }] },
      runValues: {},
    };
    const result = detectConflicts(incoming, existing, merged);

    expect(result?.fieldsWithConflicts).toContain("dayState.runs:appended(1)");
  });

  it("returns null for a clean push", () => {
    const payload = {
      dayState: { runs: [{ id: "r1" }] },
      runValues: { r1: { casesNeeded: 100 } },
    };

    expect(detectConflicts(payload, payload, payload)).toBeNull();
  });
});