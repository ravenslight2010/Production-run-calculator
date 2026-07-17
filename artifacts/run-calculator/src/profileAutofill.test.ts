// Tests for the setup-profile auto-fill planner (profileAutofill.ts): blank
// fields fill from the latest saved spec sheets, differing fields surface as
// per-field mismatches, and the field semantics mirror the real import loop
// (loose recipe-name keys, applicator slot resolution, latest-sheet-wins).
import { describe, it, expect } from "vitest";
import { buildProfileAutofillPlan, applyAutofillEntries } from "./profileAutofill";
import { DEFAULT_VALUES, type FormValues } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

const NO_MIXES: ReadonlySet<string> = new Set();

function emptyData(): ParsedSpecImport {
  return { profiles: [], recipes: [] } as unknown as ParsedSpecImport;
}

function sheet(
  id: number,
  createdAt: number,
  data: Partial<ParsedSpecImport>,
  opts?: { label?: string; sourceKey?: string | null },
) {
  return {
    id,
    label: opts?.label ?? `Sheet ${id}`,
    sourceKey: opts?.sourceKey ?? `file-${id}.xlsx`,
    createdAt,
    data: { ...emptyData(), ...data } as ParsedSpecImport,
  };
}

function values(overrides: Partial<FormValues> = {}): FormValues {
  return { ...DEFAULT_VALUES, ...overrides } as FormValues;
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    brand: "Aldo's",
    flavor: "Pepperoni",
    applicators: [],
    pepperonis: [],
    ...overrides,
  };
}

function plan(
  sheets: ReturnType<typeof sheet>[],
  current: FormValues,
  mixNamesLower: ReadonlySet<string> = NO_MIXES,
) {
  return buildProfileAutofillPlan({
    sheets,
    brand: "Aldo's",
    flavor: "Pepperoni",
    current,
    mixNamesLower,
  });
}

