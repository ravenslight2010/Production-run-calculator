import { describe, it, expect } from "vitest";
import {
  dieLineDefaultsFor,
  resolveDieLineDefaults,
  resolveDieLineDefaultsOnSwitch,
  resolveCrustLineDefaults,
} from "./dieDefaults";

const BLANK = { crustsPerCycle: 0, cycleSpeed: 0, speedAdjustment: 1.0, freezerTime: 0, casesPerLayer: 0 };

describe("dieLineDefaultsFor", () => {
  it('matches 7" variants', () => {
    for (const name of ['7"', "7in", "7 in", "7 inch", '7" Dies']) {
      expect(dieLineDefaultsFor(name)).toEqual({
        crustsPerCycle: 6,
        cycleSpeed: 8,
        speedAdjustment: 0.85,
        freezerTime: 22,
        casesPerLayer: 6,
      });
    }
  });

  it('matches 12" variants', () => {
    for (const name of ['12"', "12in", '12" dies']) {
      expect(dieLineDefaultsFor(name)).toMatchObject({ crustsPerCycle: 5, freezerTime: 15, speedAdjustment: 1 });
    }
  });

  it('matches 11" and Argus variants to the same group', () => {
    for (const name of ['11"', "11in", "Argus Dies", "argus", '11" Dies']) {
      expect(dieLineDefaultsFor(name)).toMatchObject({ crustsPerCycle: 5, freezerTime: 16, speedAdjustment: 1 });
    }
  });

  it("returns null for unknown or blank dies", () => {
    expect(dieLineDefaultsFor("")).toBeNull();
    expect(dieLineDefaultsFor("Mystic")).toBeNull();
    expect(dieLineDefaultsFor("9in")).toBeNull();
  });
});

describe("resolveDieLineDefaults", () => {
  it("fills every field on an untouched form", () => {
    expect(resolveDieLineDefaults('7"', BLANK)).toEqual({
      crustsPerCycle: 6,
      cycleSpeed: 8,
      speedAdjustment: 0.85,
      freezerTime: 22,
      casesPerLayer: 6,
    });
  });

  it("never overwrites a user-changed value", () => {
    const cur = { ...BLANK, cycleSpeed: 7.5, freezerTime: 30 };
    const filled = resolveDieLineDefaults('7"', cur);
    expect(filled).not.toHaveProperty("cycleSpeed");
    expect(filled).not.toHaveProperty("freezerTime");
    expect(filled).toMatchObject({ crustsPerCycle: 6, speedAdjustment: 0.85, casesPerLayer: 6 });
  });

  it("treats speedAdjustment 1.0 as untouched (fills 0.85 for 7in)", () => {
    expect(resolveDieLineDefaults("7in", { ...BLANK, speedAdjustment: 1.0 })).toMatchObject({
      speedAdjustment: 0.85,
    });
    // but a hand-set 0.9 stays
    expect(resolveDieLineDefaults("7in", { ...BLANK, speedAdjustment: 0.9 })).not.toHaveProperty(
      "speedAdjustment",
    );
  });

  it("omits fields already equal to the target (12in speedAdjustment 1 == untouched 1)", () => {
    const filled = resolveDieLineDefaults('12"', BLANK);
    expect(filled).not.toHaveProperty("speedAdjustment");
    expect(filled).toMatchObject({ crustsPerCycle: 5, cycleSpeed: 8, freezerTime: 15, casesPerLayer: 6 });
  });

  it("returns empty object for unknown dies", () => {
    expect(resolveDieLineDefaults("Mystic", BLANK)).toEqual({});
  });
});

describe("manager overrides", () => {
  const OVERRIDE = { crustsPerCycle: 4, cycleSpeed: 9, speedAdjustment: 0.7, freezerTime: 30, casesPerLayer: 8 };

  it("a stored override wins over the built-in map (case-insensitive by name)", () => {
    const overrides = { '7" dies': OVERRIDE };
    expect(dieLineDefaultsFor('7" Dies', overrides)).toEqual(OVERRIDE);
    expect(resolveDieLineDefaults('7" DIES', BLANK, overrides)).toEqual(OVERRIDE);
  });

  it("an override enables pre-fill for dies the built-in map doesn't know", () => {
    const overrides = { mystic: OVERRIDE };
    expect(dieLineDefaultsFor("Mystic", overrides)).toEqual(OVERRIDE);
    expect(resolveDieLineDefaults("Mystic", BLANK, overrides)).toEqual(OVERRIDE);
  });

  it("dies without an override still fall back to the built-in map", () => {
    const overrides = { mystic: OVERRIDE };
    expect(dieLineDefaultsFor('7"', overrides)).toMatchObject({ crustsPerCycle: 6, freezerTime: 22 });
  });

  it("overrides still respect the blank-fill-only rule", () => {
    const overrides = { '7"': OVERRIDE };
    const filled = resolveDieLineDefaults('7"', { ...BLANK, cycleSpeed: 7.5 }, overrides);
    expect(filled).not.toHaveProperty("cycleSpeed");
    expect(filled).toMatchObject({ crustsPerCycle: 4, freezerTime: 30 });
  });
});

