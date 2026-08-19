// @vitest-environment node
//
// Regression: commitSpecImport must apply accepted new mix ingredient rows
// even when the pruned spec-import parse yields NO mix candidates
// (snapshot-pruned re-import path). This covers the case where a manager:
//   1. Opens a workbook that now has "Bell Peppers" added to "Veggie Mix"
//   2. prepare() detects it and shows it in the review dialog
//   3. The manager checks "Veggie Mix" to accept the addition
//   4. commit() is called — but the pruned parse has no mix recipes in it
//      (the recipe appears unchanged vs the saved snapshot), so candidates=[].
//   Previously the entire mix-save block was skipped when candidates=[], so
//   the manager's accepted addition was silently dropped.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { Mix } from "@workspace/mixes";

// ── Collaborator mocks (same shape as specImportCheeseUpdateGuard.test.ts) ──

const EMPTY_KNOWN = {
  brands: [] as string[],
  flavorsByBrand: {} as Record<string, string[]>,
  appTypes: [] as string[],
  pepTypes: [] as string[],
  cheeseIngredients: [] as string[],
  doughIngredients: [] as string[],
  sauceIngredients: [] as string[],
  sauceNames: [] as string[],
  dieTypes: [] as string[],
  doughRecipes: [] as string[],
  sauceRecipes: [] as string[],
  cheeseRecipes: [] as string[],
};

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  // Non-empty sourceKey would trigger snapshot fetch + pruning; return ""
  // to skip the prune block and let us control applyParsed directly.
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: async () => {
    throw new Error("no AI parse in this test");
  },

  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [],
  saveCheeseRecipes: async () => {},
  fetchCheesePoolNamesBestEffort: async () => [],
}));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipePool: async () => [],
  addNamedRecipesToServerIfAbsent: async () => ({ added: 0, recipes: [] }),
  saveNamedRecipePool: async () => {},
}));
vi.mock("./dieLineDefaults", () => ({
  fetchDieLineDefaults: async () => ({ defaults: {} }),
}));

// ── Controllable mixes mock ─────────────────────────────────────────────────

const mixStore = vi.hoisted(() => ({
  existing: [] as Mix[],
  saved: null as Mix[] | null,
  saveCount: 0,
}));

vi.mock("./mixes", () => ({
  fetchMixes: async () => mixStore.existing,
  saveMixes: async (items: Mix[]) => {
    mixStore.saved = items;
    mixStore.saveCount++;
    return items;
  },
}));

import { commitSpecImport, type SpecImportPrepared } from "./specImport";
import { normalizeMix } from "@workspace/mixes";

function makeMix(name: string, brand: string, components: Array<{ ingredient: string; perPizza: number }>): Mix {
  return normalizeMix({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    brand,
    flavor: "",
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components,
    enabled: true,
  })!;
}

