// @vitest-environment jsdom
//
// Spec-sheet dough NAME apply contract (mirror of specImportSauceName.test.ts).
// A spec sheet can name a product's dough/crust (e.g. "Ultra Thin Dough") even
// when no dough mixing recipe exists yet. applySpecImport must
// (a) set it as the profile's doughRecipeName when nothing is there yet,
// (b) never clobber an existing mixed dough recipe or a name the user set,
// (c) register the name as a selectable Dough Recipe option, and
// (d) when the actual dough recipe imports LATER, re-link its rows/weight onto
//     every already-saved profile pointing at that name (loose-key match) —
//     that re-link is the whole point of capturing the type up front.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  loadProfile,
  saveProfile,
  loadList,
  loadBrandFlavors,
  saveBrandFlavors,
  DEFAULT_VALUES,
  tombstoneDeleted,
  loadDeletedItems,
  loadMergedAway,
  saveMergedAway,
} from "./storage";
import { DOUGH_RECIPE_NAMES_KEY } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

function importWithDough(doughName: string): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Corner Booth",
        flavor: "BBQ CHICKEN",
        doughName,
        applicators: [{ type: "Chicken", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [],
  };
}

describe("applySpecImport named dough (no recipe yet)", () => {
  it("sets the profile's doughRecipeName when the profile has no dough yet", () => {
    applySpecImport(importWithDough("Ultra Thin Dough"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("Ultra Thin Dough");
  });

  it("registers the dough name as a Dough Recipe dropdown option", () => {
    applySpecImport(importWithDough("Ultra Thin Dough"));
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });

  it("does NOT clobber an existing mixed dough recipe, but still registers the option", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      // dieType makes the profile "real" — a dough-only profile is
      // intentionally never persisted (ghost-profile guard).
      dieType: "12 inch",
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    });
    applySpecImport(importWithDough("Ultra Thin Dough"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("House Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 50 }]);
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });

  it("clears delete + merge tombstones so the sync receive-side filters can't strip the name back out", () => {
    tombstoneDeleted("doughRecipeNames", "Ultra Thin Dough");
    saveMergedAway(["Ultra Thin Dough"]);
    applySpecImport(importWithDough("Ultra Thin Dough"));
    expect(loadDeletedItems()["doughRecipeNames"] ?? []).not.toContain("ultra thin dough");
    expect(loadMergedAway()).not.toContain("Ultra Thin Dough");
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });
});

describe("later dough recipe import re-links by name", () => {
  const DOUGH_ROWS = [
    { ingredient: "Flour", lbs: 100 },
    { ingredient: "Water", lbs: 60 },
  ];

  it("attaches the recipe's rows/weight to every saved profile whose doughRecipeName matches (loose key)", () => {
    // Step 1: spec import assigns only the dough TYPE to two products of
    // DIFFERENT brands (so the same-brand fallback can't explain the tie).
    applySpecImport(importWithDough("Ultra Thin Dough"));
    // The re-link pass walks the brand/flavor registry, and dough-only
    // profiles are never persisted (ghost-profile guard) — so the second
    // product is registered and carries a dieType, as any real profile would.
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Pepperoni"] });
    saveProfile("Lowes", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      // Loose-key variant spelling — the re-link must match it anyway and
      // canonicalize onto the recipe's name.
      doughRecipeName: "ultra-thin dough",
    });

    // Step 2: a later import carries the actual dough recipe under a third
    // brand with no explicit targets.
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough",
          brand: "Silverline",
          flavor: "",
          rows: DOUGH_ROWS,
          doughballOz: 12,
          doughballsPerTray: 24,
        },
      ],
    } as unknown as ParsedSpecImport);

    for (const [brand, flavor] of [
      ["Corner Booth", "BBQ CHICKEN"],
      ["Lowes", "Pepperoni"],
    ] as const) {
      const prof = loadProfile(brand, flavor);
      expect(prof?.doughRecipeName, `${brand}/${flavor}`).toBe("Ultra Thin Dough");
      expect(prof?.doughRecipe, `${brand}/${flavor}`).toEqual(DOUGH_ROWS);
      expect(prof?.targetDoughballWeight, `${brand}/${flavor}`).toBe(12);
      expect(prof?.doughballsPerTray, `${brand}/${flavor}`).toBe(24);
    }
  });

  it("re-link NEVER overwrites a profile's existing doughball weight / per-tray (per-flavor values)", () => {
    // Real prod failure: 5 dough spec variants collapsed onto one family name
    // ("CRB Dough"); the re-link tied EVERY CRB profile onto each variant and
    // the last variant's weight/per-tray clobbered all flavors' per-flavor
    // values. Relinked profiles must be backfill-only.
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Pepperoni"] });
    saveProfile("Lowes", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      doughRecipeName: "Ultra Thin Dough",
      targetDoughballWeight: 9,
      doughballsPerTray: 30,
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough",
          brand: "Silverline",
          flavor: "",
          rows: DOUGH_ROWS,
          doughballOz: 12,
          doughballsPerTray: 24,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Lowes", "Pepperoni");
    // Rows still attach; per-flavor numbers survive.
    expect(prof?.doughRecipe).toEqual(DOUGH_ROWS);
    expect(prof?.targetDoughballWeight).toBe(9);
    expect(prof?.doughballsPerTray).toBe(30);
  });

  it("multiple same-named collapsed variants: each EXPLICIT target keeps its own variant's weight/per-tray", () => {
    saveBrandFlavors({
      ...loadBrandFlavors(),
      CRB: ["Cheese", "Pepperoni"],
    });
    for (const flavor of ["Cheese", "Pepperoni"]) {
      saveProfile("CRB", flavor, {
        ...DEFAULT_VALUES,
        dieType: "12 inch",
        doughRecipeName: "CRB Dough",
      });
    }
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "CRB Dough",
          brand: "CRB",
          flavor: "Cheese",
          rows: DOUGH_ROWS,
          doughballOz: 10,
          doughballsPerTray: 20,
        },
        {
          kind: "dough",
          name: "CRB Dough",
          brand: "CRB",
          flavor: "Pepperoni",
          rows: DOUGH_ROWS,
          doughballOz: 14,
          doughballsPerTray: 16,
        },
      ],
    } as unknown as ParsedSpecImport);
    const cheese = loadProfile("CRB", "Cheese");
    const pep = loadProfile("CRB", "Pepperoni");
    expect(cheese?.targetDoughballWeight).toBe(10);
    expect(cheese?.doughballsPerTray).toBe(20);
    expect(pep?.targetDoughballWeight).toBe(14);
    expect(pep?.doughballsPerTray).toBe(16);
  });

  it("does not touch saved profiles pointing at a DIFFERENT dough name", () => {
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Cheese"] });
    saveProfile("Lowes", "Cheese", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      doughRecipeName: "Sourdough Base",
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough",
          brand: "Silverline",
          flavor: "",
          rows: DOUGH_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Lowes", "Cheese");
    expect(prof?.doughRecipeName).toBe("Sourdough Base");
    expect((prof?.doughRecipe ?? []).length).toBe(0);
  });

  it("re-links a SAUCE recipe onto saved profiles whose frontlineRecipeName matches", () => {
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Pepperoni"] });
    saveProfile("Lowes", "Pepperoni", {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "Hot Buffalo Sauce",
    });
    const SAUCE_ROWS = [{ ingredient: "Tomato", lbs: 30 }];
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "sauce",
          name: "Hot Buffalo Sauce",
          brand: "Silverline",
          flavor: "",
          rows: SAUCE_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Lowes", "Pepperoni");
    expect(prof?.frontlineRecipeName).toBe("Hot Buffalo Sauce");
    expect(prof?.frontlineRecipe).toEqual(SAUCE_ROWS);
  });

  it("re-links across a possessive flip: profile says \"Aldo's Sauce\", recipe is \"ALDO PIZZA SAUCE\"", () => {
    // Real prod failure: the spec sheet named the sauce with the possessive
    // brand form while the sauce procedure workbook dropped it — one loose-key
    // character apart ("aldos sauce" vs "aldo sauce"), so a strict compare
    // never relinked and profiles kept an empty frontlineRecipe forever.
    saveBrandFlavors({ ...loadBrandFlavors(), "Aldo's": ["Cheese"] });
    saveProfile("Aldo's", "Cheese", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      frontlineRecipeName: "Aldo's Sauce",
    });
    const SAUCE_ROWS = [{ ingredient: "Tomato", lbs: 30 }];
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "sauce",
          name: "ALDO PIZZA SAUCE",
          brand: "",
          flavor: "",
          rows: SAUCE_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Aldo's", "Cheese");
    expect(prof?.frontlineRecipeName).toBe("ALDO PIZZA SAUCE");
    expect(prof?.frontlineRecipe).toEqual(SAUCE_ROWS);
  });

  it("fans a recipe with bare brand \"Aldo\" onto profiles saved under brand \"Aldo's\"", () => {
    saveBrandFlavors({ ...loadBrandFlavors(), "Aldo's": ["Pepperoni"] });
    saveProfile("Aldo's", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Aldo Dough",
          brand: "Aldo",
          flavor: "",
          rows: DOUGH_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Aldo's", "Pepperoni");
    expect(prof?.doughRecipeName).toBe("Aldo Dough");
    expect(prof?.doughRecipe).toEqual(DOUGH_ROWS);
  });

  it("dough/sauce sheet targets never CREATE brands — unknown customer names are skipped", () => {
    // Real prod failure: a dough procedure workbook listed customer/flavor
    // pairs (LUCIA'S CRAFT, FSD 7'', Hannaford...) and the tie loop minted
    // them all as new brands in the shared registry.
    saveBrandFlavors({ ...loadBrandFlavors(), "Aldo's": ["Pepperoni"] });
    saveProfile("Aldo's", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Shared Dough",
          brand: "Aldo's",
          flavor: "Pepperoni",
          targets: [
            { brand: "LUCIA'S CRAFT", flavor: "BACON CHEESEBURGER" },
            { brand: "Hannaford", flavor: "Cheese" },
          ],
          rows: DOUGH_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const brands = Object.keys(loadBrandFlavors());
    expect(brands).not.toContain("LUCIA'S CRAFT");
    expect(brands).not.toContain("Hannaford");
    // The known brand+flavor still got the tie.
    expect(loadProfile("Aldo's", "Pepperoni")?.doughRecipe).toEqual(DOUGH_ROWS);
  });

  it("canonicalizes a loose-matching target onto the EXISTING brand spelling (no near-dup brand minted)", () => {
    // A target of "Aldo"/"Pepperoni" loose-matches the saved "Aldo's" brand —
    // it must tie onto "Aldo's"/"Pepperoni", not register a new "Aldo" brand.
    saveBrandFlavors({ ...loadBrandFlavors(), "Aldo's": ["Pepperoni"] });
    saveProfile("Aldo's", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Shared Dough",
          brand: "Aldo",
          flavor: "Pepperoni",
          rows: DOUGH_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    expect(Object.keys(loadBrandFlavors())).not.toContain("Aldo");
    expect(loadProfile("Aldo's", "Pepperoni")?.doughRecipe).toEqual(DOUGH_ROWS);
  });
});