describe("buildProfileAutofillPlan", () => {
  it("fills blank scalar fields and leaves matching ones alone", () => {
    const p = plan(
      [sheet(1, 100, { profiles: [profile({ dieType: "12in Round", sauceOzPerPizza: 4.5, pizzasPerCase: 12 })] })],
      values({ pizzasPerCase: 12 }), // already matches → neither fill nor mismatch
    );
    expect(p.matchedSheets).toBe(1);
    const fields = p.fills.map(f => f.field).sort();
    expect(fields).toEqual(["dieType", "sauceOzPerPizza"]);
    expect(p.mismatches).toEqual([]);
  });

  it("reports differing non-blank fields as mismatches, never as fills", () => {
    const p = plan(
      [sheet(1, 100, { profiles: [profile({ dieType: "12in Round", sauceOzPerPizza: 4.5 })] })],
      values({ dieType: "14in Round", sauceOzPerPizza: 5 }),
    );
    expect(p.fills).toEqual([]);
    const byField = new Map(p.mismatches.map(m => [m.field, m]));
    expect(byField.get("dieType")?.currentValue).toBe("14in Round");
    expect(byField.get("dieType")?.specValue).toBe("12in Round");
    expect(byField.get("sauceOzPerPizza")?.specValue).toBe(4.5);
  });

  it("treats allergen 'none' and non-zero schema defaults as blank (fillable)", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({
          allergen: "egg",
          pepperonis: [{ type: "Pepperoni", sticks: 6, ozPerPizza: 1.2, batchLbs: 30 }],
        })],
      })],
      values(), // allergen "none", pep1BatchLbs default 25
    );
    const fields = new Set(p.fills.map(f => f.field));
    expect(fields.has("allergen")).toBe(true);
    expect(fields.has("pep1Type")).toBe(true);
    expect(fields.has("pep1BatchLbs")).toBe(true); // default 25 counts as unset
    expect(p.mismatches).toEqual([]);
    expect(p.pepCombinedTarget).toBe(true); // single named pep → combined
  });

  it("uses the loose name key so a weight-suffixed blend is NOT a mismatch", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "Aldo's Cheese Mix 1.75", ozPerPizza: 1.75 }] })],
        recipes: [{ kind: "cheese", name: "Aldo's Cheese Mix", rows: [{ ingredient: "Mozz", lbs: 10 }] }],
      })],
      values({ app1Type: "cheese", app1CheeseRecipeName: "Aldo's Cheese Mix", app1OzPerPizza: 1.75 } as Partial<FormValues>),
    );
    expect(p.fills).toEqual([]);
    expect(p.mismatches).toEqual([]);
  });

  it("resolves cheese applicator slots to type 'cheese' + recipe-name link fills", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "Aldo's Cheese Mix", ozPerPizza: 2 }] })],
        recipes: [{ kind: "cheese", name: "Aldo's Cheese Mix", rows: [{ ingredient: "Mozz", lbs: 10 }] }],
      })],
      values(),
    );
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("app1Type")).toBe("cheese");
    expect(byField.get("app1CheeseRecipeName")).toBe("Aldo's Cheese Mix");
    expect(byField.get("app1OzPerPizza")).toBe(2);
  });

  it("offers applicator batch lbs even when the slot has recipe rows (import parity)", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "cheese", ozPerPizza: 2, batchLbs: 40 }] })],
      })],
      values({
        app1Type: "cheese",
        app1OzPerPizza: 2,
        app1BatchLbs: 35,
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 20 }],
      } as Partial<FormValues>),
    );
    const m = p.mismatches.find(x => x.field === "app1BatchLbs");
    expect(m?.specValue).toBe(40);
    expect(m?.currentValue).toBe(35);
  });

  it("routes mix-named recipes to type 'Mix' when the name is a known mix", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "White Fajita Mix", ozPerPizza: 1.5 }] })],
        recipes: [{ kind: "cheese", name: "White Fajita Mix", rows: [{ ingredient: "A", lbs: 1 }, { ingredient: "B", lbs: 2 }] }],
      })],
      values(),
      new Set(["white fajita mix"]),
    );
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("app1Type")).toBe("Mix");
    expect(byField.get("app1CheeseRecipeName")).toBe("White Fajita Mix");
  });

  it("resolves a slot naming a SERVER-POOL cheese recipe the sheet does not re-declare (pool union)", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "Lucia's Club Cheese Mix", ozPerPizza: 2 }] })],
        recipes: [],
      })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      cheeseRecipes: [{ name: "Lucia's Club Cheese Mix", components: [{ lbs: 10 }] }],
    });
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("app1Type")).toBe("cheese");
    expect(byField.get("app1CheeseRecipeName")).toBe("Lucia's Club Cheese Mix");
  });

  it("resolves a slot naming a SERVER-POOL mix the sheet does not re-declare (pool union)", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "Carribean Mix", ozPerPizza: 1.5 }] })],
        recipes: [],
      })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: new Set(["carribean mix"]),
      mixes: [{ name: "Carribean Mix", batchSize: 0 }],
    });
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("app1Type")).toBe("Mix");
    expect(byField.get("app1CheeseRecipeName")).toBe("Carribean Mix");
  });

  it("a cheese-named recipe stays CHEESE even when a junk same-named mix-pool entry exists", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, {
        profiles: [profile({ applicators: [{ type: "Lowe's Red Hot Cheese Mix", ozPerPizza: 2 }] })],
        recipes: [{ kind: "cheese", name: "Lowe's Red Hot Cheese Mix", rows: [{ ingredient: "Jack", lbs: 1 }, { ingredient: "Seasoning", lbs: 0.1 }] }],
      })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: new Set(["lowe's red hot cheese mix"]),
      mixes: [{ name: "Lowe's Red Hot Cheese Mix", batchSize: 0 }],
    });
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("app1Type")).toBe("cheese");
    expect(byField.get("app1CheeseRecipeName")).toBe("Lowe's Red Hot Cheese Mix");
  });

  it("only consults the LATEST snapshot per source file; newest wins per field", () => {
    const p = plan(
      [
        // Old snapshot of the same file — must be ignored entirely.
        sheet(1, 100, { profiles: [profile({ dieType: "OLD DIE", sauceOzPerPizza: 9 })] }, { sourceKey: "spec.xlsx" }),
        sheet(2, 200, { profiles: [profile({ dieType: "12in Round" })] }, { sourceKey: "spec.xlsx" }),
        // A different latest file states sauce oz — combines per-field.
        sheet(3, 150, { profiles: [profile({ sauceOzPerPizza: 4 })] }, { sourceKey: "other.xlsx" }),
      ],
      values(),
    );
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("dieType")).toBe("12in Round");
    expect(byField.get("sauceOzPerPizza")).toBe(4);
    expect(p.matchedSheets).toBe(2);
  });

  it("skips sauce/dough names when the profile already has mixed recipe rows", () => {
    const p = plan(
      [sheet(1, 100, { profiles: [profile({ sauceName: "BBQ Sauce", doughName: "Ultra Thin" })] })],
      values({
        frontlineRecipe: [{ ingredient: "Tomato", lbs: 100 }],
        doughRecipe: [{ ingredient: "Flour", lbs: 200 }],
        frontlineRecipeName: "House Red",
        doughRecipeName: "Classic",
      } as Partial<FormValues>),
    );
    expect(p.fills).toEqual([]);
    expect(p.mismatches).toEqual([]);
  });

  it("fills blank sauce/dough names when no mixed rows exist", () => {
    const p = plan(
      [sheet(1, 100, { profiles: [profile({ sauceName: "BBQ Sauce", doughName: "Ultra Thin" })] })],
      values(),
    );
    const fields = new Set(p.fills.map(f => f.field));
    expect(fields.has("frontlineRecipeName")).toBe(true);
    expect(fields.has("doughRecipeName")).toBe(true);
  });

  it("returns an empty plan when no latest sheet mentions the brand+flavor", () => {
    const p = plan(
      [sheet(1, 100, { profiles: [profile({ brand: "Other", flavor: "Cheese", dieType: "X" })] })],
      values(),
    );
    expect(p.matchedSheets).toBe(0);
    expect(p.fills).toEqual([]);
    expect(p.mismatches).toEqual([]);
  });

  it("fills dough name + doughball fields from a dough RECIPE with explicit targets (no profile block)", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [{
          kind: "dough",
          name: "Ultra Thin Dough",
          rows: [{ ingredient: "Flour", lbs: 200 }],
          targets: [{ brand: "Aldo's", flavor: "Pepperoni" }],
          doughballOz: 9.5,
          doughBatchYield: 120,
          doughballsPerTray: 24,
        }],
      })],
      values(),
    );
    expect(p.matchedSheets).toBe(1);
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("doughRecipeName")).toBe("Ultra Thin Dough");
    expect(byField.get("targetDoughballWeight")).toBe(9.5);
    expect(byField.get("doughBatchYield")).toBe(120);
    expect(byField.get("doughballsPerTray")).toBe(24);
  });

  it("fans a brand-only dough recipe out to the edited profile (apply-pool fallback)", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [{ kind: "dough", name: "House Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Aldo's" }],
      })],
      values(),
    );
    expect(p.fills.find(f => f.field === "doughRecipeName")?.specValue).toBe("House Dough");
  });

  it("re-links a dough recipe by loose name match against the current dough name", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [{
          kind: "dough",
          name: "ultra thin dough",
          rows: [{ ingredient: "Flour", lbs: 100 }],
          doughballOz: 9.5,
        }],
      })],
      values({ doughRecipeName: "Ultra Thin Dough" } as Partial<FormValues>),
    );
    // Name already matches (loose key) → no name fill/mismatch, but the
    // doughball weight it carries is offered.
    expect(p.fills.find(f => f.field === "targetDoughballWeight")?.specValue).toBe(9.5);
    expect(p.mismatches.find(m => m.field === "doughRecipeName")).toBeUndefined();
  });

  it("re-links via the SAME sheet's profile doughName when the form is blank (import ordering)", () => {
    // The import's profile loop assigns doughName BEFORE the recipe tie runs,
    // so an unscoped dough recipe whose name matches the sheet's own doughName
    // must still reach this profile even though the form starts blank.
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ doughName: "Ultra Thin Dough" })],
        recipes: [{
          kind: "dough",
          name: "ULTRA THIN  DOUGH", // loose-key equal, canonical spelling differs
          rows: [{ ingredient: "Flour", lbs: 100 }],
          doughballOz: 9,
          doughBatchYield: 110,
        }],
      })],
      values(),
    );
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("doughRecipeName")).toBe("ULTRA THIN  DOUGH");
    expect(byField.get("targetDoughballWeight")).toBe(9);
    expect(byField.get("doughBatchYield")).toBe(110);
  });

  it("name-relinked variant rows never overwrite a non-blank doughball weight (last-variant-wins bug)", () => {
    // A dough mixing sheet carries many same-named family variant rows. Only
    // the row anchored to THIS brand may state the weight verbatim; rows tied
    // on only by the name re-link are blank-fill-only — otherwise whichever
    // variant is processed last (e.g. Lowe's 7 Inch, 5.7 oz) is offered as a
    // bogus mismatch on a Corner Booth 8.25 oz profile.
    const p = plan(
      [sheet(1, 100, {
        recipes: [
          { kind: "dough", name: "CRB Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Aldo's", doughballOz: 8.25, doughBatchYield: 620, doughballsPerTray: 24 },
          { kind: "dough", name: "CRB Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Other Brand", doughballOz: 5.7, doughBatchYield: 898, doughballsPerTray: 24 },
        ],
      })],
      values({ doughRecipeName: "CRB Dough", targetDoughballWeight: 8.25, doughBatchYield: 620 } as Partial<FormValues>),
    );
    for (const field of ["targetDoughballWeight", "doughBatchYield"] as const) {
      expect(p.mismatches.find(m => m.field === field)).toBeUndefined();
      expect(p.fills.find(f => f.field === field)).toBeUndefined();
    }
  });

  it("an anchored variant row still overwrites an earlier relinked backfill (import ordering)", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [
          { kind: "dough", name: "CRB Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Other Brand", doughballOz: 5.7 },
          { kind: "dough", name: "CRB Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Aldo's", doughballOz: 8.25 },
        ],
      })],
      values({ doughRecipeName: "CRB Dough" } as Partial<FormValues>),
    );
    expect(p.fills.find(f => f.field === "targetDoughballWeight")?.specValue).toBe(8.25);
  });

  it("dough-pool weight is variant-aware: ambiguous variants offer no weight, a die match offers its variant", () => {
    const doughRecipes = [{
      name: "CRB Dough",
      brand: "Aldo's",
      flavors: [],
      doughballWeightOz: 13,
      doughballVariants: [
        { label: "Corner Booth", weightOz: 8.25, perTray: 24 },
        { label: "Lowe's 7 Inch", weightOz: 5.7, perTray: 24 },
        { label: "Hannaford", weightOz: 7.6, perTray: 24 },
      ],
    }];
    // Die "12" matches no variant label → ambiguous → the recipe-level 13 oz
    // must NOT surface as a mismatch against the profile's 8.25.
    const ambiguous = buildProfileAutofillPlan({
      sheets: [],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values({ doughRecipeName: "CRB Dough", dieType: '12"', targetDoughballWeight: 8.25 } as Partial<FormValues>),
      mixNamesLower: NO_MIXES,
      doughRecipes,
    });
    expect(ambiguous.mismatches.find(m => m.field === "targetDoughballWeight")).toBeUndefined();
    expect(ambiguous.fills.find(f => f.field === "targetDoughballWeight")).toBeUndefined();
    // Die "7" matches exactly one label → that variant's weight is offered.
    const matched = buildProfileAutofillPlan({
      sheets: [],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values({ doughRecipeName: "CRB Dough", dieType: '7"' } as Partial<FormValues>),
      mixNamesLower: NO_MIXES,
      doughRecipes,
    });
    expect(matched.fills.find(f => f.field === "targetDoughballWeight")?.specValue).toBe(5.7);
    expect(matched.fills.find(f => f.field === "doughballsPerTray")?.specValue).toBe(24);
  });

  it("does not tie an unanchored dough recipe to unrelated profiles", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [{ kind: "dough", name: "Someone Else's Dough", rows: [{ ingredient: "Flour", lbs: 100 }], brand: "Other Brand" }],
      })],
      values(),
    );
    expect(p.matchedSheets).toBe(0);
    expect(p.fills).toEqual([]);
  });

  it("dough RECIPE name outranks the profile-level doughName within the same sheet", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({ doughName: "Old Name" })],
        recipes: [{
          kind: "dough",
          name: "Canonical Dough",
          rows: [{ ingredient: "Flour", lbs: 100 }],
          targets: [{ brand: "Aldo's", flavor: "Pepperoni" }],
        }],
      })],
      values(),
    );
    expect(p.fills.find(f => f.field === "doughRecipeName")?.specValue).toBe("Canonical Dough");
  });

  it("fills sauce name from a targeted sauce RECIPE", () => {
    const p = plan(
      [sheet(1, 100, {
        recipes: [{
          kind: "sauce",
          name: "House Red Sauce",
          rows: [{ ingredient: "Tomato", lbs: 50 }],
          targets: [{ brand: "Aldo's", flavor: "Pepperoni" }],
        }],
      })],
      values(),
    );
    expect(p.fills.find(f => f.field === "frontlineRecipeName")?.specValue).toBe("House Red Sauce");
  });

  it("derives pepCombinedTarget=false when two peps are named", () => {
    const p = plan(
      [sheet(1, 100, {
        profiles: [profile({
          pepperonis: [
            { type: "Pepperoni", sticks: 6, ozPerPizza: 1.2 },
            { type: "Cheese Stick", sticks: 4, ozPerPizza: 0.8 },
          ],
        })],
      })],
      values(),
    );
    expect(p.pepCombinedTarget).toBe(false);
    const fields = new Set(p.fills.map(f => f.field));
    expect(fields.has("pep1Type")).toBe(true);
    expect(fields.has("pep2Type")).toBe(true);
  });
});

