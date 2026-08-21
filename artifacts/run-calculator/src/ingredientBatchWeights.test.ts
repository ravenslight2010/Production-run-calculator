import { describe, it, expect } from "vitest";
import {
  buildBatchWeightMap,
  lookupBatchWeight,
  collectBatchWeightCandidates,
  buildBatchWeightPropagationPlan,
  batchWeightPropagationToast,
  executeBatchWeightPropagation,
  type BatchWeightFormSlice,
} from "./ingredientBatchWeights";

const DEFAULT_PEPS = ["Pepperoni", "Cup & Char"];

function emptySlice(): BatchWeightFormSlice {
  return {
    apps: [],
    peps: [],
    defaultPepTypes: DEFAULT_PEPS,
    sauce: { recipeName: "", barrelLbs: 0, recipe: [] },
  };
}

describe("buildBatchWeightMap / lookupBatchWeight", () => {
  it("keys case-insensitively and drops degenerate rows", () => {
    const map = buildBatchWeightMap([
      { name: "  Bacon Crumble ", lbs: 25 },
      { name: "", lbs: 10 },
      { name: "Zero", lbs: 0 },
      { name: "Neg", lbs: -5 },
      { name: "Bad", lbs: Number.NaN },
    ]);
    expect(map.size).toBe(1);
    expect(lookupBatchWeight(map, "bacon crumble")).toBe(25);
    expect(lookupBatchWeight(map, "BACON CRUMBLE  ")).toBe(25);
    expect(lookupBatchWeight(map, "sausage")).toBeNull();
    expect(lookupBatchWeight(map, "")).toBeNull();
  });
});

describe("collectBatchWeightCandidates", () => {
  it("collects visible positive applicator weights that differ from learned", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Bacon", batchLbs: 30, cheeseRecipe: [] },
      { type: "Sausage", batchLbs: 20, cheeseRecipe: [] },
    ];
    const learned = buildBatchWeightMap([{ name: "sausage", lbs: 20 }]);
    const out = collectBatchWeightCandidates(slice, learned);
    expect(out).toEqual([{ name: "Bacon", lbs: 30 }]);
  });

  it("skips mixes, recipe-backed slots, empty types, and non-positive weights", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Veggie Mix", batchLbs: 40, cheeseRecipe: [] }, // mix — recipe rows own the weight
      { type: "Cheese", batchLbs: 15, cheeseRecipe: [{ lbs: 10 }] }, // recipe-backed
      { type: "", batchLbs: 12, cheeseRecipe: [] }, // no ingredient picked
      { type: "Onion", batchLbs: 0, cheeseRecipe: [] }, // nothing entered
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([]);
  });

  it("skips default stick-pep types but learns custom pep types (incl. B slots)", () => {
    const slice = emptySlice();
    slice.peps = [
      { type: "Pepperoni", batchLbs: 18 }, // default type — lbs field hidden
      { type: "Turkey Pep", batchLbs: 22 },
      { type: "Cheese Sticks", batchLbs: 12 },
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([
      { name: "Turkey Pep", lbs: 22 },
      { name: "Cheese Sticks", lbs: 12 },
    ]);
  });

  it("learns ready-made sauce barrels but never recipe-backed sauces", () => {
    const readyMade = emptySlice();
    readyMade.sauce = { recipeName: "BBQ", barrelLbs: 55, recipe: [] };
    expect(collectBatchWeightCandidates(readyMade, new Map())).toEqual([
      { name: "BBQ", lbs: 55 },
    ]);

    const recipeBacked = emptySlice();
    recipeBacked.sauce = {
      recipeName: "House Red",
      barrelLbs: 55,
      recipe: [{ lbs: 30 }, { lbs: 25 }],
    };
    expect(collectBatchWeightCandidates(recipeBacked, new Map())).toEqual([]);
  });

  it("dedupes the same ingredient across slots (last write wins)", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Bacon", batchLbs: 30, cheeseRecipe: [] },
      { type: "bacon ", batchLbs: 32, cheeseRecipe: [] },
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([
      { name: "bacon", lbs: 32 },
    ]);
  });
});

