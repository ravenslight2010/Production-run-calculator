import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildBatchWeightMap,
  lookupBatchWeight,
  normalizeBatchWeightChanges,
  saveIngredientBatchWeights,
  collectBatchWeightCandidates,
  collectBatchWeightCandidatesFromProfile,
  filterStillCurrentBatchWeightEntries,
  buildBatchWeightPropagationPlan,
  batchWeightPropagationToast,
  enqueueBatchWeightPropagation,
  executeBatchWeightPropagation,
  type BatchWeightFormSlice,
} from "./ingredientBatchWeights";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    const order: string[] = [];
    expect(map.size).toBe(1);
    expect(lookupBatchWeight(map, "bacon crumble")).toBe(25);
    expect(lookupBatchWeight(map, "BACON CRUMBLE  ")).toBe(25);
    expect(lookupBatchWeight(map, "sausage")).toBeNull();
    expect(lookupBatchWeight(map, "")).toBeNull();
  });
});

describe("normalizeBatchWeightChanges", () => {
  it("dedupes case-insensitively and preserves zero as an explicit clear", () => {
    expect(normalizeBatchWeightChanges([
      { name: " Bacon ", lbs: 30 },
      { name: "bacon", lbs: 32 },
      { name: "Sauce", lbs: 0 },
      { name: "negative", lbs: -1 },
      { name: "", lbs: 4 },
    ])).toEqual([
      { name: "bacon", lbs: 32 },
      { name: "Sauce", lbs: 0 },
    ]);
  });
});

describe("filterStillCurrentBatchWeightEntries", () => {
  it("drops an acknowledged value when a newer value is queued", () => {
    const pending = new Map([
      ["bacon", { name: "Bacon", lbs: 14 }],
      ["ham", { name: "Ham", lbs: 8 }],
    ]);

    expect(filterStillCurrentBatchWeightEntries(
      [
        { name: "Bacon", lbs: 12 },
        { name: "Ham", lbs: 8 },
        { name: "Sausage", lbs: 10 },
      ],
      pending,
    )).toEqual([
      { name: "Ham", lbs: 8 },
      { name: "Sausage", lbs: 10 },
    ]);
  });
});

describe("saveIngredientBatchWeights acknowledgement", () => {
  it("accepts a canonical positive update and an acknowledged clear", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ weights: [{ name: "Bacon", lbs: 32 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveIngredientBatchWeights([
      { name: " bacon ", lbs: 32 },
      { name: "Sauce", lbs: 0 },
    ])).resolves.toEqual([{ name: "Bacon", lbs: 32 }]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      weights: [
        { name: "bacon", lbs: 32 },
        { name: "Sauce", lbs: 0 },
      ],
    });
  });

  it("rejects a malformed or stale server response instead of propagating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ weights: [{ name: "Bacon", lbs: 20 }] }),
    }));

    await expect(saveIngredientBatchWeights([{ name: "Bacon", lbs: 32 }]))
      .rejects.toThrow(/not acknowledged/i);
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

  it("matches default stick-pep types case-insensitively", () => {
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

  it("matches default stick-pep types case-insensitively", () => {
    const slice = emptySlice();
    slice.peps = [{ type: "pepperoni", batchLbs: 18 }];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([]);
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

describe("collectBatchWeightCandidatesFromProfile", () => {
  it("collects only visible positive profile weights and excludes recipes/defaults", () => {
    expect(collectBatchWeightCandidatesFromProfile(
      {
        app1Type: "Bacon",
        app1BatchLbs: 30,
        app2Type: "Veggie Mix",
        app2BatchLbs: 20,
        app3Type: "Cheese",
        app3BatchLbs: 10,
        app3CheeseRecipe: [{ lbs: 10 }],
        pep1Type: "pepperoni",
        pep1BatchLbs: 7,
        pep1TypeB: "Turkey Pep",
        pep1BatchLbsB: 12,
        frontlineRecipeName: "BBQ",
        sauceBarrelLbs: 55,
        frontlineRecipe: [],
      },
      new Map(),
      DEFAULT_PEPS,
    )).toEqual([
      { name: "Bacon", lbs: 30 },
      { name: "Turkey Pep", lbs: 12 },
      { name: "BBQ", lbs: 55 },
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
      notify: (notification) => {
        notifications.push(notification);
      },
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

    let chain = enqueueBatchWeightPropagation(
      Promise.resolve(),
      async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
      },
      (error) => errors.push(error),
    );

    const errors: unknown[] = [];

    let releaseFirst!: () => void;

    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
