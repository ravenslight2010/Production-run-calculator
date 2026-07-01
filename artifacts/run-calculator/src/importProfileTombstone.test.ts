// @vitest-environment jsdom
//
// Regression guard for spec-import "nothing shows up". A spec import routes each
// parsed profile through importProfileIsTombstoned; a true result silently moves
// the profile to the (unchecked) "skipped/merged away" bucket. Previously this
// consulted the FLAT mergedAway set, which is fed ONLY by ingredient/app/pep
// type merges (applyIngredientMerge). Common flavor names ("PEPPERONI",
// "CHEESE", "SUPREME") collide with those merged ingredient names, so after a
// routine applicator/pep dedupe an imported profile with a same-named flavor was
// dropped and the user saw nothing appear. importProfileIsTombstoned must key
// ONLY on genuine brand/flavor tombstones (the structured deletedItems map).

import { describe, it, expect, beforeEach } from "vitest";
import {
  importProfileIsTombstoned,
  applyIngredientMerge,
  tombstoneDeleted,
  flavorNamespace,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("importProfileIsTombstoned", () => {
  it("does NOT suppress an imported profile whose flavor collides with a merged-away ingredient/pep name", () => {
    // The user dedupes a pepperoni applicator/pep type — a real ingredient-type
    // merge that records "Pepperoni" in the flat mergedAway set.
    applyIngredientMerge({ Pepperoni: "Pepperoni Stick" });

    // Importing a Basha's Original / PEPPERONI profile must still come through.
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(false);
  });

  it("does NOT suppress an imported profile whose brand collides with a merged-away ingredient name", () => {
    applyIngredientMerge({ Cheese: "Whole Milk Mozzarella" });
    expect(importProfileIsTombstoned("Cheese", "Classic")).toBe(false);
  });

  it("STILL suppresses a profile whose brand was genuinely merged/deleted away", () => {
    // Real brand merge/delete records the name under the "brands" namespace.
    tombstoneDeleted("brands", "Basha's Original");
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(true);
  });

  it("STILL suppresses a profile whose flavor was genuinely merged/deleted away within its brand", () => {
    tombstoneDeleted(flavorNamespace("Basha's Original"), "PEPPERONI");
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(true);
    // A sibling flavor of the same brand is unaffected.
    expect(importProfileIsTombstoned("Basha's Original", "CHEESE")).toBe(false);
  });

  it("accepts a normal profile when there are no tombstones", () => {
    expect(importProfileIsTombstoned("Basha's Original", "SUPREME")).toBe(false);
  });
});
