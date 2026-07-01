// @vitest-environment jsdom
//
// Sync-race regression guard for the recipe-name merge (Merge tool's
// Dough/Sauce/Cheese/Mixes tabs). A recipe-name merge re-points per-run
// recipe-name selection fields and folds the category's recipe-preset KEYS.
// Two ways a stale remote sync payload could otherwise undo the merge:
//   1. Re-pointed runs must have their edit stamp advanced so the merge push
//      strictly wins the per-run lost-update guard — otherwise an unedited run
//      (ts 0) carrying the pre-merge name at an equal stamp overwrites it.
//   2. Merged-away preset keys must be tombstoned so the additive union can't
//      resurrect the folded-away recipe-name preset.
// applyRecipeNameMerge returns the ids of runs it actually re-pointed (the stamp
// input) and tombstones the merged-away names + folds preset keys. This asserts
// both, so a regression in either would fail here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyRecipeNameMerge,
  saveRunValues,
  loadRunValues,
  saveDoughRecipePresets,
  loadDoughRecipePresets,
  loadDeletedItems,
} from "./storage";
import {
  DEFAULT_VALUES,
  DOUGH_RECIPE_NAMES_KEY,
  RUN_KEY,
  type FormValues,
} from "./types";

const run = (doughRecipeName: string): FormValues => ({ ...DEFAULT_VALUES, doughRecipeName });

beforeEach(() => {
  localStorage.clear();
});

describe("applyRecipeNameMerge (dough)", () => {
  it("re-points run selections, returns affected run ids, tombstones the source, and folds preset keys", () => {
    // Two runs point at the soon-to-be-merged-away name; one points at the target;
    // one points at an unrelated name and must be left untouched.
    saveRunValues("a", run("Old Dough"));
    saveRunValues("b", run("Old Dough"));
    saveRunValues("c", run("Keep Dough"));
    saveRunValues("d", run("Other Dough"));
    localStorage.setItem(
      DOUGH_RECIPE_NAMES_KEY,
      JSON.stringify(["Keep Dough", "Old Dough", "Other Dough"]),
    );
    saveDoughRecipePresets({
      "Keep Dough": { rows: [{ ingredient: "Flour", lbs: 100 }] },
      "Old Dough": { rows: [{ ingredient: "Flour", lbs: 999 }] },
    });

    const affected = applyRecipeNameMerge("dough", { "Old Dough": "Keep Dough" });

    // Only the two runs that actually pointed at the source are returned.
    expect(affected.sort()).toEqual(["a", "b"]);
    expect(loadRunValues("a").doughRecipeName).toBe("Keep Dough");
    expect(loadRunValues("b").doughRecipeName).toBe("Keep Dough");
    expect(loadRunValues("c").doughRecipeName).toBe("Keep Dough");
    expect(loadRunValues("d").doughRecipeName).toBe("Other Dough");

    // Source name is dropped from the list and tombstoned so the additive union
    // can't bring it back from a stale peer.
    const list = JSON.parse(localStorage.getItem(DOUGH_RECIPE_NAMES_KEY) ?? "[]") as string[];
    expect(list).not.toContain("Old Dough");
    expect(list).toContain("Keep Dough");
    const deleted = loadDeletedItems();
    expect((deleted["doughRecipeNames"] ?? []).map((n) => n.toLowerCase())).toContain("old dough");

    // Preset key is folded away; the target's rows win.
    const presets = loadDoughRecipePresets();
    expect(Object.keys(presets)).not.toContain("Old Dough");
    expect(presets["Keep Dough"].rows[0].lbs).toBe(100);
  });

  it("returns no run ids when nothing actually pointed at the source", () => {
    saveRunValues("x", run("Keep Dough"));
    const affected = applyRecipeNameMerge("dough", { "Old Dough": "Keep Dough" });
    expect(affected).toEqual([]);
    // The source is still tombstoned even with no run references.
    expect((loadDeletedItems()["doughRecipeNames"] ?? []).map((n) => n.toLowerCase())).toContain("old dough");
  });

  it("mixes merge tombstones the name but re-points no runs (no selection field)", () => {
    const affected = applyRecipeNameMerge("mixes", { "Old Mix": "Keep Mix" });
    expect(affected).toEqual([]);
    expect((loadDeletedItems()["mixRecipeNames"] ?? []).map((n) => n.toLowerCase())).toContain("old mix");
  });
});
