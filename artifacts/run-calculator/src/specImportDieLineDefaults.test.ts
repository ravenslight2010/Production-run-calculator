// @vitest-environment jsdom
//
// Spec-import die line-setting blank-fill contract. When a spec sheet states
// a profile's die type, applySpecImport blank-fills the line settings
// (crusts/cycle, cycle speed, speed adjustment, freezer time, cases/layer)
// exactly like picking the die by hand on the run form: manager-stored
// overrides (Manage Lists → Die Defaults, passed in by the commit glue) win,
// the built-in hard-coded map is the fallback, and values a user (or prior
// import) already set are NEVER overwritten.

import { describe, it, expect, beforeEach } from "vitest";
import { applySpecImport, loadProfile, saveProfile } from "./storage";
import { DEFAULT_VALUES } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { DieLineDefaultsOverrides } from "./dieDefaults";

beforeEach(() => {
  localStorage.clear();
});

function importWithDie(dieType: string): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Corner Booth",
        flavor: "BBQ CHICKEN",
        dieType,
        applicators: [{ type: "Chicken", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [],
  };
}

const OVERRIDE = {
  crustsPerCycle: 4,
  cycleSpeed: 9,
  speedAdjustment: 0.7,
  freezerTime: 30,
  casesPerLayer: 8,
};

describe("applySpecImport die line-setting blank-fill", () => {
  it("fills blank line settings from the built-in map when no overrides given", () => {
    applySpecImport(importWithDie('7" Dies'));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof).toMatchObject({
      crustsPerCycle: 6,
      cycleSpeed: 8,
      speedAdjustment: 0.85,
      freezerTime: 22,
      casesPerLayer: 6,
    });
  });

  it("prefers the manager's stored override over the built-in map", () => {
    const overrides: DieLineDefaultsOverrides = { '7" dies': OVERRIDE };
    applySpecImport(importWithDie('7" Dies'), undefined, undefined, overrides);
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof).toMatchObject(OVERRIDE);
  });

  it("fills from an override for a die the built-in map does not know", () => {
    const overrides: DieLineDefaultsOverrides = { mystic: OVERRIDE };
    applySpecImport(importWithDie("Mystic"), undefined, undefined, overrides);
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof).toMatchObject(OVERRIDE);
  });

  it("never overwrites line settings a user already set", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      // dieType makes the profile pass saveProfile's real-data guard.
      dieType: '7" Dies',
      crustsPerCycle: 3,
      speedAdjustment: 0.5,
    });
    const overrides: DieLineDefaultsOverrides = { '7" dies': OVERRIDE };
    applySpecImport(importWithDie('7" Dies'), undefined, undefined, overrides);
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    // Touched fields kept, blanks filled from the override.
    expect(prof).toMatchObject({
      crustsPerCycle: 3,
      speedAdjustment: 0.5,
      cycleSpeed: 9,
      freezerTime: 30,
      casesPerLayer: 8,
    });
  });

  it("fills nothing when the sheet states no/unknown die and no override matches", () => {
    applySpecImport(importWithDie("Mystic"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.crustsPerCycle).toBe(DEFAULT_VALUES.crustsPerCycle);
    expect(prof?.freezerTime).toBe(DEFAULT_VALUES.freezerTime);
  });
});
