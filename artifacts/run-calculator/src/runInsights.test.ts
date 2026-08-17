import { describe, it, expect } from "vitest";
import {
  evaluateRunInsights,
  buildTunnelDieDefaultEntry,
  runSpeedDeviation,
  runObservedTunnelMin,
  computeFollowUpNote,
  insightScopeKey,
  type FinishedRunStat,
} from "./runInsights";

// Base run: configured 10 ppm (cycleSpeed 5 × crustsPerCycle 2 × adj 1),
// tunnel 20 min. A perfectly on-target 60-min run produces
// (60 − 20) × 10 = 400 pizzas.
function mkRun(over: Partial<FinishedRunStat> = {}): FinishedRunStat {
  return {
    brand: "Bobo's",
    flavor: "Plain",
    dieType: '7"',
    pizzas: 400,
    cases: 40,
    netMin: 60,
    configuredPpm: 10,
    cycleSpeed: 5,
    freezerTime: 20,
    endedAt: 1_000_000,
    ...over,
  } as FinishedRunStat;
}

describe("runSpeedDeviation", () => {
  it("is ~0 for an on-target run", () => {
    expect(runSpeedDeviation(mkRun())!).toBeCloseTo(0, 6);
  });
  it("is negative when the line ran slow", () => {
    // 360 pizzas in the same window → 9 ppm → −10%
    expect(runSpeedDeviation(mkRun({ pizzas: 360 }))!).toBeCloseTo(-0.1, 6);
  });
  it("returns null for unusable runs", () => {
    expect(runSpeedDeviation(mkRun({ configuredPpm: 0 }))).toBeNull();
    expect(runSpeedDeviation(mkRun({ pizzas: 0 }))).toBeNull();
    expect(runSpeedDeviation(mkRun({ netMin: 15, freezerTime: 20 }))).toBeNull();
  });
});

describe("runObservedTunnelMin", () => {
  it("recovers the configured tunnel for an on-target run", () => {
    expect(runObservedTunnelMin(mkRun())!).toBeCloseTo(20, 6);
  });
  it("shows a longer tunnel when the run took longer at configured speed", () => {
    expect(runObservedTunnelMin(mkRun({ netMin: 65 }))!).toBeCloseTo(25, 6);
  });
});

describe("evaluateRunInsights — speed target", () => {
  it("fires after 2 consistent slow runs", () => {
    const runs = [
      mkRun({ pizzas: 360, endedAt: 2000 }), // −10%
      mkRun({ pizzas: 356, endedAt: 1000 }), // −11%
    ];
    const out = evaluateRunInsights(runs);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("speed-target");
    expect(out[0].configuredValue).toBe(5);
    // mean dev ≈ −10.5% → recommended ≈ 4.47..4.48
    expect(out[0].recommendedValue).toBeGreaterThan(4.4);
    expect(out[0].recommendedValue).toBeLessThan(4.55);
    expect(out[0].runCount).toBe(2);
    expect(out[0].statsLine).toContain("Bobo's Plain");
  });

  it("never fires from a single run", () => {
    expect(evaluateRunInsights([mkRun({ pizzas: 360 })])).toHaveLength(0);
  });

  it("does not fire when deviations point in opposite directions", () => {
    const runs = [
      mkRun({ pizzas: 360, endedAt: 2000 }), // −10%
      mkRun({ pizzas: 440, endedAt: 1000 }), // +10%
    ];
    expect(evaluateRunInsights(runs)).toHaveLength(0);
  });

  it("does not fire below the 5% threshold", () => {
    const runs = [
      mkRun({ pizzas: 392, endedAt: 2000 }), // −2%
      mkRun({ pizzas: 394, endedAt: 1000 }), // −1.5%
    ];
    expect(evaluateRunInsights(runs)).toHaveLength(0);
  });

  it("ignores prior runs recorded under a different configured value", () => {
    const runs = [
      mkRun({ pizzas: 360, endedAt: 2000 }),
      // Same product but old config (ppm 12): must not count toward consistency.
      mkRun({ pizzas: 400, configuredPpm: 12, cycleSpeed: 6, endedAt: 1000 }),
    ];
    expect(evaluateRunInsights(runs)).toHaveLength(0);
  });

  it("scopes per product/die — different products never pool", () => {
    const runs = [
      mkRun({ pizzas: 360, endedAt: 2000 }),
      mkRun({ pizzas: 360, brand: "Other", endedAt: 1000 }),
    ];
    expect(evaluateRunInsights(runs)).toHaveLength(0);
  });

  it("honors the onlyScopes filter", () => {
    const runs = [
      mkRun({ pizzas: 360, endedAt: 2000 }),
      mkRun({ pizzas: 360, endedAt: 1000 }),
    ];
    expect(
      evaluateRunInsights(runs, new Set([insightScopeKey("Other", "Thing", "")])),
    ).toHaveLength(0);
    expect(
      evaluateRunInsights(runs, new Set([insightScopeKey("bobo's", "PLAIN", '7"')])),
    ).toHaveLength(1);
  });
});

