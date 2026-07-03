// @vitest-environment jsdom
//
// Sync-receive regression guard for recipe-name reclassify (Cheese → Mix).
// Mix recipe rows share the CHEESE preset map (keyed by name). A reclassify
// removes the name from cheeseRecipeNames (tombstoning it under that
// namespace so every peer drops it from the cheese list) and adds it to
// mixRecipeNames — the rows stay in the shared map. The receive handler's
// preset drop (`dropTombstonedPresetKeys(..., "cheeseRecipeNames")`) would
// wipe those rows on the next sync unless the tombstone set is first filtered
// by names alive in the mix list (`dropTombstonesForAliveNames`). This test
// drives the REAL storage primitives wired exactly as home.tsx wires them, so
// a refactor that drops the mix-aware filter fails here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveCheeseRecipePresets,
  loadCheeseRecipePresets,
  loadDeletedItems,
  unionDeletedItems,
  tombstoneDeleted,
  dropTombstonedPresetKeys,
  dropTombstonesForAliveNames,
  loadList,
  saveList,
  dropDeleted,
  clearRecipeNameSelections,
  saveRunValues,
  loadRunValues,
} from "./storage";
import {
  MIX_RECIPE_NAMES_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  DEFAULT_VALUES,
  type FormValues,
} from "./types";

// Mirrors the cheese-preset receive block in pages/home.tsx.
function receiveCheesePresets(payload: {
  cheeseRecipePresets: Record<string, { ingredient: string; lbs: number }[]>;
  deletedItems?: Record<string, string[]>;
}) {
  const deletedMap = unionDeletedItems(loadDeletedItems(), payload.deletedItems);
  const merged = { ...loadCheeseRecipePresets(), ...payload.cheeseRecipePresets };
  const mixAwareDeleted = dropTombstonesForAliveNames(
    deletedMap,
    "cheeseRecipeNames",
    loadList(MIX_RECIPE_NAMES_KEY, []),
  );
  saveCheeseRecipePresets(dropTombstonedPresetKeys(merged, mixAwareDeleted, "cheeseRecipeNames"));
  return deletedMap;
}

beforeEach(() => {
  localStorage.clear();
});

describe("cheese → mix reclassify survives sync receive", () => {
  it("keeps the moved recipe's rows while the name is alive in the mix list", () => {
    // Before the move: name lives in the cheese list with saved rows.
    saveList(CHEESE_RECIPE_NAMES_KEY, ["Gyro Meat Mix", "Aldo's Cheese Mix"]);
    saveCheeseRecipePresets({
      "Gyro Meat Mix": [{ ingredient: "Gyro Meat", lbs: 5 }],
      "Aldo's Cheese Mix": [{ ingredient: "Mozz", lbs: 10 }],
    });

    // The move (as moveRecipeName does it): remove from cheese list +
    // tombstone, add to mix list. Rows stay in the shared cheese preset map.
    saveList(CHEESE_RECIPE_NAMES_KEY, ["Aldo's Cheese Mix"]);
    tombstoneDeleted("cheeseRecipeNames", "Gyro Meat Mix");
    saveList(MIX_RECIPE_NAMES_KEY, ["Gyro Meat Mix"]);

    // A peer pushes its (pre-move) cheese presets, including the moved name.
    const deletedMap = receiveCheesePresets({
      cheeseRecipePresets: {
        "Gyro Meat Mix": [{ ingredient: "Gyro Meat", lbs: 5 }],
        "Aldo's Cheese Mix": [{ ingredient: "Mozz", lbs: 10 }],
      },
    });

    // Rows survive: the name is tombstoned out of the cheese LIST but alive in
    // the mix list, so the shared-map entry must be kept.
    const presets = loadCheeseRecipePresets();
    expect(Object.keys(presets)).toContain("Gyro Meat Mix");
    expect(presets["Gyro Meat Mix"]).toEqual([{ ingredient: "Gyro Meat", lbs: 5 }]);

    // The list tombstone still keeps the name OUT of the cheese list on
    // receive (mergeList uses the unfiltered map).
    const receivedCheeseList = dropDeleted(
      ["Gyro Meat Mix", "Aldo's Cheese Mix"],
      deletedMap,
      "cheeseRecipeNames",
    );
    expect(receivedCheeseList).toEqual(["Aldo's Cheese Mix"]);
  });

  it("still drops a genuinely deleted cheese recipe's preset (filter is not too loose)", () => {
    saveCheeseRecipePresets({ "Dead Mix": [{ ingredient: "Old", lbs: 1 }] });
    tombstoneDeleted("cheeseRecipeNames", "Dead Mix");
    // Not in the mix list — a real deletion, not a move.
    saveList(MIX_RECIPE_NAMES_KEY, ["Some Other Mix"]);

    receiveCheesePresets({
      cheeseRecipePresets: { "Dead Mix": [{ ingredient: "Old", lbs: 1 }] },
    });

    expect(Object.keys(loadCheeseRecipePresets())).not.toContain("Dead Mix");
  });
});

describe("clearRecipeNameSelections (dangling selections after a move)", () => {
  it("blanks run selection fields pointing at the moved name and reports the run ids", () => {
    const run: FormValues = { ...DEFAULT_VALUES, doughRecipeName: "Old Dough" };
    saveRunValues("a", run);
    saveRunValues("b", { ...DEFAULT_VALUES, doughRecipeName: "Other Dough" });

    const affected = clearRecipeNameSelections("dough", "Old Dough");

    expect(affected).toEqual(["a"]);
    expect(loadRunValues("a").doughRecipeName).toBe("");
    expect(loadRunValues("b").doughRecipeName).toBe("Other Dough");
  });

  it("clears every cheese applicator slot field, case-insensitively", () => {
    saveRunValues("c", {
      ...DEFAULT_VALUES,
      app1CheeseRecipeName: "gyro meat mix",
      app3CheeseRecipeName: "Gyro Meat Mix",
    } as FormValues);

    const affected = clearRecipeNameSelections("cheese", "Gyro Meat Mix");

    expect(affected).toEqual(["c"]);
    const vals = loadRunValues("c") as FormValues & Record<string, string>;
    expect(vals.app1CheeseRecipeName).toBe("");
    expect(vals.app3CheeseRecipeName).toBe("");
  });

  it("is a no-op for the mixes category (no selection fields)", () => {
    saveRunValues("d", { ...DEFAULT_VALUES, doughRecipeName: "Some Mix" });
    expect(clearRecipeNameSelections("mixes", "Some Mix")).toEqual([]);
    expect(loadRunValues("d").doughRecipeName).toBe("Some Mix");
  });
});