describe("buildBatchWeightPropagationPlan", () => {
  const entries = [
    { name: "Bacon", lbs: 30 },
    { name: "Ham", lbs: 20 },
    { name: "Turkey Pep", lbs: 12 },
    { name: "Chicken Pep", lbs: 18 },
    { name: "BBQ", lbs: 55 },
  ];

  it("updates only visible matching slots across all applicator types", () => {
    const plan = buildBatchWeightPropagationPlan(
      [
        {
          brand: "Alpha",
          flavor: "Supreme",
          profile: {
            app1Type: "Bacon",
            app1BatchLbs: 0, // zero is filled
            app2Type: "Veggie Mix",
            app2BatchLbs: 8, // mix field is hidden
            app3Type: "Cheese",
            app3BatchLbs: 10,
            app3CheeseRecipe: [{ lbs: 10 }], // recipe field is hidden
            app4Type: "Ham",
            app4BatchLbs: 10, // existing weight is replaced
            pep1Type: "Pepperoni",
            pep1BatchLbs: 7, // default pep field is hidden
            pep1TypeB: "Turkey Pep",
            pep1BatchLbsB: 0,
            pep1Combined: false,
            pep2Type: "Cup & Char",
            pep2BatchLbs: 6, // default pep field is hidden
            pep2TypeB: "Chicken Pep",
            pep2BatchLbsB: 9,
            frontlineRecipeName: "BBQ",
            sauceBarrelLbs: 0,
            frontlineRecipe: [],
          },
        },
        {
          brand: "Bravo",
          flavor: "Cheese",
          profile: {
            app1Type: "Bacon",
            app1BatchLbs: 30, // unchanged is never re-saved
            frontlineRecipeName: "BBQ",
            sauceBarrelLbs: 40,
            frontlineRecipe: [{ lbs: 40 }], // recipe-backed sauce is hidden
          },
        },
      ],
      {},
      entries,
      DEFAULT_PEPS,
    );

    expect(plan.profileUpdates).toEqual([
      {
        brand: "Alpha",
        flavor: "Supreme",
        updates: {
          app1BatchLbs: 30,
          app4BatchLbs: 20,
          pep1BatchLbsB: 12,
          pep2BatchLbsB: 18,
          sauceBarrelLbs: 55,
        },
      },
    ]);
  });

  it("does not plan a save when every matching weight already matches", () => {
    const plan = buildBatchWeightPropagationPlan(
      [
        {
          brand: "Alpha",
          flavor: "Plain",
          profile: {
            app1Type: " BACON ",
            app1BatchLbs: 30,
            pep1TypeB: "Turkey Pep",
            pep1BatchLbsB: 12,
            frontlineRecipeName: "BBQ",
            sauceBarrelLbs: 55,
            frontlineRecipe: [],
          },
        },
      ],
      {},
      entries,
      DEFAULT_PEPS,
    );

    expect(plan.profileUpdates).toEqual([]);
  });

  it("updates the open form only for matching visible slots", () => {
    const plan = buildBatchWeightPropagationPlan(
      [],
      {
        app1Type: "Bacon",
        app1BatchLbs: 0,
        app2Type: "Not in the saved entries",
        app2BatchLbs: 4,
        app3Type: "Pizza Mix",
        app3BatchLbs: 2,
        app4Type: "Cheese",
        app4BatchLbs: 3,
        app4CheeseRecipe: [{ lbs: 3 }],
        pep1Type: "Pepperoni",
        pep1BatchLbs: 4,
        pep1TypeB: "Turkey Pep",
        pep1BatchLbsB: 12, // already current
        pep1Combined: false,
        pep2Type: "Cup & Char",
        pep2BatchLbs: 6,
        pep2TypeB: "Chicken Pep",
        pep2BatchLbsB: 0,
        frontlineRecipeName: "BBQ",
        sauceBarrelLbs: 0,
        frontlineRecipe: [],
      },
      entries,
      DEFAULT_PEPS,
    );

    expect(plan.openFormUpdates).toEqual({
      app1BatchLbs: 30,
      pep2BatchLbsB: 18,
      sauceBarrelLbs: 55,
    });
  });

  it("persists eligible profile updates, fans them to pending runs, and notifies from actual saves", async () => {
    const savedProfile = {
      app1Type: "Bacon",
      app1BatchLbs: 0,
      app2Type: "Veggie Mix",
      app2BatchLbs: 8,
      app3Type: "Cheese",
      app3BatchLbs: 10,
      app3CheeseRecipe: [{ lbs: 10 }],
      app4Type: "Ham",
      app4BatchLbs: 10,
      pep1Type: "Pepperoni",
      pep1BatchLbs: 7,
      pep1TypeB: "Turkey Pep",
      pep1BatchLbsB: 0,
      pep1Combined: false,
      pep2Type: "Cup & Char",
      pep2BatchLbs: 6,
      pep2TypeB: "Chicken Pep",
      pep2BatchLbsB: 9,
      frontlineRecipeName: "BBQ",
      sauceBarrelLbs: 0,
      frontlineRecipe: [],
    };
    const unchangedProfile = {
      app1Type: "Bacon",
      app1BatchLbs: 30,
      frontlineRecipeName: "BBQ",
      sauceBarrelLbs: 40,
      frontlineRecipe: [{ lbs: 40 }],
    };
    const formValues = {
      app1Type: "Bacon",
      app1BatchLbs: 0,
      app2Type: "Not in the saved entries",
      app2BatchLbs: 4,
      pep1Combined: false,
      pep2TypeB: "Chicken Pep",
      pep2BatchLbsB: 0,
      frontlineRecipeName: "BBQ",
      sauceBarrelLbs: 0,
      frontlineRecipe: [],
    };
    const persisted = new Map([
      ["Alpha__Supreme", { ...savedProfile }],
      ["Bravo__Cheese", { ...unchangedProfile }],
    ]);
    const pendingRunPropagations: string[] = [];
    const formWrites: Record<string, number> = {};
    const notifications: unknown[] = [];

    const result = await executeBatchWeightPropagation({
      profiles: [
        { brand: "Alpha", flavor: "Supreme", profile: savedProfile },
        { brand: "Bravo", flavor: "Cheese", profile: unchangedProfile },
      ],
      openForm: formValues,
      entries,
      defaultPepTypes: DEFAULT_PEPS,
      saveProfile: (brand, flavor, updates) => {
        Object.assign(persisted.get(`${brand}__${flavor}`)!, updates);
        return true;
      },
      propagateToPendingRuns: (brand, flavor) => {
        pendingRunPropagations.push(`${brand}__${flavor}`);
      },
      setOpenFormValue: (field, lbs) => {
        formWrites[field] = lbs;
      },
      notify: (toast) => notifications.push(toast),
    });

    expect(result.savedProfileCount).toBe(1);
    expect(persisted.get("Alpha__Supreme")).toMatchObject({
      app1BatchLbs: 30,
      app4BatchLbs: 20,
      pep1BatchLbsB: 12,
      pep2BatchLbsB: 18,
      sauceBarrelLbs: 55,
      app2BatchLbs: 8,
      app3BatchLbs: 10,
      pep1BatchLbs: 7,
      pep2BatchLbs: 6,
    });
    expect(persisted.get("Bravo__Cheese")).toEqual(unchangedProfile);
    expect(pendingRunPropagations).toEqual(["Alpha__Supreme"]);
    expect(formWrites).toEqual({
      app1BatchLbs: 30,
      pep2BatchLbsB: 18,
      sauceBarrelLbs: 55,
    });
    expect(notifications).toEqual([{
      title: "Batch weight saved",
      description: "1 profile updated",
    }]);
  });

  it("never saves or propagates hidden Pep 2 weights on a combined Pep 1 profile", async () => {
    const profile = {
      app1Type: "Bacon",
      app1BatchLbs: 0,
      pep1Combined: true,
      pep2Type: "Chicken Pep",
      pep2BatchLbs: 4,
      pep2TypeB: "Chicken Pep",
      pep2BatchLbsB: 5,
    };
    const persisted = { ...profile };
    const formWrites: Record<string, number> = {};
    const pendingRunPropagations: string[] = [];

    const result = await executeBatchWeightPropagation({
      profiles: [{ brand: "Alpha", flavor: "Combined", profile }],
      openForm: { ...profile },
      entries,
      defaultPepTypes: DEFAULT_PEPS,
      saveProfile: (_brand, _flavor, updates) => {
        Object.assign(persisted, updates);
        return true;
      },
      propagateToPendingRuns: (brand, flavor) => {
        pendingRunPropagations.push(`${brand}__${flavor}`);
      },
      setOpenFormValue: (field, lbs) => {
        formWrites[field] = lbs;
      },
      notify: () => {},
    });

    expect(result.plan.profileUpdates).toEqual([{
      brand: "Alpha",
      flavor: "Combined",
      updates: { app1BatchLbs: 30 },
    }]);
    expect(persisted).toMatchObject({
      app1BatchLbs: 30,
      pep2BatchLbs: 4,
      pep2BatchLbsB: 5,
    });
    expect(formWrites).toEqual({ app1BatchLbs: 30 });
    expect(pendingRunPropagations).toEqual(["Alpha__Combined"]);
  });
});

describe("batchWeightPropagationToast", () => {
  it("reports exactly the number of successfully saved profiles", () => {
    expect(batchWeightPropagationToast(0)).toBeNull();
    expect(batchWeightPropagationToast(1)).toEqual({
      title: "Batch weight saved",
      description: "1 profile updated",
    });
    expect(batchWeightPropagationToast(2)).toEqual({
      title: "Batch weight saved",
      description: "2 profiles updated",
    });
  });
});