function minimalPrepared(parsed: ParsedSpecImport, extra: Partial<SpecImportPrepared> = {}): SpecImportPrepared {
  return {
    parsed,
    summary: {
      profilesNew: 0,
      profilesUpdated: 0,
      recipesNew: 0,
      recipesUpdated: 0,
      totalProfiles: 0,
      totalRecipes: 0,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
    ...extra,
  };
}

beforeEach(() => {
  mixStore.existing = [];
  mixStore.saved = null;
  mixStore.saveCount = 0;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("commitSpecImport — accepted new mix ingredients on snapshot-pruned re-import", () => {
  it("persists an accepted new component even when candidates is empty (pruned parse has no mix recipes)", async () => {
    // Existing pool: "Veggie Mix" (branded) with one component.
    mixStore.existing = [
      makeMix("Veggie Mix", "Aldo's", [{ ingredient: "Mozzarella", perPizza: 2.5 }]),
    ];

    // prepared.parsed has NO recipes (simulates snapshot-pruned re-import where
    // the mix recipe was unchanged and was stripped by pruneSpecImportAgainstSnapshot).
    const parsed: ParsedSpecImport = {
      profiles: [{ brand: "Aldo's", flavor: "BBQ", applicators: [], pepperonis: [] }],
      recipes: [],
    };

    // The prepare phase detected "Bell Peppers" as a new ingredient on "Veggie Mix".
    const prepared = minimalPrepared(parsed, {
      newMixIngredients: [
        {
          mixName: "Veggie Mix",
          brand: "Aldo's",
          newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }],
        },
      ],
    });

    // Manager accepts "Veggie Mix" via compound brand+name key (NUL separator,
    // lower-cased) — matching what the dialog passes through onConfirm.
    await commitSpecImport(prepared, undefined, new Set(["aldo's\0veggie mix"]));

    expect(mixStore.saved).not.toBeNull();
    const veggieInSaved = (mixStore.saved ?? []).find(
      (m) => m.name.toLowerCase() === "veggie mix",
    );
    expect(veggieInSaved).toBeDefined();
    // Original component must survive.
    expect(veggieInSaved!.components.some((c) => c.ingredient === "Mozzarella")).toBe(true);
    // Newly accepted component must be appended.
    expect(veggieInSaved!.components.some((c) => c.ingredient === "Bell Peppers")).toBe(true);
    const bellPeppers = veggieInSaved!.components.find((c) => c.ingredient === "Bell Peppers");
    expect(bellPeppers?.perPizza).toBe(0.75);
  });

  it("does NOT save when the accepted addition is unchecked (skipped by the manager)", async () => {
    mixStore.existing = [
      makeMix("Veggie Mix", "Aldo's", [{ ingredient: "Mozzarella", perPizza: 2.5 }]),
    ];
    const parsed: ParsedSpecImport = {
      profiles: [{ brand: "Aldo's", flavor: "BBQ", applicators: [], pepperonis: [] }],
      recipes: [],
    };
    const prepared = minimalPrepared(parsed, {
      newMixIngredients: [
        {
          mixName: "Veggie Mix",
          brand: "Aldo's",
          newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }],
        },
      ],
    });

    // acceptedNewMixIngredientNames is empty — manager did not check the mix.
    await commitSpecImport(prepared, undefined, new Set());

    // Nothing changed → saveMixes must NOT be called.
    expect(mixStore.saveCount).toBe(0);
    expect(mixStore.saved).toBeNull();
  });

  it("persists an accepted new component on an UNBRANDED existing mix (tag-backfill path)", async () => {
    // Existing pool: "Veggie Mix" saved WITHOUT a brand (unbranded pool mix).
    // The detection phase ran fillSpecMixTags so it sees brand="Aldo's" and
    // returns brand="Aldo's" in newMixIngredients. At commit time the existing
    // mix is still unbranded — the commit must tag it + append the component.
    mixStore.existing = [
      makeMix("Veggie Mix", "", [{ ingredient: "Mozzarella", perPizza: 2.5 }]),
    ];
    const parsed: ParsedSpecImport = {
      profiles: [{ brand: "Aldo's", flavor: "BBQ", applicators: [], pepperonis: [] }],
      recipes: [],
    };
    const prepared = minimalPrepared(parsed, {
      newMixIngredients: [
        {
          mixName: "Veggie Mix",
          brand: "Aldo's", // post-fillSpecMixTags brand from detection
          newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }],
        },
      ],
    });

    await commitSpecImport(prepared, undefined, new Set(["aldo's\0veggie mix"]));

    expect(mixStore.saved).not.toBeNull();
    const veggieInSaved = (mixStore.saved ?? []).find(
      (m) => m.name.toLowerCase() === "veggie mix",
    );
    expect(veggieInSaved).toBeDefined();
    // The mix should now carry the brand assigned by the tag-backfill step.
    expect(veggieInSaved!.brand).toBe("Aldo's");
    // And the new component should be appended.
    expect(veggieInSaved!.components.some((c) => c.ingredient === "Bell Peppers")).toBe(true);
  });

  it("does NOT duplicate a component already present in the mix (double-guard)", async () => {
    mixStore.existing = [
      makeMix("Veggie Mix", "Aldo's", [
        { ingredient: "Mozzarella", perPizza: 2.5 },
        { ingredient: "Bell Peppers", perPizza: 0.75 }, // already there
      ]),
    ];
    const parsed: ParsedSpecImport = {
      profiles: [{ brand: "Aldo's", flavor: "BBQ", applicators: [], pepperonis: [] }],
      recipes: [],
    };
    const prepared = minimalPrepared(parsed, {
      newMixIngredients: [
        {
          mixName: "Veggie Mix",
          brand: "Aldo's",
          newComponents: [{ ingredient: "Bell Peppers", perPizza: 1.0 }], // already present
        },
      ],
    });

    await commitSpecImport(prepared, undefined, new Set(["aldo's\0veggie mix"]));

    // Double-guard: "Bell Peppers" already exists → nothing actually changed.
    expect(mixStore.saveCount).toBe(0);
    expect(mixStore.saved).toBeNull();
  });

  it("persists a new component with perPizza=0 (missing amount) so manager can fill it in later", async () => {
    mixStore.existing = [
      makeMix("Sauce Mix", "Lucia's", [{ ingredient: "Tomatoes", perPizza: 3.0 }]),
    ];
    const parsed: ParsedSpecImport = {
      profiles: [{ brand: "Lucia's", flavor: "Classic", applicators: [], pepperonis: [] }],
      recipes: [],
    };
    const prepared = minimalPrepared(parsed, {
      newMixIngredients: [
        {
          mixName: "Sauce Mix",
          brand: "Lucia's",
          newComponents: [{ ingredient: "Basil", perPizza: 0 }], // new, oz unknown yet
        },
      ],
    });

    await commitSpecImport(prepared, undefined, new Set(["lucia's\0sauce mix"]));

    expect(mixStore.saved).not.toBeNull();
    const sauceInSaved = (mixStore.saved ?? []).find(
      (m) => m.name.toLowerCase() === "sauce mix",
    );
    expect(sauceInSaved).toBeDefined();
    const basil = sauceInSaved!.components.find((c) => c.ingredient === "Basil");
    expect(basil).toBeDefined();
    expect(basil!.perPizza).toBe(0);
  });

  it("keeps a saved mix's positive oz/pizza when its linked spec row has no amount", async () => {
    mixStore.existing = [
      {
        ...makeMix("Basha's Red Fajita Mix", "Basha's", [
          { ingredient: "Red Pepper", perPizza: 1.25 },
          { ingredient: "Cellulose", perPizza: 0.03 },
        ]),
        flavor: "RED FAJITA",
        batchSize: 55,
        daysEarly: 2,
        amountAlreadyMade: 12,
        enabled: false,
        notes: "Pull 2 days early",
      },
    ];
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          forcedCategory: "mix",
          name: "Basha's Red Fajita Mix",
          brand: "Basha's",
          flavor: "RED FAJITA",
          // Spec parser carries per-pizza ounces in `lbs`. Red Pepper's blank
          // sheet amount becomes 0; Onion's positive sheet amount must win.
          rows: [
            { ingredient: "Red Pepper", lbs: 0 },
            { ingredient: "Onion", lbs: 0.75 },
          ],
        },
      ],
    };

    await commitSpecImport(minimalPrepared(parsed));

    const saved = (mixStore.saved ?? []).find((m) => m.name === "Basha's Red Fajita Mix");
    expect(saved).toMatchObject({
      batchSize: 55,
      daysEarly: 2,
      amountAlreadyMade: 12,
      enabled: false,
      notes: "Pull 2 days early",
    });
    expect(saved?.components).toEqual([
      { ingredient: "Red Pepper", perPizza: 1.25 },
      { ingredient: "Onion", perPizza: 0.75 },
      { ingredient: "Cellulose", perPizza: 0.03 },
    ]);
  });
});
