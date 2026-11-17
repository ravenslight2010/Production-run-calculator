import { describe, expect, it } from "vitest";
import { shouldSeedCarriedOverSauce } from "./sauceCarryoverSeed";

const carriedOverSauce = {
  currentRunId: "run-1",
  seededRunId: null,
  runStatus: "running",
  prepCarriedOver: true,
  prepBatchesSauce: 2,
  sauceBarrelsMade: 0,
};

describe("shouldSeedCarriedOverSauce", () => {
  it("seeds a carried-over prep batch once for its run", () => {
    expect(shouldSeedCarriedOverSauce(carriedOverSauce)).toBe(true);
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      seededRunId: "run-1",
    })).toBe(false);
  });

  it("does not seed again when a manual decrement returns the count to zero", () => {
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      seededRunId: "run-1",
      sauceBarrelsMade: 0,
    })).toBe(false);
  });

  it("allows the next run to seed its own carried-over prep", () => {
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      currentRunId: "run-2",
      seededRunId: "run-1",
    })).toBe(true);
  });

  it("requires a running run, carried-over prep, and a positive batch count", () => {
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      runStatus: "paused",
    })).toBe(false);
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      prepCarriedOver: false,
    })).toBe(false);
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      prepBatchesSauce: 0,
    })).toBe(false);
    expect(shouldSeedCarriedOverSauce({
      ...carriedOverSauce,
      currentRunId: null,
    })).toBe(false);
  });
});