import { describe, it, expect, beforeEach } from "vitest";
import {
  deleteProfilesForBrand,
  deleteProfileEntry,
  purgeOrphanedProfilesIfNeeded,
} from "./storage";
import { BRANDS_KEY, PROFILE_KEY, CRUST_PROFILE_KEY } from "./types";

const MARKER = "run-calc-purge-orphaned-profiles-v1";

function seedProfile(brand: string, flavor: string) {
  localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify({ brand, flavor }));
  localStorage.setItem(CRUST_PROFILE_KEY(brand, flavor), JSON.stringify({ dieType: "12in" }));
}
function has(brand: string, flavor: string): boolean {
  return localStorage.getItem(PROFILE_KEY(brand, flavor)) !== null;
}
function hasCrust(brand: string, flavor: string): boolean {
  return localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor)) !== null;
}

describe("deleteProfilesForBrand", () => {
  beforeEach(() => localStorage.clear());

  it("removes every dough + crust profile for the brand and leaves others alone", () => {
    seedProfile("Basha's Original", "Pepperoni");
    seedProfile("Basha's Original", "Supreme");
    seedProfile("Basha's Ultra Thin", "Cheese");

    deleteProfilesForBrand("Basha's Original");

    expect(has("Basha's Original", "Pepperoni")).toBe(false);
    expect(hasCrust("Basha's Original", "Pepperoni")).toBe(false);
    expect(has("Basha's Original", "Supreme")).toBe(false);
    // Other brand untouched
    expect(has("Basha's Ultra Thin", "Cheese")).toBe(true);
    expect(hasCrust("Basha's Ultra Thin", "Cheese")).toBe(true);
  });

  it("matches case-insensitively (keys are lowercased)", () => {
    seedProfile("BASHA's Original", "Pepperoni");
    deleteProfilesForBrand("basha's original");
    expect(has("BASHA's Original", "Pepperoni")).toBe(false);
  });
});

describe("deleteProfileEntry", () => {
  beforeEach(() => localStorage.clear());

  it("removes only the one brand+flavor profile", () => {
    seedProfile("Basha's Ultra Thin", "SSG & Pepp");
    seedProfile("Basha's Ultra Thin", "Cheese");

    deleteProfileEntry("Basha's Ultra Thin", "SSG & Pepp");

    expect(has("Basha's Ultra Thin", "SSG & Pepp")).toBe(false);
    expect(hasCrust("Basha's Ultra Thin", "SSG & Pepp")).toBe(false);
    expect(has("Basha's Ultra Thin", "Cheese")).toBe(true);
  });
});

describe("purgeOrphanedProfilesIfNeeded", () => {
  beforeEach(() => localStorage.clear());

  it("removes profiles whose brand is not in the Brands list, keeps known ones", () => {
    localStorage.setItem(BRANDS_KEY, JSON.stringify(["Basha's Ultra Thin"]));
    seedProfile("Basha's Ultra Thin", "Cheese"); // known — keep
    seedProfile("Basha's Original", "Pepperoni"); // orphan — deleted brand
    seedProfile("Basha", "Cheese"); // orphan — legacy namespace

    purgeOrphanedProfilesIfNeeded();

    expect(has("Basha's Ultra Thin", "Cheese")).toBe(true);
    expect(has("Basha's Original", "Pepperoni")).toBe(false);
    expect(hasCrust("Basha's Original", "Pepperoni")).toBe(false);
    expect(has("Basha", "Cheese")).toBe(false);
    expect(localStorage.getItem(MARKER)).toBe("1");
  });

  it("defers (no marker) when the Brands list is empty so it can't nuke everything", () => {
    seedProfile("Basha's Ultra Thin", "Cheese");
    purgeOrphanedProfilesIfNeeded();
    // Brands list empty → skipped, profile survives, retries next load
    expect(has("Basha's Ultra Thin", "Cheese")).toBe(true);
    expect(localStorage.getItem(MARKER)).toBeNull();
  });

  it("runs only once (guarded by version marker)", () => {
    localStorage.setItem(BRANDS_KEY, JSON.stringify(["Known Brand"]));
    purgeOrphanedProfilesIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");
    // An orphan added after the marker is set is left untouched.
    seedProfile("Deleted Later", "Cheese");
    purgeOrphanedProfilesIfNeeded();
    expect(has("Deleted Later", "Cheese")).toBe(true);
  });
});