describe("evaluateRunInsights — tunnel time", () => {
  it("fires when speed is on target but the tunnel residual is consistently long", () => {
    // With gap g: pizzas = (netMin − ft − g) × ppm ⇒ observed tunnel = ft + g
    // and speedDev = −g/(netMin − ft). Pick g ≈ 2.5–2.8 min on a 60-min
    // production window: rel tunnel dev 12–14% while speed dev stays < 5%.
    const runs = [
      mkRun({ netMin: 80, pizzas: 575, cases: 57, endedAt: 2000 }), // g = 2.5
      mkRun({ netMin: 80, pizzas: 572, cases: 57, endedAt: 1000 }), // g = 2.8
    ];
    const out = evaluateRunInsights(runs);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("tunnel-time");
    expect(out[0].configuredValue).toBe(20);
    expect(out[0].observedValue).toBeGreaterThan(20.5);
    expect(out[0].unit).toBe("min");
  });

  it("does not fire when the speed itself is off (residual not trustworthy)", () => {
    const runs = [
      mkRun({ netMin: 65, pizzas: 360, endedAt: 2000 }),
      mkRun({ netMin: 65, pizzas: 360, endedAt: 1000 }),
    ];
    const out = evaluateRunInsights(runs);
    // Speed dev = 360/45/10 − 1 = −20% → speed suggestion, never tunnel.
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("speed-target");
  });

  it("requires at least 1 minute of absolute gap", () => {
    // 7.5% relative on an 8-min tunnel is only 0.6 min — too small to act on.
    // g = 0.6: pizzas = (50 − 8 − 0.6) × 10 = 414, speedDev ≈ −1.4%.
    const runs = [
      mkRun({ freezerTime: 8, netMin: 50, pizzas: 414, endedAt: 2000 }),
      mkRun({ freezerTime: 8, netMin: 50, pizzas: 414, endedAt: 1000 }),
    ];
    expect(evaluateRunInsights(runs)).toHaveLength(0);
  });
});

describe("buildTunnelDieDefaultEntry", () => {
  const base = {
    crustsPerCycle: 2,
    cycleSpeed: 5,
    speedAdjustment: 1,
    casesPerLayer: 10,
  };

  it("copies the existing base and swaps only freezerTime", () => {
    const entry = buildTunnelDieDefaultEntry('7"', { ...base, preTunnelMin: 3 }, 25);
    expect(entry).toEqual({
      name: '7"',
      crustsPerCycle: 2,
      cycleSpeed: 5,
      speedAdjustment: 1,
      casesPerLayer: 10,
      freezerTime: 25,
      preTunnelMin: 3,
    });
  });

  it("returns null for an unknown/custom die (no base) — never mints a zero override", () => {
    expect(buildTunnelDieDefaultEntry("Custom Die", null, 25)).toBeNull();
  });

  it("returns null when the base itself is incomplete or zero-valued", () => {
    expect(buildTunnelDieDefaultEntry('7"', { ...base, crustsPerCycle: 0 }, 25)).toBeNull();
    expect(buildTunnelDieDefaultEntry('7"', { ...base, cycleSpeed: NaN }, 25)).toBeNull();
  });

  it("returns null for a missing die name or non-positive recommendation", () => {
    expect(buildTunnelDieDefaultEntry("", base, 25)).toBeNull();
    expect(buildTunnelDieDefaultEntry('7"', base, 0)).toBeNull();
  });
});

describe("computeFollowUpNote", () => {
  it("confirms an accurate speed update", () => {
    // Accepted cycleSpeed 4.5 → ppm 9. Run at 9 ppm on the nose.
    const latest = mkRun({ cycleSpeed: 4.5, configuredPpm: 9, pizzas: 360 });
    const note = computeFollowUpNote(latest, { type: "speed-target", recommendedValue: 4.5 });
    expect(note).toMatch(/seems accurate/);
  });

  it("flags a still-off speed after the update", () => {
    const latest = mkRun({ cycleSpeed: 4.5, configuredPpm: 9, pizzas: 320 }); // −11%
    const note = computeFollowUpNote(latest, { type: "speed-target", recommendedValue: 4.5 });
    expect(note).toMatch(/still off/);
  });

  it("waits until the run actually used the accepted value", () => {
    const latest = mkRun(); // still cycleSpeed 5
    expect(computeFollowUpNote(latest, { type: "speed-target", recommendedValue: 4.5 })).toBeNull();
  });

  it("confirms an accurate tunnel update", () => {
    // Accepted 25 min; run shows ~25 residual: netMin 65 at 10 ppm/400 pizzas.
    const latest = mkRun({ freezerTime: 25, netMin: 65 });
    const note = computeFollowUpNote(latest, { type: "tunnel-time", recommendedValue: 25 });
    expect(note).toMatch(/seems accurate/);
  });
});
