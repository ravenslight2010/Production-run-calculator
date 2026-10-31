import { describe, expect, it } from "vitest";
import {
  applyPreparedMixHandoffs,
  buildPreparedMixRunHandoffs,
  parsePreparedMixHandoff,
  preparedMixHandoffClaimId,
  preparedMixItemKey,
  serializePreparedMixHandoff,
  type PreparedMixHandoff,
} from "./preparedMixHandoff";

const contract: PreparedMixHandoff = {
  version: 1,
  eventDate: "2026-07-03",
  mixId: "mix-a",
  mixName: "Prepared Onion Mix",
  preparedItemKey: preparedMixItemKey("mix-a"),
  sourceFactors: [{ itemKey: "ingredient:Onion:lbs", factor: 1 }],
};

describe("prepared mix handoff contract", () => {
  it("round-trips versioned metadata and scopes its one-time claim to a run", () => {
    const note = serializePreparedMixHandoff(contract);
    expect(parsePreparedMixHandoff(note)).toEqual(contract);
    expect(preparedMixHandoffClaimId("run-a")).not.toBe(
      preparedMixHandoffClaimId("run-b"),
    );
  });

  it("replaces only the raw-source line and sums prepared pounds", () => {
    const actual = applyPreparedMixHandoffs(
      new Map([
        ["ingredient:Onion:lbs", 8],
        ["packaging:circles:12in", 20],
      ]),
      [contract],
    );
    expect(actual).toEqual(new Map([
      [preparedMixItemKey("mix-a"), 8],
      ["packaging:circles:12in", 20],
    ]));
  });

  it("combines component source lines into one prepared mix quantity", () => {
    const second = {
      ...contract,
      sourceFactors: [{ itemKey: "ingredient:Garlic:lbs", factor: 1 }],
    };
    expect(applyPreparedMixHandoffs(
      new Map([
        ["ingredient:Onion:lbs", 3],
        ["ingredient:Garlic:lbs", 2],
      ]),
      [contract, second],
    )).toEqual(new Map([[preparedMixItemKey("mix-a"), 5]]));
  });

  it("fails closed on corrupt, unsupported, or duplicate source mappings", () => {
    expect(() => parsePreparedMixHandoff("prepared-mix-handoff:v1:{broken"))
      .toThrow("audit record is invalid");
    expect(() => parsePreparedMixHandoff(
      serializePreparedMixHandoff({ ...contract, version: 2 } as unknown as PreparedMixHandoff),
    )).toThrow("audit record is invalid");
    expect(() => applyPreparedMixHandoffs(
      new Map([["ingredient:Onion:lbs", 2]]),
      [contract, { ...contract, preparedItemKey: preparedMixItemKey("mix-b") }],
    )).toThrow("conflicting source mappings");
  });

  it("allocates the existing waste and startup basis across contributing runs", () => {
    const result = buildPreparedMixRunHandoffs({
      eventDate: "2026-07-03",
      mixId: "mix-a",
      mixName: "Prepared Onion Mix",
      preparedItemKey: preparedMixItemKey("mix-a"),
      totalLbs: 34.375,
      startupLbs: 20,
      components: [{ ingredient: "Onion", lbs: 12.5, fallbackOzPerPizza: 2 }],
      runs: [{
        runId: "run-a",
        date: "2026-07-03",
        brand: "brand",
        flavor: "flavor",
        cases: 10,
        pizzas: 100,
        ingredients: ["Onion"],
        ingredientOzPerPizza: { Onion: 2 },
        sourceLines: new Map([["ingredient:Onion:lbs", 12.5]]),
        sourceUnitPounds: new Map([["ingredient:Onion:lbs", 1]]),
      }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.preparedLbs).toBeCloseTo(34.375);
    expect(result[0]?.contract.sourceFactors[0]?.factor).toBeCloseTo(2.75);
  });

  it("rejects a source batch key when its production conversion is ambiguous", () => {
    expect(() => buildPreparedMixRunHandoffs({
      eventDate: "2026-07-03",
      mixId: "mix-a",
      mixName: "Prepared Onion Mix",
      preparedItemKey: preparedMixItemKey("mix-a"),
      totalLbs: 34.375,
      startupLbs: 20,
      components: [{ ingredient: "Onion", lbs: 12.5 }],
      runs: [{
        runId: "run-a",
        date: "2026-07-03",
        brand: "brand",
        flavor: "flavor",
        cases: 10,
        pizzas: 100,
        ingredients: ["Onion"],
        ingredientOzPerPizza: { Onion: 2 },
        sourceLines: new Map([["ingredient:Onion:batches", 4]]),
        sourceUnitPounds: new Map(),
      }],
    })).toThrow("unmapped production unit");
  });

  it("scales a run handoff to the stored actual-case ratio without changing the plan", () => {
    const result = buildPreparedMixRunHandoffs({
      eventDate: "2026-07-03",
      mixId: "mix-a",
      mixName: "Prepared Onion Mix",
      preparedItemKey: preparedMixItemKey("mix-a"),
      totalLbs: 34.375,
      startupLbs: 20,
      components: [{ ingredient: "Onion", lbs: 12.5, fallbackOzPerPizza: 2 }],
      runs: [{
        runId: "run-a",
        date: "2026-07-03",
        brand: "brand",
        flavor: "flavor",
        cases: 10,
        pizzas: 100,
        productionScale: 0.5,
        ingredients: ["Onion"],
        ingredientOzPerPizza: { Onion: 2 },
        sourceLines: new Map([["ingredient:Onion:lbs", 6.25]]),
        sourceUnitPounds: new Map([["ingredient:Onion:lbs", 1]]),
      }],
    });
    expect(result[0]?.preparedLbs).toBeCloseTo(17.1875);
    expect(result[0]?.contract.sourceFactors[0]?.factor).toBeCloseTo(2.75);
  });
});
