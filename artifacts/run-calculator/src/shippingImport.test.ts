// Commit-path test for the Shipping & Palletizing Guide importer: verifies
// that a reviewed row patches the brand-level profile AND every flavor under
// the brand, that only the provided keys are written (existing recipe data is
// untouched), and that empty patches / blank brands are skipped.
import { describe, it, expect, beforeEach } from "vitest";
import { commitShippingImport } from "./shippingImport";
import { PROFILE_KEY, BRAND_FLAVORS_KEY } from "./types";

const readProfile = (brand: string, flavor: string) => {
  const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe("commitShippingImport", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      BRAND_FLAVORS_KEY,
      JSON.stringify({ Hannaford: ["Cheese", "Pepperoni"], Lowes: [] }),
    );
  });

  it("patches the brand-level profile and every flavor without clobbering existing data", () => {
    // Existing flavor profile with real recipe data that must survive.
    localStorage.setItem(
      PROFILE_KEY("Hannaford", "Cheese"),
      JSON.stringify({ doughballWeightOz: "18", shipper: "costco" }),
    );

    const result = commitShippingImport([
      {
        brand: "Hannaford",
        patch: { shipper: "11in", circles: "11in", pizzasPerCase: 12 },
      },
    ]);

    expect(result.rowsApplied).toBe(1);
    // brand-level "" + Cheese + Pepperoni
    expect(result.profilesUpdated).toBe(3);

    const brandLevel = readProfile("Hannaford", "");
    expect(brandLevel).toMatchObject({ shipper: "11in", circles: "11in", pizzasPerCase: 12 });

    const cheese = readProfile("Hannaford", "Cheese");
    // Patched keys applied, untouched keys preserved.
    expect(cheese).toMatchObject({
      doughballWeightOz: "18",
      shipper: "11in",
      circles: "11in",
      pizzasPerCase: 12,
    });

    expect(readProfile("Hannaford", "Pepperoni")).toMatchObject({ shipper: "11in" });
  });

  it("skips empty patches and blank brands", () => {
    const result = commitShippingImport([
      { brand: "Hannaford", patch: {} },
      { brand: "   ", patch: { shipper: "12in" } },
      { brand: "Lowes", patch: { casesPerSkid: 48 } },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.profilesUpdated).toBe(1); // Lowes has no flavors → brand-level only
    expect(readProfile("Hannaford", "")).toBeNull();
    expect(readProfile("Lowes", "")).toMatchObject({ casesPerSkid: 48 });
  });
});
