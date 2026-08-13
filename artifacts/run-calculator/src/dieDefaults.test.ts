import { describe, it, expect } from "vitest";
import {
  dieLineDefaultsFor,
  resolveDieLineDefaults,
  resolveDieLineDefaultsOnSwitch,
  resolveCrustLineDefaults,
} from "./dieDefaults";

const BLANK = {
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  freezerTime: 0,
  casesPerLayer: 0,
  preTunnelMin: 0,
  postTunnelMin: 0,
};

describe("dieLineDefaultsFor", () => {
  it('matches 7" variants', () => {
    for (const name of ['7"', "7in", "7 in", "7 inch", '7" Dies']) {
      expect(dieLineDefaultsFor(name)).toEqual({
        crustsPerCycle: 6,
        cycleSpeed: 8,
        speedAdjustment: 0.85,
        freezerTime: 22,
        casesPerLayer: 6,
        preTunnelMin: 3.5,
        postTunnelMin: 3.0,
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

  it('11"/Argus has no tunnel-time override (generic 2.5-min fallback applies)', () => {
    const d = dieLineDefaultsFor("Argus Dies");
    expect(d).not.toBeNull();
    expect(d).not.toHaveProperty("preTunnelMin");
    expect(d).not.toHaveProperty("postTunnelMin");
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
      preTunnelMin: 3.5,
      postTunnelMin: 3.0,
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

  it("fills preTunnelMin / postTunnelMin when still 0 (stored untouched default)", () => {
    const filled = resolveDieLineDefaults('7"', BLANK);
    expect(filled).toMatchObject({ preTunnelMin: 3.5, postTunnelMin: 3.0 });
  });

  it("fills preTunnelMin / postTunnelMin when at the generic 2.5-min display fallback", () => {
    // 2.5 is PRE_POST_TUNNEL_DEFAULT_MIN — the fallback shown when value is 0.
    // It is also "untouched" for these fields, so the die-specific value wins.
    const cur = { ...BLANK, preTunnelMin: 2.5, postTunnelMin: 2.5 };
    const filled = resolveDieLineDefaults('7"', cur);
    expect(filled).toMatchObject({ preTunnelMin: 3.5, postTunnelMin: 3.0 });
  });

  it("does NOT overwrite a user-typed custom tunnel time", () => {
    const cur = { ...BLANK, preTunnelMin: 4.5 };
    const filled = resolveDieLineDefaults('7"', cur);
    expect(filled).not.toHaveProperty("preTunnelMin");
    expect(filled).toMatchObject({ postTunnelMin: 3.0 }); // other tunnel field still fills
  });

  it('11"/Argus has no tunnel override — resolveDieLineDefaults leaves tunnel fields alone', () => {
    const filled = resolveDieLineDefaults("Argus Dies", BLANK);
    expect(filled).not.toHaveProperty("preTunnelMin");
    expect(filled).not.toHaveProperty("postTunnelMin");
  });

  it("returns empty object for unknown dies", () => {
    expect(resolveDieLineDefaults("Mystic", BLANK)).toEqual({});
  });
});

describe("manager overrides", () => {
  const OVERRIDE = { crustsPerCycle: 4, cycleSpeed: 9, speedAdjustment: 0.7, freezerTime: 30, casesPerLayer: 8 };

  it("a stored override wins over the built-in map (case-insensitive by name)", () => {
    const overrides = { '7" dies': OVERRIDE };
    // Override fields win; built-in tunnel times backfill since OVERRIDE has none.
    const result = dieLineDefaultsFor('7" Dies', overrides);
    expect(result).toMatchObject(OVERRIDE);
    expect(result).toMatchObject({ preTunnelMin: 3.5, postTunnelMin: 3.0 });
    // resolveDieLineDefaults fills all untouched fields from the merged result.
    const filled = resolveDieLineDefaults('7" DIES', BLANK, overrides);
    expect(filled).toMatchObject(OVERRIDE);
    expect(filled).toMatchObject({ preTunnelMin: 3.5, postTunnelMin: 3.0 });
  });

  it("7\" override without tunnel fields still gets die-specific built-in tunnel times", () => {
    // This is the key fix: saving a 7" entry without preTunnelMin/postTunnelMin
    // must NOT lose the 3.5/3.0 built-in values — they back-fill from SEVEN.
    const overrides = { '7"': OVERRIDE };
    const result = dieLineDefaultsFor('7"', overrides);
    expect(result).toMatchObject({ preTunnelMin: 3.5, postTunnelMin: 3.0 });
  });

  it("12\" override without tunnel fields gets 2.0/2.0 built-in tunnel times", () => {
    const overrides = { '12"': OVERRIDE };
    const result = dieLineDefaultsFor('12"', overrides);
    expect(result).toMatchObject({ preTunnelMin: 2.0, postTunnelMin: 2.0 });
  });

  it("partial tunnel override: only one field stored, other comes from built-in", () => {
    const partial = { ...OVERRIDE, preTunnelMin: 4.5 };
    const overrides = { '7"': partial };
    const result = dieLineDefaultsFor('7"', overrides);
    expect(result).toMatchObject({ preTunnelMin: 4.5, postTunnelMin: 3.0 });
  });

  it("explicit tunnel overrides in stored entry win over built-in", () => {
    const withTunnel = { ...OVERRIDE, preTunnelMin: 5.0, postTunnelMin: 4.0 };
    const overrides = { '7"': withTunnel };
    const result = dieLineDefaultsFor('7"', overrides);
    expect(result).toMatchObject({ preTunnelMin: 5.0, postTunnelMin: 4.0 });
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
  const SEVEN_FILLED = {
    crustsPerCycle: 6,
    cycleSpeed: 8,
    speedAdjustment: 0.85,
    freezerTime: 22,
    casesPerLayer: 6,
    preTunnelMin: 3.5,
    postTunnelMin: 3.0,
  };

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
    // Tunnel times switch from 7"'s 3.5/3.0 to 12"'s 2.0/2.0
    expect(fills).toMatchObject({ preTunnelMin: 2.0, postTunnelMin: 2.0 });
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
    // Switching TO the override die from 7"'s fill applies the override.
    // The override has no tunnel fields — tunnel values are recognized auto-fill
    // (3.5 / 3.0 from 7") so they get reset to 0 (generic 2.5 fallback applies).
    const toMystic = resolveDieLineDefaultsOnSwitch("Mystic", SEVEN_FILLED, overrides);
    expect(toMystic).toMatchObject(OVERRIDE);
    expect(toMystic).toMatchObject({ preTunnelMin: 0, postTunnelMin: 0 });
  });

  it('switching to 11"/Argus resets prior die tunnel values to 0 (generic fallback)', () => {
    // After using 7": preTunnelMin=3.5, postTunnelMin=3.0
    const from7 = resolveDieLineDefaultsOnSwitch("Argus Dies", SEVEN_FILLED);
    expect(from7).toMatchObject({ preTunnelMin: 0, postTunnelMin: 0 });

    // After using 12": preTunnelMin=2.0, postTunnelMin=2.0
    const twelve_filled = { ...BLANK, crustsPerCycle: 5, cycleSpeed: 8, speedAdjustment: 1, freezerTime: 15, preTunnelMin: 2.0, postTunnelMin: 2.0 };
    const from12 = resolveDieLineDefaultsOnSwitch("11in", twelve_filled);
    expect(from12).toMatchObject({ preTunnelMin: 0, postTunnelMin: 0 });

    // A user-typed tunnel value that matches no die's default must NOT be reset.
    const withCustomTunnel = { ...SEVEN_FILLED, preTunnelMin: 4.8 };
    const fromCustom = resolveDieLineDefaultsOnSwitch("Argus Dies", withCustomTunnel);
    expect(fromCustom).not.toHaveProperty("preTunnelMin");
  });

  it('switching to 11"/Argus with tunnel at 2.5 (display fallback) resets to 0', () => {
    // 2.5 is the generic fallback — also recognized as "auto-fill"
    const cur = { ...BLANK, preTunnelMin: 2.5, postTunnelMin: 2.5 };
    const fills = resolveDieLineDefaultsOnSwitch("Argus Dies", cur);
    expect(fills).toMatchObject({ preTunnelMin: 0, postTunnelMin: 0 });
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