describe("resolveDieLineDefaultsOnSwitch", () => {
  const SEVEN_FILLED = { crustsPerCycle: 6, cycleSpeed: 8, speedAdjustment: 0.85, freezerTime: 22, casesPerLayer: 6 };

  it("fills every field on an untouched form (same as blank-fill)", () => {
    expect(resolveDieLineDefaultsOnSwitch('7"', BLANK)).toEqual(SEVEN_FILLED);
  });

  it("A→B switch replaces A's auto-filled values with B's", () => {
    // Form currently holds 7" auto-fill; switching to 12" must replace them.
    const fills = resolveDieLineDefaultsOnSwitch('12"', SEVEN_FILLED);
    expect(fills).toMatchObject({ crustsPerCycle: 5, freezerTime: 15, speedAdjustment: 1 });
    // cycleSpeed/casesPerLayer are already 8/6 == 12"'s defaults — no-op omitted
    expect(fills).not.toHaveProperty("cycleSpeed");
    expect(fills).not.toHaveProperty("casesPerLayer");
  });

  it("user-typed values that match no die's defaults survive a switch", () => {
    const cur = { ...SEVEN_FILLED, cycleSpeed: 7.5, freezerTime: 30 };
    const fills = resolveDieLineDefaultsOnSwitch('12"', cur);
    expect(fills).not.toHaveProperty("cycleSpeed");
    expect(fills).not.toHaveProperty("freezerTime");
    expect(fills).toMatchObject({ crustsPerCycle: 5, speedAdjustment: 1 });
  });

  it("reselecting the same die re-applies its defaults over stale values", () => {
    // e.g. field was later blanked or holds another die's fill
    const cur = { ...SEVEN_FILLED, freezerTime: 15 }; // 15 == 12" default
    expect(resolveDieLineDefaultsOnSwitch('7"', cur)).toEqual({ freezerTime: 22 });
    // fully matching its own defaults → nothing to fill
    expect(resolveDieLineDefaultsOnSwitch('7"', SEVEN_FILLED)).toEqual({});
  });

  it("treats a manager-override die's values as replaceable auto-fill", () => {
    const OVERRIDE = { crustsPerCycle: 4, cycleSpeed: 9, speedAdjustment: 0.7, freezerTime: 30, casesPerLayer: 8 };
    const overrides = { mystic: OVERRIDE };
    // Form holds Mystic's override fill; switching to 7" replaces it.
    const fills = resolveDieLineDefaultsOnSwitch('7"', OVERRIDE, overrides);
    expect(fills).toEqual(SEVEN_FILLED);
    // And switching TO the override die from 7"'s fill applies the override.
    expect(resolveDieLineDefaultsOnSwitch("Mystic", SEVEN_FILLED, overrides)).toEqual(OVERRIDE);
  });

  it("still returns empty for unknown dies", () => {
    expect(resolveDieLineDefaultsOnSwitch("Mystic", BLANK)).toEqual({});
  });

  it("blank-fill resolver stays strict: A's fill is NOT replaced by resolveDieLineDefaults", () => {
    const fills = resolveDieLineDefaults('12"', SEVEN_FILLED);
    expect(fills).not.toHaveProperty("crustsPerCycle");
    expect(fills).not.toHaveProperty("freezerTime");
  });
});

describe("resolveCrustLineDefaults", () => {
  it("fills all crust defaults on an untouched form", () => {
    const fills = resolveCrustLineDefaults({
      approxLineSpeed: 0,
      speedAdjustment: 1.0,
      freezerTime: 0,
      casesPerLayer: 0,
    });
    expect(fills).toEqual({
      approxLineSpeed: 40,
      freezerTime: 9.2,
      casesPerLayer: 2,
      // speedAdjustment already 1 (untouched) — no-op fill omitted
    });
  });

  it("never overwrites values the user already changed", () => {
    const fills = resolveCrustLineDefaults({
      approxLineSpeed: 35,
      speedAdjustment: 0.9,
      freezerTime: 12,
      casesPerLayer: 4,
    });
    expect(fills).toEqual({});
  });

  it("fills only the still-untouched fields", () => {
    const fills = resolveCrustLineDefaults({
      approxLineSpeed: 0,
      speedAdjustment: 0.9,
      freezerTime: 10,
      casesPerLayer: 0,
    });
    expect(fills).toEqual({ approxLineSpeed: 40, casesPerLayer: 2 });
  });

  it("does not touch crustsPerCase / crustsPerStack", () => {
    const fills = resolveCrustLineDefaults({});
    expect(fills).not.toHaveProperty("crustsPerCase");
    expect(fills).not.toHaveProperty("crustsPerStack");
  });
});
