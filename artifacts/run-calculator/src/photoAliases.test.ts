// @vitest-environment node
//
// Unit tests for the pure photo-alias matcher used by the photo inventory
// identifier. The fetch/save glue is platform code (network), but the matching
// logic is pure and identical web<->mobile (replit.md parity), so it is tested
// here against the web copy.

import { describe, it, expect } from "vitest";
import { applyPhotoAliases, type PhotoAlias } from "./inventoryShared";
import type { CandidateItem } from "@workspace/inventory-math";

const candidates: CandidateItem[] = [
  { key: "pepperoni:hormel:lbs", category: "pepperoni", name: "Hormel Pepperoni", unit: "lbs" },
  { key: "sauce:marinara:gal", category: "sauce", name: "Marinara", unit: "gal" },
];

const aliases: PhotoAlias[] = [
  { guessName: "Hormel Pep", itemKey: "pepperoni:hormel:lbs" },
  { guessName: "Old Sauce", itemKey: "sauce:deleted:gal" },
];

describe("applyPhotoAliases", () => {
  it("returns the learned itemKey when the item still exists", () => {
    expect(applyPhotoAliases("Hormel Pep", aliases, candidates)).toBe("pepperoni:hormel:lbs");
  });

  it("matches the guess name case-insensitively and trimmed", () => {
    expect(applyPhotoAliases("  hormel pep ", aliases, candidates)).toBe("pepperoni:hormel:lbs");
  });

  it("ignores a stale alias whose item no longer exists", () => {
    expect(applyPhotoAliases("Old Sauce", aliases, candidates)).toBeNull();
  });

  it("returns null when there is no learned alias or the name is blank", () => {
    expect(applyPhotoAliases("Unknown", aliases, candidates)).toBeNull();
    expect(applyPhotoAliases("   ", aliases, candidates)).toBeNull();
  });
});
