import { describe, it, expect } from "vitest";
import { dieLineDefaultsFor, resolveDieLineDefaults, resolveCrustLineDefaults } from "./dieDefaults";

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
