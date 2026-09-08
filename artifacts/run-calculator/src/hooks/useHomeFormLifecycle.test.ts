import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES } from "../types";
import { clearSeededFlagForAutosave, shouldAutosaveHomeForm } from "./useHomeFormLifecycle";

describe("Home form lifecycle fences", () => {
  it("rejects watch emissions until the form is settled for the selected run", () => {
    const changed = { ...DEFAULT_VALUES, casesNeeded: 20 };
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-b", false)).toBe(false);
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-a", true)).toBe(false);
  });

  it("accepts only a nonblank, changed value for its settled run", () => {
    const changed = { ...DEFAULT_VALUES, casesNeeded: 20 };
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-a", false)).toBe(true);
    expect(shouldAutosaveHomeForm(changed, changed, "run-a", "run-a", false)).toBe(false);
    expect(shouldAutosaveHomeForm(changed, DEFAULT_VALUES, "run-a", "run-a", false)).toBe(false);
  });

  it("clears a seed without replacing concurrently adopted same-run metadata", () => {
    const adopted = {
      date: "2026-09-08",
      currentIndex: 0,
      runs: [{
        id: "run-a",
        brand: "Adopted Brand",
        flavor: "Peer Flavor",
        notes: "remote note",
        metaUpdatedAt: 900,
        seeded: true,
      }],
      substitutions: [],
      substitutionLog: [],
      stagedItems: { "run-a::Boxes__case": true },
    };

    const result = clearSeededFlagForAutosave(adopted, "run-a", true);

    expect(result.changed).toBe(true);
    expect(result.dayState).toEqual({
      ...adopted,
      runs: [{ ...adopted.runs[0], seeded: false }],
    });
  });

  it("does not clear a seed after selection moves to another run", () => {
    const current = {
      date: "2026-09-08",
      currentIndex: 1,
      runs: [
        { id: "run-a", brand: "", flavor: "", seeded: true },
        { id: "run-b", brand: "", flavor: "" },
      ],
    };
    expect(clearSeededFlagForAutosave(current, "run-a", true)).toEqual({
      dayState: current,
      changed: false,
    });
  });
});