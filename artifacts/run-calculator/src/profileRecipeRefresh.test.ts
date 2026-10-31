// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshNamedRecipeProfilesAndPropagate } from "./profileRecipeRefresh";
import {
  isRunRecipeRefreshEligible,
  loadProfile,
  mergeProfileIntoOpenForm,
  refreshCheeseOrMixProfileRows,
  refreshProfilesFromNamedRecipes,
} from "./storage";
import { DEFAULT_VALUES, PROFILE_KEY, type FormValues } from "./types";

const BRAND = "Boot Brand";
const FLAVOR = "Boot Flavor";

beforeEach(() => {
  localStorage.clear();
});

describe("initial named-recipe pool propagation", () => {
  it("fans a boot-time Sauce profile repair into pending runs while freezing started runs", async () => {
    localStorage.setItem(PROFILE_KEY(BRAND, FLAVOR), JSON.stringify({
      frontlineRecipeName: "Shared Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
    }));
    const pendingV1 = {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "Shared Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
      casesNeeded: 40,
    } as FormValues;
    const startedV1 = {
      ...pendingV1,
      casesNeeded: 80,
    };
    let pending = pendingV1;
    let started = startedV1;
    const onProfileSaved = vi.fn((brand: string, flavor: string) => {
      const profile = loadProfile(brand, flavor)!;
      if (isRunRecipeRefreshEligible({})) {
        pending = mergeProfileIntoOpenForm(pending, profile);
      }
      if (isRunRecipeRefreshEligible({ startedAt: 1 })) {
        started = mergeProfileIntoOpenForm(started, profile);
      }
    });

    const touched = await refreshNamedRecipeProfilesAndPropagate(
      "sauce",
      [{
        name: "Shared Sauce",
        rows: [{ ingredient: "Tomato", lbs: 24 }],
      }],
      undefined,
      onProfileSaved,
    );

    expect(touched).toEqual([{
      brand: BRAND.toLowerCase(),
      flavor: FLAVOR.toLowerCase(),
    }]);
    expect(onProfileSaved).toHaveBeenCalledOnce();
    expect(pending.frontlineRecipe[0].lbs).toBe(24);
    expect(pending.casesNeeded).toBe(40);
    expect(started).toBe(startedV1);
    expect(started.frontlineRecipe[0].lbs).toBe(10);
  });
});

describe("passive cheese/mix pool refresh", () => {
  it("fills empty or all-zero linked rows without replacing populated rows", () => {
    const targetRows = [{ ingredient: "Tomato", lbs: 2.5 }];
    localStorage.setItem(PROFILE_KEY("Populated Brand", "Flavor"), JSON.stringify({
      app1CheeseRecipeName: "Shared Mix",
      app1CheeseRecipe: [{ ingredient: "Manager Choice", lbs: 8 }],
    }));
    localStorage.setItem(PROFILE_KEY("Empty Brand", "Flavor"), JSON.stringify({
      app2CheeseRecipeName: "Shared Mix",
      app2CheeseRecipe: [],
    }));
    localStorage.setItem(PROFILE_KEY("Zero Brand", "Flavor"), JSON.stringify({
      app3CheeseRecipeName: "Shared Mix",
      app3CheeseRecipe: [{ ingredient: "Placeholder", lbs: 0 }],
    }));

    const passivelyUpdated = refreshCheeseOrMixProfileRows(
      "Shared Mix",
      targetRows,
      { emptyRowsOnly: true },
    );

    expect(passivelyUpdated).toHaveLength(2);
    expect(loadProfile("Populated Brand", "Flavor")?.app1CheeseRecipe).toEqual([
      { ingredient: "Manager Choice", lbs: 8 },
    ]);
    expect(loadProfile("Empty Brand", "Flavor")?.app2CheeseRecipe).toEqual(targetRows);
    expect(loadProfile("Zero Brand", "Flavor")?.app3CheeseRecipe).toEqual(targetRows);

    // The default path remains authoritative for explicit manager saves.
    const explicitlyUpdated = refreshCheeseOrMixProfileRows("Shared Mix", targetRows);
    expect(explicitlyUpdated).toHaveLength(1);
    expect(loadProfile("Populated Brand", "Flavor")?.app1CheeseRecipe).toEqual(targetRows);
  });
});

describe("passive dough/sauce pool refresh", () => {
  it.each(["dough", "sauce"] as const)(
    "fills empty or all-zero %s rows without replacing populated profile rows",
    (kind) => {
      const nameField = kind === "dough" ? "doughRecipeName" : "frontlineRecipeName";
      const rowsField = kind === "dough" ? "doughRecipe" : "frontlineRecipe";
      const targetRows = [{ ingredient: "Canonical Ingredient", lbs: 2.5 }];
      const profileRows = (brand: string) =>
        (loadProfile(brand, FLAVOR) as unknown as Record<string, unknown> | null)?.[
          rowsField
        ];
      const seedProfile = (brand: string, rows: unknown[]) =>
        localStorage.setItem(
          PROFILE_KEY(brand, FLAVOR),
          JSON.stringify({
            [nameField]: "Shared Recipe",
            [rowsField]: rows,
          }),
        );

      seedProfile("Populated Brand", [{ ingredient: "Manager Choice", lbs: 8 }]);
      seedProfile("Empty Brand", []);
      seedProfile("Zero Brand", [{ ingredient: "Placeholder", lbs: 0 }]);

      const passive = refreshProfilesFromNamedRecipes(
        kind,
        [{ name: "Shared Recipe", rows: targetRows }],
        { emptyRowsOnly: true },
      );

      expect(passive).toHaveLength(2);
      expect(profileRows("Populated Brand")).toEqual([
        { ingredient: "Manager Choice", lbs: 8 },
      ]);
      expect(profileRows("Empty Brand")).toEqual(targetRows);
      expect(profileRows("Zero Brand")).toEqual(targetRows);

      const explicitlyUpdated = refreshProfilesFromNamedRecipes(kind, [
        { name: "Shared Recipe", rows: targetRows },
      ]);
      expect(explicitlyUpdated).toHaveLength(1);
      expect(profileRows("Populated Brand")).toEqual(targetRows);
    },
  );
});