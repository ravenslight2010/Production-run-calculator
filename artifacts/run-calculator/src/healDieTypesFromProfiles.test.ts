import { describe, it, expect, beforeEach } from "vitest";
import { healDieTypesFromProfiles, saveList, tombstoneDeleted } from "./storage";
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
