import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES } from "../types";
import { shouldAutosaveHomeForm } from "./useHomeFormLifecycle";

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
});