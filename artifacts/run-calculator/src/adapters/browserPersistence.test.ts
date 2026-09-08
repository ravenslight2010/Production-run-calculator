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
import { applyResetWipe, applyRolloverEpoch, getStoredResetEpoch } from "./browserResetPersistence";
import { browserRecordStore } from "./browserRecordStore";

afterEach(() => localStorage.clear());

describe("browser run persistence", () => {
  it("bounds corrupt and schema-invalid records behind the adapter fallback", () => {
    localStorage.setItem("corrupt", "{");
    const record = browserRecordStore.record("corrupt", () => ["fallback"], {
      decode: (value) => Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value as string[] : null,
    });
    expect(record.read()).toEqual(["fallback"]);
    localStorage.setItem("corrupt", JSON.stringify([1]));
    expect(record.read()).toEqual(["fallback"]);
  });
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
  it("adopts a daily rollover without purging profiles or master-data caches", () => {
    localStorage.setItem("run-calc-day", "prior-day");
    localStorage.setItem("run-calc-profile-a", "profile");
    localStorage.setItem("run-calc-cheese-recipes", "master-data");
    expect(applyRolloverEpoch(4)).toBe(true);
    expect(getStoredResetEpoch()).toBe(4);
    expect(localStorage.getItem("run-calc-day")).toBe("prior-day");
    expect(localStorage.getItem("run-calc-profile-a")).toBe("profile");
    expect(localStorage.getItem("run-calc-cheese-recipes")).toBe("master-data");
    expect(applyRolloverEpoch(4)).toBe(false);
  });

  it("wipes run-calculator cache keys once and retains the honored epoch", () => {
    localStorage.setItem("run-calc-day", "old");
    localStorage.setItem("run-calc-profile-a", "old");
    localStorage.setItem("run-calc-history", "completed");
    localStorage.setItem("run-calc-completed-history-outbox.live", "pending");
    localStorage.setItem("run-calc-completed-history-cache.live", "canonical");
    localStorage.setItem("unrelated", "keep");
    expect(applyResetWipe(7)).toBe(true);
    expect(getStoredResetEpoch()).toBe(7);
    expect(localStorage.getItem("run-calc-day")).toBeNull();
    expect(localStorage.getItem("run-calc-history")).toBe("completed");
    expect(localStorage.getItem("run-calc-completed-history-outbox.live")).toBe("pending");
    expect(localStorage.getItem("run-calc-completed-history-cache.live")).toBe("canonical");
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(applyResetWipe(7)).toBe(false);
    expect(applyResetWipe(6)).toBe(false);
  });
});