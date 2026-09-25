// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshNamedRecipeProfilesAndPropagate } from "./profileRecipeRefresh";
import {
  isRunRecipeRefreshEligible,
  loadProfile,
  mergeProfileIntoOpenForm,
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