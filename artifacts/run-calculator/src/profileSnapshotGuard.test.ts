import { describe, it, expect, beforeEach } from "vitest";
import {
  isRunRecipeRefreshEligible,
  loadProfile,
  mergeProfileIntoOpenForm,
  saveProfile,
} from "./storage";
import { DEFAULT_VALUES, PROFILE_KEY, CRUST_PROFILE_KEY } from "./types";
import type { FormValues } from "./types";

// The stale-form guard in saveProfile: a nav-save of a form that is UNCHANGED
// since some loadProfile call must never republish old values over a newer
// copy adopted from the server pool — even when ANOTHER reader called
// loadProfile again (and refreshed the snapshot) after the adoption. A single
// latest-only snapshot failed exactly that case.

const BRAND = "Snapshot Brand";
const FLAVOR = "Guard Flavor";

function form(over: Partial<FormValues>): FormValues {
  return { ...DEFAULT_VALUES, ...over } as FormValues;
}

// What the server-pool reconcile does when it adopts a newer copy: write the
// raw blobs straight into localStorage (bypassing saveProfile).
function adoptFromServer(doughBlob: Record<string, unknown>): void {
  localStorage.setItem(PROFILE_KEY(BRAND, FLAVOR), JSON.stringify(doughBlob));
  localStorage.setItem(CRUST_PROFILE_KEY(BRAND, FLAVOR), JSON.stringify({}));
}

function storedDoughName(): string | undefined {
  const raw = localStorage.getItem(PROFILE_KEY(BRAND, FLAVOR));
  if (!raw) return undefined;
  return (JSON.parse(raw) as Record<string, unknown>).doughRecipeName as string | undefined;
}

describe("saveProfile stale-form snapshot guard", () => {
  beforeEach(() => localStorage.clear());

  it("an unchanged form does not republish over a server-adopted newer copy, even after another loadProfile refreshed the snapshot", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    // The open form loads V1 (snapshot recorded).
    const staleForm = loadProfile(BRAND, FLAVOR)!;
    expect(staleForm.doughRecipeName).toBe("V1");

    // A newer copy arrives from the server pool…
    adoptFromServer({ dieType: "12 inch", doughRecipeName: "V2" });
    // …and some OTHER reader (editor open, backfill, heal) loads it, which
    // refreshes the in-memory snapshot for this key.
    const fresh = loadProfile(BRAND, FLAVOR)!;
    expect(fresh.doughRecipeName).toBe("V2");

    // Nav-save of the untouched stale form must be a no-op.
    saveProfile(BRAND, FLAVOR, staleForm);
    expect(storedDoughName()).toBe("V2");
  });

  it("a genuine user edit still saves after a server-adopted copy", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    const openForm = loadProfile(BRAND, FLAVOR)!;
    adoptFromServer({ dieType: "12 inch", doughRecipeName: "V2" });
    loadProfile(BRAND, FLAVOR);

    const edited = { ...openForm, doughRecipeName: "User Edit" } as FormValues;
    saveProfile(BRAND, FLAVOR, edited);
    expect(storedDoughName()).toBe("User Edit");
  });

  it("still saves when the stored blob was wiped even though the form matches an old snapshot", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    const openForm = loadProfile(BRAND, FLAVOR)!;

    // Factory reset / deletion wiped the local copy; the unchanged form must
    // be allowed to persist again or the profile silently never re-saves.
    localStorage.removeItem(PROFILE_KEY(BRAND, FLAVOR));
    localStorage.removeItem(CRUST_PROFILE_KEY(BRAND, FLAVOR));
    saveProfile(BRAND, FLAVOR, openForm);
    expect(storedDoughName()).toBe("V1");
  });
});

