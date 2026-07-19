// @vitest-environment jsdom
//
// One-click removal for stale ("old reference") recipe names. Unlike a merge
// there is no target: removeStaleRecipeReference clears the name from EVERY
// surface that still references it — legacy local name lists, recipe-preset
// maps, per-run values, brand/crust profiles, templates and history — and
// writes a deletion tombstone so the additive live-sync union can't resurrect
// it from a stale peer. This test drives the REAL storage helper plus the same
// extracted receive-side guards the merge sync test uses.

import { describe, it, expect, beforeEach } from "vitest";
import {
  removeStaleRecipeReference,
  saveRunValues,
  loadRunValues,
  loadRunValuesUpdated,
  saveRunValuesUpdated,
  saveDoughRecipePresets,
  loadDoughRecipePresets,
  saveCheeseRecipePresets,
  loadCheeseRecipePresets,
  loadDeletedItems,
  unionDeletedItems,
  dropDeleted,
  acceptRemoteRunValueOnSync,
  dropTombstonedPresetKeys,
  saveTemplates,
  loadTemplates,
  loadList,
} from "./storage";
import {
  DEFAULT_VALUES,
  DOUGH_RECIPE_NAMES_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  HISTORY_KEY,
  PROFILE_KEY,
  type FormValues,
  type HistoryDay,
  type RunTemplate,
} from "./types";

const run = (doughRecipeName: string): FormValues => ({ ...DEFAULT_VALUES, doughRecipeName });

beforeEach(() => {
  localStorage.clear();
});

describe("removeStaleRecipeReference clears every surface", () => {
  it("blanks run/profile/template/history selections, drops the list entry + preset, tombstones", () => {
    // Runs
    saveRunValues("a", run("Old Dough"));
    saveRunValues("b", run("Keep Dough"));
    // Profile
    localStorage.setItem(
      PROFILE_KEY("BrandX", "Cheese"),
      JSON.stringify({ doughRecipeName: "Old Dough" }),
    );
    // Template
    saveTemplates([
      { id: "t1", name: "T1", values: { ...DEFAULT_VALUES, doughRecipeName: "Old Dough" } } as unknown as RunTemplate,
    ]);
    // History
    const day: HistoryDay = {
      date: "2026-07-18",
      runs: [],
      runValues: { h1: run("Old Dough") },
    } as unknown as HistoryDay;
    localStorage.setItem(HISTORY_KEY, JSON.stringify([day]));
    // Legacy list + preset (case drift on the list entry is deliberate)
    localStorage.setItem(DOUGH_RECIPE_NAMES_KEY, JSON.stringify(["old dough ", "Keep Dough"]));
    saveDoughRecipePresets({
      "Old Dough": { rows: [{ ingredient: "Flour", lbs: 1 }] },
      "Keep Dough": { rows: [{ ingredient: "Flour", lbs: 2 }] },
    });

    const affected = removeStaleRecipeReference("dough", "Old Dough");
    expect(affected).toEqual(["a"]);

    // Run selection blanked; other run untouched.
    expect(loadRunValues("a").doughRecipeName).toBe("");
    expect(loadRunValues("b").doughRecipeName).toBe("Keep Dough");
    // Profile blanked.
    const prof = JSON.parse(localStorage.getItem(PROFILE_KEY("BrandX", "Cheese"))!);
    expect(prof.doughRecipeName).toBe("");
    // Template blanked.
    expect((loadTemplates()[0].values as FormValues).doughRecipeName).toBe("");
    // History blanked.
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(hist[0].runValues.h1.doughRecipeName).toBe("");
    // Legacy list entry removed (case-insensitive), keeper stays.
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toEqual(["Keep Dough"]);
    // Preset entry dropped, keeper stays.
    expect(Object.keys(loadDoughRecipePresets())).toEqual(["Keep Dough"]);
    // Deletion tombstone written under the category namespace.
    expect(loadDeletedItems()["doughRecipeNames"]).toContain("old dough");
  });

  it("clears cheese/mix link fields across all four applicator slots", () => {
    saveRunValues("r", {
      ...DEFAULT_VALUES,
      app1CheeseRecipeName: "Ghost Mix",
      app3CheeseRecipeName: "ghost mix",
      app4CheeseRecipeName: "Real Mix",
    });
    localStorage.setItem(CHEESE_RECIPE_NAMES_KEY, JSON.stringify(["Ghost Mix"]));
    saveCheeseRecipePresets({ "Ghost Mix": [{ ingredient: "Mozz", lbs: 5 }] } as never);

    const affected = removeStaleRecipeReference("cheese", "Ghost Mix");
    expect(affected).toEqual(["r"]);
    const vals = loadRunValues("r");
    expect(vals.app1CheeseRecipeName).toBe("");
    expect(vals.app3CheeseRecipeName).toBe("");
    expect(vals.app4CheeseRecipeName).toBe("Real Mix");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toEqual([]);
    expect(Object.keys(loadCheeseRecipePresets())).toEqual([]);
    expect(loadDeletedItems()["cheeseRecipeNames"]).toContain("ghost mix");
  });

  it("no-ops safely on a blank name and still tombstones when nothing references the name", () => {
    expect(removeStaleRecipeReference("dough", "   ")).toEqual([]);
    expect(loadDeletedItems()["doughRecipeNames"]).toBeUndefined();
    // Name only on peers/server: tombstone must still be written locally.
    expect(removeStaleRecipeReference("sauce", "Peer Only Sauce")).toEqual([]);
    expect(loadDeletedItems()["frontlineRecipeNames"]).toContain("peer only sauce");
  });
});

describe("removal survives a stale incoming sync (receive path)", () => {
  it("does not resurrect the removed name from a stale peer's payload", () => {
    saveRunValues("a", run("Old Dough"));
    localStorage.setItem(DOUGH_RECIPE_NAMES_KEY, JSON.stringify(["Old Dough"]));
    saveDoughRecipePresets({ "Old Dough": { rows: [{ ingredient: "Flour", lbs: 1 }] } });

    const affected = removeStaleRecipeReference("dough", "Old Dough");
    expect(affected).toEqual(["a"]);
    // Handler (home.tsx) bumps affected runs' edit stamps before pushing.
    const stamp = Date.now();
    const upd = loadRunValuesUpdated();
    for (const id of affected) upd[id] = stamp;
    saveRunValuesUpdated(upd);

    // Stale peer pushes the pre-removal selection (stamp 0), the removed list
    // entry, and the removed preset key — with no tombstone of its own.
    const deletedMap = unionDeletedItems(loadDeletedItems(), {});
    // Per-run guard: stale value must be rejected.
    const remote = run("Old Dough");
    expect(
      acceptRemoteRunValueOnSync(remote, loadRunValues("a"), 0, loadRunValuesUpdated().a ?? 0),
    ).toBe(false);
    // List union: the tombstone strips the removed name.
    const unionedList = [...new Set([...loadList(DOUGH_RECIPE_NAMES_KEY, []), "Old Dough"])];
    expect(dropDeleted(unionedList, deletedMap, "doughRecipeNames")).toEqual([]);
    // Preset union: the tombstoned key is dropped.
    const mergedPresets = {
      ...loadDoughRecipePresets(),
      "Old Dough": { rows: [{ ingredient: "Flour", lbs: 1 }] },
    };
    expect(
      Object.keys(dropTombstonedPresetKeys(mergedPresets, deletedMap, "doughRecipeNames")),
    ).not.toContain("Old Dough");
  });
});
