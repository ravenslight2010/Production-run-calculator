import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import CheeseRecipesManager from "../CheeseRecipesManager";

// Focus: the Share % column and per-flavor preview must follow the manager's
// batch lbs when the imported per-pizza oz data no longer covers every row —
// the reported Aldo's Cheese Mix bug where an added Cellulose row showed 0%
// and 0 oz because stale imported oz values kept driving the shares.

const items: CheeseRecipe[] = [];
vi.mock("../../hooks/useCheeseRecipes", () => ({
  useCheeseRecipes: () => ({ items, isLoading: false }),
}));
vi.mock("../../cheeseRecipes", () => ({
  saveCheeseRecipes: async (next: CheeseRecipe[]) => next,
  deleteCheeseRecipes: async () => [],
}));

afterEach(() => {
  cleanup();
  items.length = 0;
});

function aldos(): CheeseRecipe {
  return {
    id: "cheese:spec:aldo-s-cheese-mix",
    name: "Aldo's Cheese Mix",
    brand: "Aldo's",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    enabled: true,
    components: [
      // Imported rows carry (stale) per-pizza oz; the manager-added Cellulose
      // row is lbs-only. Parm/Oregano oz are the ~10x-off poison values.
      { ingredient: "Pizella", lbs: 207, ozPerPizza: 2.07 },
      { ingredient: "Part Skim Mozzarella", lbs: 119, ozPerPizza: 1.19 },
      { ingredient: "Parmesan", lbs: 0.2, ozPerPizza: 0.2 },
      { ingredient: "Oregano", lbs: 0.1, ozPerPizza: 0.1 },
      { ingredient: "Cellulose", lbs: 1.6 },
    ],
  };
}

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheeseRecipesManager />
    </QueryClientProvider>,
  );
}

function expandRecipe() {
  fireEvent.click(screen.getByText("Aldo's Cheese Mix"));
}

// The Share % inputs are the number inputs capped at 100.
function shareValues(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="number"][max="100"]'),
  ).map((el) => Number(el.value));
}

describe("CheeseRecipesManager blend shares with partial oz data", () => {
  it("derives Share % from lbs (not stale partial oz), Cellulose no longer zeroed", () => {
    items.push(aldos());
    const { container } = renderManager();
    expandRecipe();

    // lbs total 327.9 → Pizella ~63.1%, Mozz ~36.3%, Parm ~0.1%, Oregano ~0%,
    // Cellulose ~0.5% (rounded to 0.1 in the input). The old oz-first math
    // gave Cellulose exactly 0 and froze the others on import-time values.
    const shares = shareValues(container);
    expect(shares).toHaveLength(5);
    expect(shares[0]).toBeCloseTo(63.1, 1);
    expect(shares[1]).toBeCloseTo(36.3, 1);
    expect(shares[4]).toBeGreaterThan(0); // Cellulose no longer zeroed
  });

  it("updates Share % immediately when a row's lbs are edited (edits win over stale oz)", () => {
    items.push(aldos());
    const { container } = renderManager();
    expandRecipe();

    // Bump Cellulose (row 5) from 1.6 → 30 lbs via its lbs input (the
    // text/decimal input right after the ingredient name input).
    const lbsInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    );
    expect(lbsInputs).toHaveLength(5);
    fireEvent.change(lbsInputs[4], { target: { value: "30" } });

    const shares = shareValues(container);
    // New total 356.3 → Cellulose 30/356.3 ≈ 8.4%.
    expect(shares[4]).toBeCloseTo(8.4, 1);
    expect(shares[0]).toBeCloseTo(58.1, 1);
  });

  it("adding a new lbs-only ingredient after import shifts shares to the lbs basis", () => {
    // Start from the pre-bug state: fully-covered oz rows (consistent), then
    // the manager adds a row — shares must recompute over lbs, not zero it.
    items.push({
      ...aldos(),
      components: [
        { ingredient: "Pizella", lbs: 60, ozPerPizza: 2 },
        { ingredient: "Mozzarella", lbs: 30, ozPerPizza: 1 },
      ],
    });
    const { container } = renderManager();
    expandRecipe();

    fireEvent.click(screen.getByText("Add ingredient"));
    const ingredientInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[list^="cheese-ingredients-"]'),
    );
    fireEvent.change(ingredientInputs[2], { target: { value: "Cellulose" } });
    const lbsInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    );
    fireEvent.change(lbsInputs[2], { target: { value: "10" } });

    const shares = shareValues(container);
    expect(shares).toEqual([60, 30, 10]);
  });
});

