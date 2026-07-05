import { describe, it, expect, beforeEach } from "vitest";
import { healDieTypesFromProfiles, saveList, tombstoneDeleted, rewriteDieTypeInProfiles } from "./storage";
import { PROFILE_KEY, CRUST_PROFILE_KEY, DIE_TYPES_KEY } from "./types";

describe("healDieTypesFromProfiles", () => {
  beforeEach(() => localStorage.clear());

  it("returns an empty list when there are no profiles and no saved die types", () => {
    expect(healDieTypesFromProfiles()).toEqual([]);
  });

  it("recovers die types named by saved profiles into the master list (sorted, persisted)", () => {
    localStorage.setItem(PROFILE_KEY("Aldo's", "Pepperoni"), JSON.stringify({ dieType: "12in" }));
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: "Argus" }));

    const healed = healDieTypesFromProfiles();
    expect(healed).toEqual(["12in", "Argus"]);
    // Persisted so a later plain load already has them.
    expect(JSON.parse(localStorage.getItem(DIE_TYPES_KEY) ?? "[]")).toEqual(["12in", "Argus"]);
  });

  it("also scans crust-profile keys", () => {
    localStorage.setItem(CRUST_PROFILE_KEY("Corner Booth", "Cheese"), JSON.stringify({ dieType: "Mystic" }));
    expect(healDieTypesFromProfiles()).toEqual(["Mystic"]);
  });

  it("de-dups against the existing list case-insensitively and keeps the existing spelling", () => {
    saveList(DIE_TYPES_KEY, ["Argus"]);
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: "argus" }));
    localStorage.setItem(PROFILE_KEY("Craft", "Veggie"), JSON.stringify({ dieType: "12in" }));

    const healed = healDieTypesFromProfiles();
    expect(healed).toEqual(["12in", "Argus"]);
  });

  it("never resurrects a die type the user explicitly deleted", () => {
    tombstoneDeleted("dieTypes", "Argus");
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: "Argus" }));
    localStorage.setItem(PROFILE_KEY("Craft", "Veggie"), JSON.stringify({ dieType: "12in" }));

    expect(healDieTypesFromProfiles()).toEqual(["12in"]);
  });

  it("folds variant 11-inch die spellings into the single canonical 11\" name", () => {
    localStorage.setItem(PROFILE_KEY("Aldo's", "Pep"), JSON.stringify({ dieType: "11" }));
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: '11" dies' }));
    localStorage.setItem(PROFILE_KEY("Corner", "Cheese"), JSON.stringify({ dieType: '11"' }));

    expect(healDieTypesFromProfiles()).toEqual(['11"']);
    expect(JSON.parse(localStorage.getItem(DIE_TYPES_KEY) ?? "[]")).toEqual(['11"']);
  });

  it("collapses stale variant names already saved in the master list", () => {
    saveList(DIE_TYPES_KEY, ["11", '11"', '11" dies']);
    expect(healDieTypesFromProfiles()).toEqual(['11"']);
  });

  it("does not resurrect a renamed-away die once its profiles are rewritten + it is tombstoned", () => {
    // Simulate what renameDieType does: profile held the old name, the rename
    // rewrites the profile to the new name and tombstones the old one.
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: "Argus" }));
    saveList(DIE_TYPES_KEY, ["Argus"]);

    rewriteDieTypeInProfiles("Argus", "Argus Die");
    tombstoneDeleted("dieTypes", "Argus");
    saveList(DIE_TYPES_KEY, ["Argus Die"]);

    // The old spelling must not come back as a duplicate.
    expect(healDieTypesFromProfiles()).toEqual(["Argus Die"]);
    expect(JSON.parse(localStorage.getItem(PROFILE_KEY("Craft", "Supreme")) ?? "{}").dieType).toBe("Argus Die");
  });

  it("folds in extra (live-run) die types passed by the caller", () => {
    localStorage.setItem(PROFILE_KEY("Craft", "Supreme"), JSON.stringify({ dieType: "12in" }));
    expect(healDieTypesFromProfiles(["Argus", "  ", "12in"])).toEqual(["12in", "Argus"]);
  });

  it("returns the current list unchanged (no write) when nothing new is found", () => {
    saveList(DIE_TYPES_KEY, ["12in"]);
    const healed = healDieTypesFromProfiles();
    expect(healed).toEqual(["12in"]);
  });
});
