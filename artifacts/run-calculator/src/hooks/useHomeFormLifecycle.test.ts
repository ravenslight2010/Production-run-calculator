import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES } from "../types";
import { prepareHomeFormWrite, shouldAutosaveHomeForm } from "./useHomeFormLifecycle";

describe("Home form lifecycle fences", () => {
  it("rejects watch emissions until the form is settled for the selected run", () => {
    const changed = { ...DEFAULT_VALUES, casesNeeded: 20 };
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-b", false)).toBe(false);
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-a", true)).toBe(false);
  });

  it("accepts only a nonblank, changed value for its settled run", () => {
    const changed = { ...DEFAULT_VALUES, casesNeeded: 20 };
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-a", false)).toBe(true);
    expect(shouldAutosaveHomeForm(changed, changed, "run-a", "run-a", false)).toBe(false);
    expect(shouldAutosaveHomeForm(changed, DEFAULT_VALUES, "run-a", "run-a", false)).toBe(false);
  });

  it("never autosaves a changed form on a read-only station display", () => {
    const changed = { ...DEFAULT_VALUES, casesNeeded: 20 };
    expect(shouldAutosaveHomeForm(DEFAULT_VALUES, changed, "run-a", "run-a", false, true)).toBe(false);
  });

  it("does not invent an edit when registered optional controls are undefined", () => {
    const watched = { ...DEFAULT_VALUES, app1BatchesMade: undefined, skidsCompleted: undefined };
    const persisted = JSON.parse(JSON.stringify(watched));
    expect(shouldAutosaveHomeForm(persisted, watched, "run-a", "run-a", false)).toBe(false);
  });

  it("compares optional recipe properties using the actual persistence representation", () => {
    const watched = {
      ...DEFAULT_VALUES,
      doughRecipe: [{ ingredient: "Fixture Flour", lbs: 25, ozPerPizza: undefined }],
    };
    const persisted = JSON.parse(JSON.stringify(watched));
    expect(shouldAutosaveHomeForm(persisted, watched, "run-a", "run-a", false)).toBe(false);
  });

  it("still persists a real clearing of a previously populated optional control", () => {
    const stored = { ...DEFAULT_VALUES, casesNeeded: 20, app1BatchesMade: 5 };
    const cleared = { ...DEFAULT_VALUES, casesNeeded: 20, app1BatchesMade: undefined };
    expect(shouldAutosaveHomeForm(stored, cleared, "run-a", "run-a", false)).toBe(true);
  });
});

describe("catalog backfill versus shared recipe edits", () => {
  const fields = [
    "doughRecipe", "frontlineRecipe",
    "app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe",
  ] as const;

  it.each(fields)("does not treat %s ID backfill as a shared recipe edit", (field) => {
    const baseline = {
      ...DEFAULT_VALUES,
      [field]: [{ ingredient: "Synthetic ingredient", lbs: 10 }],
    };
    const submitted = {
      ...baseline,
      [field]: [{ ingredient: "Synthetic ingredient", lbs: 10, ingredientId: "catalog-id" }],
    };
    const write = prepareHomeFormWrite(baseline, submitted, baseline);
    expect(write.catalogBackfillOnly).toBe(true);
    expect(write.values[field]).toEqual(submitted[field]);
    expect(baseline[field][0]).not.toHaveProperty("ingredientId");

    const newer = {
      ...baseline,
      skidsCompleted: 2,
      [field]: [{ ingredient: "Synthetic ingredient", lbs: 20 }],
    };
    const delayed = prepareHomeFormWrite(baseline, submitted, newer);
    expect(delayed.catalogBackfillOnly).toBe(true);
    expect(delayed.values).toEqual(newer);
  });

  it("preserves newer counters while enriching an otherwise unchanged recipe", () => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = {
      ...baseline,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "catalog-id" }],
    };
    const newer = { ...baseline, casesOnCurrentSkid: 7 };
    const write = prepareHomeFormWrite(baseline, submitted, newer);
    expect(write.catalogBackfillOnly).toBe(true);
    expect(write.values.casesOnCurrentSkid).toBe(7);
    expect(write.values.app1CheeseRecipe[0].ingredientId).toBe("catalog-id");
  });

  it.each([
    { ingredient: "Cheese", lbs: 20, ingredientId: "catalog-id" },
    { ingredient: "Different ingredient", lbs: 10, ingredientId: "catalog-id" },
  ])("keeps a real recipe change on the ordinary write path: %j", (row) => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = { ...baseline, app1CheeseRecipe: [row] };
    expect(prepareHomeFormWrite(baseline, submitted, baseline)).toEqual({
      values: submitted,
      catalogBackfillOnly: false,
    });
  });

  it("does not hide replacement of an existing ingredient identity", () => {
    const baseline = {
      ...DEFAULT_VALUES,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "old-id" }],
    };
    const submitted = {
      ...baseline,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "new-id" }],
    };
    expect(prepareHomeFormWrite(baseline, submitted, baseline).catalogBackfillOnly).toBe(false);
  });

  it("does not replace an identity another client has already assigned", () => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = {
      ...baseline,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "stale-id" }],
    };
    const newer = {
      ...baseline,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "canonical-id" }],
    };
    expect(prepareHomeFormWrite(baseline, submitted, newer)).toEqual({
      values: newer,
      catalogBackfillOnly: true,
    });
  });

  it("does not classify an operator counter correction plus ID backfill as metadata only", () => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = {
      ...baseline,
      casesOnCurrentSkid: 4,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "catalog-id" }],
    };
    expect(prepareHomeFormWrite(baseline, submitted, baseline).catalogBackfillOnly).toBe(false);
  });

  it("preserves a newly replaced row set rather than reinserting a stale row", () => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = {
      ...baseline,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10, ingredientId: "catalog-id" }],
    };
    const newer = { ...baseline, app1CheeseRecipe: [] };
    expect(prepareHomeFormWrite(baseline, submitted, newer).values).toEqual(newer);
  });

  it("leaves an omitted recipe array on the ordinary persistence path", () => {
    const baseline = { ...DEFAULT_VALUES, app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }] };
    const submitted = { ...baseline, app1CheeseRecipe: undefined } as unknown as typeof baseline;
    expect(prepareHomeFormWrite(baseline, submitted, baseline)).toEqual({
      values: submitted,
      catalogBackfillOnly: false,
    });
  });
});