describe("buildProfileAutofillPlan — multi-source conflicts", () => {
  function guide(
    createdAt: number,
    rows: Array<{ brand: string; flavors?: string[]; patch: Record<string, unknown> }>,
    label = "Guide",
  ) {
    return { label, sourceKey: `guide-${createdAt}`, createdAt, rows } as never;
  }

  it("fills a packaging field from the palletizing guide when the spec is silent", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ dieType: "12in Round" })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { pizzasPerCase: 16, casesPerSkid: 40 } }])],
    });
    const byField = new Map(p.fills.map(f => [f.field, f.specValue]));
    expect(byField.get("pizzasPerCase")).toBe(16);
    expect(byField.get("casesPerSkid")).toBe(40);
    expect(p.conflicts).toEqual([]);
  });

  it("flags a conflict when spec and guide disagree on the same field, and lets the user pick", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ pizzasPerCase: 12 })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { pizzasPerCase: 16 } }])],
    });
    // Not silently filled either way.
    expect(p.fills.find(f => f.field === "pizzasPerCase")).toBeUndefined();
    const conflict = p.conflicts.find(c => c.field === "pizzasPerCase");
    expect(conflict).toBeDefined();
    const vals = conflict!.candidates.map(c => c.value).sort();
    expect(vals).toEqual([12, 16]);
  });

  it("agreeing sources do NOT create a conflict (fills once)", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ pizzasPerCase: 16 })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { pizzasPerCase: 16 } }])],
    });
    expect(p.conflicts).toEqual([]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")?.specValue).toBe(16);
  });

  it("records the current value on a conflict when the field is already set", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ pizzasPerCase: 12 })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values({ pizzasPerCase: 20 }),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { pizzasPerCase: 16 } }])],
    });
    const conflict = p.conflicts.find(c => c.field === "pizzasPerCase");
    expect(conflict?.currentValue).toBe(20);
  });

  it("stays backward-compatible: spec-only input yields no conflicts", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ dieType: "12in Round", pizzasPerCase: 12 })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
    });
    expect(p.conflicts).toEqual([]);
    expect(p.fills.map(f => f.field).sort()).toEqual(["dieType", "pizzasPerCase"]);
  });

  it("does NOT flag a conflict for near-equal numeric values across sources", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ sauceOzPerPizza: 4.5 })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { sauceOzPerPizza: 4.5000001 } }])],
    });
    expect(p.conflicts.find(c => c.field === "sauceOzPerPizza")).toBeUndefined();
    expect(p.fills.find(f => f.field === "sauceOzPerPizza")?.specValue).toBe(4.5);
  });

  it("does NOT flag a conflict for casing/whitespace-only string differences across sources", () => {
    const p = buildProfileAutofillPlan({
      sheets: [sheet(1, 100, { profiles: [profile({ dieType: "12in Round" })] })],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides: [guide(200, [{ brand: "Aldo's", patch: { dieType: "  12IN round " } }])],
    });
    expect(p.conflicts.find(c => c.field === "dieType")).toBeUndefined();
    expect(p.fills.find(f => f.field === "dieType")?.specValue).toBe("12in Round");
  });
});

