import { describe, it, expect } from "vitest";
import { updateRecipePoolComponents } from "./index";

// The pool shape shared by CheeseRecipe and NamedRecipe (dough/sauce): each
// carries `name` + `components: {ingredient, lbs}[]` plus other fields the
// update must preserve.
type PoolRecipe = {
  id: string;
  name: string;
  brand?: string;
  components: Array<{ ingredient: string; lbs: number }>;
};

const rec = (over: Partial<PoolRecipe> = {}): PoolRecipe => ({
  id: "r1",
  name: "Aldo's Cheese Mix",
  brand: "Aldo's",
  components: [
    { ingredient: "Mozzarella", lbs: 20 },
    { ingredient: "Cheddar", lbs: 5 },
  ],
  ...over,
});

describe("updateRecipePoolComponents", () => {
  it("replaces the matched recipe's components with the sheet rows (ci-name match)", () => {
    const { next, updated } = updateRecipePoolComponents(
      [rec()],
      [{ name: "  aldo's cheese mix ", rows: [{ ingredient: "Provolone", lbs: 12 }] }],
    );
    expect(updated).toBe(1);
    expect(next[0].components).toEqual([{ ingredient: "Provolone", lbs: 12 }]);
    // Everything else on the pool recipe is preserved.
    expect(next[0].id).toBe("r1");
    expect(next[0].brand).toBe("Aldo's");
  });

  it("leaves non-matching recipes untouched (same object identity)", () => {
    const other = rec({ id: "r2", name: "Lowe's Blend" });
    const { next, updated } = updateRecipePoolComponents(
      [rec(), other],
      [{ name: "Aldo's Cheese Mix", rows: [{ ingredient: "Provolone", lbs: 12 }] }],
    );
    expect(updated).toBe(1);
    expect(next[1]).toBe(other);
  });

  it("never wipes a recipe with an empty/blank-only rows update", () => {
    const pool = [rec()];
    const empty = updateRecipePoolComponents(pool, [{ name: "Aldo's Cheese Mix", rows: [] }]);
    expect(empty.updated).toBe(0);
    expect(empty.next[0]).toBe(pool[0]);
    const blank = updateRecipePoolComponents(pool, [
      { name: "Aldo's Cheese Mix", rows: [{ ingredient: "   ", lbs: 3 }] },
    ]);
    expect(blank.updated).toBe(0);
    expect(blank.next[0]).toBe(pool[0]);
    const zero = updateRecipePoolComponents(pool, [
      { name: "Aldo's Cheese Mix", rows: [{ ingredient: "Mozzarella", lbs: 0 }] },
    ]);
    expect(zero.updated).toBe(0);
    expect(zero.next[0]).toBe(pool[0]);
  });

  it("skips (updated=0, same object) when components already equal the rows", () => {
    const pool = [rec()];
    const { next, updated } = updateRecipePoolComponents(pool, [
      {
        name: "Aldo's Cheese Mix",
        rows: [
          { ingredient: "mozzarella", lbs: 20 },
          { ingredient: "CHEDDAR", lbs: 5 },
        ],
      },
    ]);
    expect(updated).toBe(0);
    expect(next[0]).toBe(pool[0]);
  });

  it("counts an update when only an lbs value changed", () => {
    const { updated, next } = updateRecipePoolComponents(
      [rec()],
      [
        {
          name: "Aldo's Cheese Mix",
          rows: [
            { ingredient: "Mozzarella", lbs: 22 },
            { ingredient: "Cheddar", lbs: 5 },
          ],
        },
      ],
    );
    expect(updated).toBe(1);
    expect(next[0].components[0].lbs).toBe(22);
  });

  it("filters blank-name rows out of the written components but keeps the rest", () => {
    const { next, updated } = updateRecipePoolComponents(
      [rec()],
      [
        {
          name: "Aldo's Cheese Mix",
          rows: [
            { ingredient: "Provolone", lbs: 12 },
            { ingredient: "", lbs: 4 },
          ],
        },
      ],
    );
    expect(updated).toBe(1);
    expect(next[0].components).toEqual([{ ingredient: "Provolone", lbs: 12 }]);
  });

  it("does not mutate its inputs", () => {
    const pool = [rec()];
    const copy = JSON.parse(JSON.stringify(pool));
    updateRecipePoolComponents(pool, [
      { name: "Aldo's Cheese Mix", rows: [{ ingredient: "Provolone", lbs: 12 }] },
    ]);
    expect(pool).toEqual(copy);
  });
});
