// Unit coverage for the shared recipe-suggestion Apply/Undo decision logic
// (@workspace/recipe-apply). The web and mobile apps both call this single
// function with only their own platform write glue, so locking its behavior here
// locks it for BOTH platforms (replit.md parity) — the inline copies can no
// longer drift.
//
// What is asserted:
//  - validation: an unknown recipe field, a missing/invalid target run, and an
//    empty/all-blank suggestion each short-circuit WITHOUT writing.
//  - sanitize: ingredient names are trimmed, weights coerced to finite numbers,
//    and blank rows dropped before the write.
//  - apply: the validated target's recipe field is written exactly once with the
//    sanitized rows, and the message reflects scale vs. substitute.
//  - undo: replays the write with the run's PREVIOUS rows, restoring them exactly
//    (and tolerating a non-array / missing prior value).

import { describe, it, expect } from "vitest";
import {
  applyRecipeSuggestion,
  sanitizeRecipeRows,
  RECIPE_FIELD_IDS,
  type RecipeRow,
  type RecipeSuggestionLike,
} from "@workspace/recipe-apply";

// A tiny in-memory run store standing in for either platform's persisted run
// settings. `write` counts its calls so we can prove nothing is written on a
// rejected apply and exactly once on a successful one.
function makeStore(initial: Record<string, unknown>) {
  const settings: Record<string, unknown> = { ...initial };
  let writes = 0;
  const deps = {
    resolveTargetId: (id?: string) => (id === "missing" ? null : (id ?? "run-1")),
    readPrevRows: (_targetId: string, recipeId: string) => settings[recipeId],
    write: (_targetId: string, recipeId: string, rows: RecipeRow[]) => {
      writes += 1;
      settings[recipeId] = rows;
    },
  };
  return { settings, deps, writes: () => writes };
}

function scale(rows: RecipeRow[]): RecipeSuggestionLike {
  return { kind: "scale", recipeId: "doughRecipe", rows };
}

describe("applyRecipeSuggestion (shared web+mobile)", () => {
  it("exposes the same six recipe field ids", () => {
    expect(RECIPE_FIELD_IDS).toEqual([
      "doughRecipe",
      "frontlineRecipe",
      "app1CheeseRecipe",
      "app2CheeseRecipe",
      "app3CheeseRecipe",
      "app4CheeseRecipe",
    ]);
  });

  it("rejects an unknown recipe field without writing", () => {
    const { deps, writes } = makeStore({});
    const res = applyRecipeSuggestion(
      { kind: "scale", recipeId: "notARecipe", rows: [{ ingredient: "Flour", lbs: 1 }] },
      undefined,
      deps,
    );
    expect(res).toEqual({ ok: false, message: "Unknown recipe" });
    expect(writes()).toBe(0);
  });

  it("rejects when the target run no longer exists", () => {
    const { deps, writes } = makeStore({});
    const res = applyRecipeSuggestion(scale([{ ingredient: "Flour", lbs: 1 }]), "missing", deps);
    expect(res).toEqual({ ok: false, message: "Run no longer exists" });
    expect(writes()).toBe(0);
  });

  it("rejects when the suggestion has no usable rows", () => {
    const { deps, writes } = makeStore({});
    const res = applyRecipeSuggestion(
      scale([{ ingredient: "   ", lbs: 5 }]),
      undefined,
      deps,
    );
    expect(res).toEqual({ ok: false, message: "Nothing to apply" });
    expect(writes()).toBe(0);
  });

  it("applies sanitized rows once and reports a scale", () => {
    const { settings, deps, writes } = makeStore({
      doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    });
    const res = applyRecipeSuggestion(
      scale([
        { ingredient: " Flour ", lbs: 75 },
        { ingredient: "Water", lbs: "45" as unknown as number },
        { ingredient: "", lbs: 9 },
        { ingredient: "Yeast", lbs: Number.NaN },
      ]),
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.message).toBe("Recipe scaled");
    expect(writes()).toBe(1);
    expect(settings.doughRecipe).toEqual([
      { ingredient: "Flour", lbs: 75 },
      { ingredient: "Water", lbs: 45 },
      { ingredient: "Yeast", lbs: 0 },
    ]);
  });

  it("reports a substitution for a substitute suggestion", () => {
    const { deps } = makeStore({ frontlineRecipe: [] });
    const res = applyRecipeSuggestion(
      { kind: "substitute", recipeId: "frontlineRecipe", rows: [{ ingredient: "Sauce", lbs: 3 }] },
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.message).toBe("Substitution applied");
  });

  it("undo restores the exact previous rows", () => {
    const prev = [
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Water", lbs: 30 },
    ];
    const { settings, deps, writes } = makeStore({ doughRecipe: prev });
    const res = applyRecipeSuggestion(scale([{ ingredient: "Flour", lbs: 99 }]), undefined, deps);
    expect(res.ok).toBe(true);
    expect(settings.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 99 }]);

    res.undo?.();
    expect(settings.doughRecipe).toEqual(prev);
    expect(writes()).toBe(2);
  });

  it("undo restores an empty recipe when there was no prior value", () => {
    const { settings, deps } = makeStore({}); // doughRecipe absent (undefined)
    const res = applyRecipeSuggestion(scale([{ ingredient: "Flour", lbs: 10 }]), undefined, deps);
    expect(res.ok).toBe(true);
    res.undo?.();
    expect(settings.doughRecipe).toEqual([]);
  });

  it("sanitizeRecipeRows is the shared row cleaner", () => {
    expect(
      sanitizeRecipeRows([
        { ingredient: " A ", lbs: 1 },
        { ingredient: "", lbs: 2 },
        { ingredient: "B", lbs: "x" as unknown as number },
      ]),
    ).toEqual([
      { ingredient: "A", lbs: 1 },
      { ingredient: "B", lbs: 0 },
    ]);
    expect(sanitizeRecipeRows(undefined)).toEqual([]);
  });
});
