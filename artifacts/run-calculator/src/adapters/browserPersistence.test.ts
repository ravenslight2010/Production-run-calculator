// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_VALUES, RUN_KEY } from "../types";
import {
  loadRunValues,
  loadRunValuesUpdated,
  markRunValuesUpdated,
  saveRunValues,
  subscribeRunValuesWrites,
} from "./browserRunPersistence";
import { applyResetWipe, getStoredResetEpoch } from "./browserResetPersistence";

afterEach(() => localStorage.clear());

describe("browser run persistence", () => {
  it("normalizes legacy values on cache reads without changing the stored contract", () => {
    localStorage.setItem(RUN_KEY("legacy"), JSON.stringify({
      pep1Type: "Pep - Cured",
      dieType: '11" dies',
      cartoned: "yes",
      mixerLowSec: 0,
      mixerHighSec: 0,
      hopperSec: 0,
    }));
    const values = loadRunValues("legacy");
    expect(values.pep1Type).not.toBe("Pep - Cured");
    expect(values.dieType).toBe('11"');
    expect(values.cartoned).toBe("cartoned");
    expect(values.mixerLowSec).toBe(DEFAULT_VALUES.mixerLowSec);
  });

  it("publishes every run-value write and persists monotonic value timestamps", () => {
    const writes: string[] = [];
    const unsubscribe = subscribeRunValuesWrites((id) => writes.push(id));
    saveRunValues("run-a", { ...DEFAULT_VALUES, casesNeeded: 12 });
    markRunValuesUpdated("run-a", 123);
    unsubscribe();
    expect(writes).toEqual(["run-a"]);
    expect(loadRunValues("run-a").casesNeeded).toBe(12);
    expect(loadRunValuesUpdated()).toEqual({ "run-a": 123 });
  });
});

describe("browser reset persistence", () => {
  it("wipes run-calculator cache keys once and retains the honored epoch", () => {
    localStorage.setItem("run-calc-day", "old");
    localStorage.setItem("run-calc-profile-a", "old");
    localStorage.setItem("unrelated", "keep");
    expect(applyResetWipe(7)).toBe(true);
    expect(getStoredResetEpoch()).toBe(7);
    expect(localStorage.getItem("run-calc-day")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(applyResetWipe(7)).toBe(false);
    expect(applyResetWipe(6)).toBe(false);
  });
});