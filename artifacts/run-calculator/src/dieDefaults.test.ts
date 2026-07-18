import { describe, it, expect } from "vitest";
import { dieLineDefaultsFor, resolveDieLineDefaults } from "./dieDefaults";

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
