// @vitest-environment node
//
// Regression guard for the daily contaminated "Unnamed Run" rows. When the
// CURRENT RUN id changes without an imperative run-switch handler firing
// form.reset — e.g. a peer's day RESET (or a fully-tombstoned run union) seeds
// a fresh blank placeholder run and the sync-apply index clamp lands on it —
// the live form still shows the PREVIOUS run's values. The old heal-effect
// else-branch marked the form "settled" for the new run in that state, so the
// very next form.watch autosave wrote the previous run's casesNeeded /
// skidsCompleted / full recipes into the blank run's localStorage slot. Those
// contaminated blanks then reached the server (before isPristineSeedRun was
// widened) as "Unnamed Run" rows carrying the first real run's data.
//
// shouldResetFormOnRunSwitch is the pure decision behind the fix: when the
// form is NOT settled for the new run and its values differ from the new
// run's stored (default-merged) copy, the form must be RESET to the stored
// copy instead of being settled as-is.

import { describe, it, expect } from "vitest";
import { shouldResetFormOnRunSwitch } from "./storage";
import { DEFAULT_VALUES, type FormValues } from "./types";

const previousRunValues = (): FormValues => ({
  ...DEFAULT_VALUES,
  casesNeeded: 144,
  skidsCompleted: 2,
  doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
});

describe("shouldResetFormOnRunSwitch", () => {
  it("resets when the unsettled form still shows the previous run's values over a blank run (the contamination case)", () => {
    // This IS the "Unnamed Run with the first real run's data" bug: if this
    // returns false, the autosave copies the old run's values into the blank
    // placeholder's slot again.
    expect(
      shouldResetFormOnRunSwitch(previousRunValues(), { ...DEFAULT_VALUES }, false),
    ).toBe(true);
  });

  it("resets when the unsettled form differs from a POPULATED stored copy too (wrong product shown)", () => {
    const stored = { ...DEFAULT_VALUES, casesNeeded: 480 };
    expect(shouldResetFormOnRunSwitch(previousRunValues(), stored, false)).toBe(true);
  });

  it("does not reset when the form already matches the new run's stored copy (fresh device, both default)", () => {
    expect(
      shouldResetFormOnRunSwitch({ ...DEFAULT_VALUES }, { ...DEFAULT_VALUES }, false),
    ).toBe(false);
  });

  it("does not reset when the form matches a populated stored copy (imperative switch already loaded it)", () => {
    const vals = previousRunValues();
    expect(shouldResetFormOnRunSwitch(vals, { ...vals }, false)).toBe(false);
  });

  it("never resets a form that is already settled for this run (genuine in-progress edits win)", () => {
    // The operator is editing the CURRENT run: values differ from stored by
    // design (that's what autosave persists). Settled forms are untouchable.
    expect(
      shouldResetFormOnRunSwitch(previousRunValues(), { ...DEFAULT_VALUES }, true),
    ).toBe(false);
    const stored = { ...DEFAULT_VALUES, casesNeeded: 480 };
    expect(shouldResetFormOnRunSwitch(previousRunValues(), stored, true)).toBe(false);
  });
});
