// Machine times (mixer low/high, hopper) moved from a 0 default ("not
// measured") to factory-typical defaults (180/330/70). A marker-guarded
// one-time heal rewrites stored profiles and run values once so existing data
// picks up the defaults. In addition, loadRunValues folds any stored 0 to the
// factory default at read time — so synced zeros from peers never render as 0
// in the UI, regardless of whether the one-time heal marker is already set.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMachineTimeDefaultsHealIfNeeded,
  loadRunValues,
  saveRunValues,
  isAllDefaultRunValue,
} from "./storage";
import { DEFAULT_VALUES, MACHINE_TIME_DEFAULTS, RUN_KEY, PROFILE_KEY } from "./types";

const MARKER = "run-calc-machine-time-defaults-v1";

beforeEach(() => localStorage.clear());

describe("applyMachineTimeDefaultsHealIfNeeded", () => {
  it("folds legacy 0 machine times to the new defaults in profiles and runs, once", () => {
    localStorage.setItem(
      RUN_KEY("r1"),
      JSON.stringify({ ...DEFAULT_VALUES, casesNeeded: 200, mixerLowSec: 0, mixerHighSec: 0, hopperSec: 0 }),
    );
    localStorage.setItem(
      PROFILE_KEY("Aldo's", "Cheese"),
      JSON.stringify({ ...DEFAULT_VALUES, pizzasPerCase: 12, mixerLowSec: 0, mixerHighSec: 0, hopperSec: 0 }),
    );

    const healed = applyMachineTimeDefaultsHealIfNeeded();
    expect(healed).toContain("r1");
    expect(localStorage.getItem(MARKER)).toBe("1");

    const run = JSON.parse(localStorage.getItem(RUN_KEY("r1"))!);
    expect(run.mixerLowSec).toBe(MACHINE_TIME_DEFAULTS.mixerLowSec);
    expect(run.mixerHighSec).toBe(MACHINE_TIME_DEFAULTS.mixerHighSec);
    expect(run.hopperSec).toBe(MACHINE_TIME_DEFAULTS.hopperSec);
    expect(run.casesNeeded).toBe(200);

    const prof = JSON.parse(localStorage.getItem(PROFILE_KEY("Aldo's", "Cheese"))!);
    expect(prof.mixerLowSec).toBe(180);
    expect(prof.mixerHighSec).toBe(330);
    expect(prof.hopperSec).toBe(70);
  });

  it("never re-runs: a deliberate 0 saved after the heal is folded to default on read", () => {
    applyMachineTimeDefaultsHealIfNeeded(); // sets the marker on a fresh device
    saveRunValues("r2", { ...DEFAULT_VALUES, casesNeeded: 100, mixerHighSec: 0 });
    expect(applyMachineTimeDefaultsHealIfNeeded()).toEqual([]);
    expect(loadRunValues("r2").mixerHighSec).toBe(MACHINE_TIME_DEFAULTS.mixerHighSec);
  });

  it("leaves measured (non-zero, non-default) times untouched", () => {
    localStorage.setItem(RUN_KEY("r3"), JSON.stringify({ ...DEFAULT_VALUES, mixerLowSec: 150, hopperSec: 0 }));
    applyMachineTimeDefaultsHealIfNeeded();
    const run = JSON.parse(localStorage.getItem(RUN_KEY("r3"))!);
    expect(run.mixerLowSec).toBe(150);
    expect(run.hopperSec).toBe(MACHINE_TIME_DEFAULTS.hopperSec);
  });
});

describe("blank-run detection across the defaults change", () => {
  it("treats legacy zero-machine-time blanks AND new-default blanks as all-default", () => {
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES })).toBe(true);
    expect(
      isAllDefaultRunValue({ ...DEFAULT_VALUES, mixerLowSec: 0, mixerHighSec: 0, hopperSec: 0 }),
    ).toBe(true);
  });

  it("still treats any real edit as populated", () => {
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES, casesNeeded: 5 })).toBe(false);
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES, mixerLowSec: 200 })).toBe(false);
  });
});