describe("applyAutofillEntries", () => {
  it("writes accepted entries and derives pep1Combined only when a pep type applies", () => {
    const start = values({ pep1Combined: true } as Partial<FormValues>);
    const out = applyAutofillEntries(
      start,
      [
        { field: "pep1Type", label: "Pepperoni 1 Type", specValue: "Pepperoni", source: "s" },
        { field: "pep2Type", label: "Pepperoni 2 Type", specValue: "Cheese Stick", source: "s" },
        { field: "dieType", label: "Die Type", specValue: "12in Round", source: "s" },
      ],
      false,
    );
    const rec = out as unknown as Record<string, unknown>;
    expect(rec.pep1Type).toBe("Pepperoni");
    expect(rec.pep2Type).toBe("Cheese Stick");
    expect(rec.dieType).toBe("12in Round");
    expect(rec.pep1Combined).toBe(false);
    // Does not mutate the input.
    expect((start as unknown as Record<string, unknown>).dieType).not.toBe("12in Round");
  });

  it("leaves pep1Combined untouched when no pep type entry is applied", () => {
    const start = values({ pep1Combined: true } as Partial<FormValues>);
    const out = applyAutofillEntries(
      start,
      [{ field: "dieType", label: "Die Type", specValue: "12in Round", source: "s" }],
      false,
    );
    expect((out as unknown as Record<string, unknown>).pep1Combined).toBe(true);
  });
});