describe("shared recipe snapshot boundary", () => {
  it("refreshes only runs that have never started", () => {
    expect(isRunRecipeRefreshEligible({})).toBe(true);
    expect(isRunRecipeRefreshEligible({ startedAt: 1 })).toBe(false);
    expect(isRunRecipeRefreshEligible({ pausedAt: 1 })).toBe(false);
    expect(isRunRecipeRefreshEligible({ startedAt: 1, endedAt: 2 })).toBe(false);
    expect(isRunRecipeRefreshEligible({ endedAt: 2 })).toBe(false);
  });

  it("refreshes every shared recipe family for pending runs and freezes production snapshots", () => {
    const v1 = form({
      doughRecipeName: "Dough V1",
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
      frontlineRecipeName: "Sauce V1",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 20 }],
      app1Type: "Cheese",
      app1CheeseRecipeName: "Cheese V1",
      app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 10 }],
      app2Type: "Mix",
      app2CheeseRecipeName: "Mix V1",
      app2CheeseRecipe: [{ ingredient: "Spice", lbs: 2 }],
      casesNeeded: 80,
      sauceBarrelsMade: 1,
      app1BatchesMade: 2,
    });
    const v2 = form({
      doughRecipeName: "Dough V2",
      doughRecipe: [{ ingredient: "Flour", lbs: 44 }],
      frontlineRecipeName: "Sauce V2",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 24 }],
      app1Type: "Cheese",
      app1CheeseRecipeName: "Cheese V2",
      app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 12 }],
      app2Type: "Mix",
      app2CheeseRecipeName: "Mix V2",
      app2CheeseRecipe: [{ ingredient: "Spice", lbs: 3 }],
      casesNeeded: 999,
      sauceBarrelsMade: 9,
      app1BatchesMade: 9,
    });
    const refresh = (
      run: Parameters<typeof isRunRecipeRefreshEligible>[0],
      values: FormValues,
    ) => isRunRecipeRefreshEligible(run) ? mergeProfileIntoOpenForm(values, v2) : values;

    const currentPending = refresh({}, v1);
    const futurePending = refresh({}, v1);
    const running = refresh({ startedAt: 1 }, v1);
    const paused = refresh({ startedAt: 1, pausedAt: 2 }, v1);
    const ended = refresh({ startedAt: 1, endedAt: 3 }, v1);

    for (const pending of [currentPending, futurePending]) {
      expect(pending.doughRecipeName).toBe("Dough V2");
      expect(pending.doughRecipe[0].lbs).toBe(44);
      expect(pending.frontlineRecipeName).toBe("Sauce V2");
      expect(pending.frontlineRecipe[0].lbs).toBe(24);
      expect(pending.app1CheeseRecipeName).toBe("Cheese V2");
      expect(pending.app1CheeseRecipe[0].lbs).toBe(12);
      expect(pending.app2CheeseRecipeName).toBe("Mix V2");
      expect(pending.app2CheeseRecipe[0].lbs).toBe(3);
      expect(pending.casesNeeded).toBe(80);
      expect(pending.sauceBarrelsMade).toBe(1);
      expect(pending.app1BatchesMade).toBe(2);
    }
    for (const frozen of [running, paused, ended]) {
      expect(frozen).toBe(v1);
      expect(frozen.doughRecipeName).toBe("Dough V1");
      expect(frozen.frontlineRecipeName).toBe("Sauce V1");
      expect(frozen.app1CheeseRecipeName).toBe("Cheese V1");
      expect(frozen.app2CheeseRecipeName).toBe("Mix V1");
    }
  });

  it("does not copy production progress or run-specific targets from a profile", () => {
    const current = form({
      casesNeeded: 80,
      tempCycleSpeed: 7.5,
      skidsCompleted: 2,
      sauceBarrelsMade: 3,
      sauceBarrelAnchorNetSec: 120,
      sauceBarrelCorrectionGeneration: 4,
      app1BatchesMade: 5,
      app1BatchAnchorNetSec: 240,
      app1BatchCorrectionGeneration: 6,
      frontlineRecipeName: "Sauce V1",
    });
    const profile = form({
      casesNeeded: 999,
      tempCycleSpeed: 99,
      skidsCompleted: 99,
      sauceBarrelsMade: 99,
      sauceBarrelAnchorNetSec: 999,
      sauceBarrelCorrectionGeneration: 99,
      app1BatchesMade: 99,
      app1BatchAnchorNetSec: 999,
      app1BatchCorrectionGeneration: 99,
      frontlineRecipeName: "Sauce V2",
    });

    const merged = mergeProfileIntoOpenForm(current, profile);

    expect(merged.frontlineRecipeName).toBe("Sauce V2");
    expect(merged.casesNeeded).toBe(80);
    expect(merged.tempCycleSpeed).toBe(7.5);
    expect(merged.skidsCompleted).toBe(2);
    expect(merged.sauceBarrelsMade).toBe(3);
    expect(merged.sauceBarrelAnchorNetSec).toBe(120);
    expect(merged.sauceBarrelCorrectionGeneration).toBe(4);
    expect(merged.app1BatchesMade).toBe(5);
    expect(merged.app1BatchAnchorNetSec).toBe(240);
    expect(merged.app1BatchCorrectionGeneration).toBe(6);
  });

  it("strips legacy production registers when loading or saving profiles", () => {
    localStorage.setItem(PROFILE_KEY(BRAND, FLAVOR), JSON.stringify({
      frontlineRecipeName: "Sauce",
      sauceBarrelsMade: 7,
      app1BatchesMade: 8,
      app1BatchAnchorNetSec: 90,
      app1BatchCorrectionGeneration: 9,
    }));

    const loaded = loadProfile(BRAND, FLAVOR)!;
    expect(loaded.sauceBarrelsMade).toBe(0);
    expect(loaded.app1BatchesMade).toBe(0);
    expect(loaded.app1BatchAnchorNetSec).toBe(0);
    expect(loaded.app1BatchCorrectionGeneration).toBe(0);

    localStorage.clear();
    saveProfile(BRAND, FLAVOR, form({
      frontlineRecipeName: "Sauce",
      sauceBarrelsMade: 7,
      app1BatchesMade: 8,
    }));
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY(BRAND, FLAVOR)) ?? "{}");
    expect(stored).not.toHaveProperty("sauceBarrelsMade");
    expect(stored).not.toHaveProperty("app1BatchesMade");
  });
});
