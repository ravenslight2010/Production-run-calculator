import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import CheeseRecipesManager, { CheeseRecipeEditor } from "../CheeseRecipesManager";

// Focus: the Share % column and per-flavor preview must follow the manager's
// batch lbs when the imported per-pizza oz data no longer covers every row —
// the reported Aldo's Cheese Mix bug where an added Cellulose row showed 0%
// and 0 oz because stale imported oz values kept driving the shares.

const items: CheeseRecipe[] = [];
vi.mock("../../hooks/useCheeseRecipes", () => ({
  useCheeseRecipes: () => ({ items, isLoading: false }),
}));
vi.mock("../../cheeseRecipes", () => ({
  saveCheeseRecipes: vi.fn(async (next: CheeseRecipe[]) => next),
  deleteCheeseRecipes: vi.fn(async () => []),
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

function lbsInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[aria-label="lbs per batch"]'),
  );
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

    // Bump Cellulose (row 5) from 1.6 → 30 lbs via its lbs input.
    const inputs = lbsInputs(container);
    expect(inputs).toHaveLength(5);
    fireEvent.change(inputs[4], { target: { value: "30" } });

    const shares = shareValues(container);
    // New total 356.3 → Cellulose 30/356.3 ≈ 8.4%.
    expect(shares[4]).toBeCloseTo(8.4, 1);
    expect(shares[0]).toBeCloseTo(58.1, 1);
  });

  it("keeps an existing oz/pizza value when its row's lbs are edited", () => {
    const onChange = vi.fn();
    const recipe: CheeseRecipe = {
      ...aldos(),
      components: [
        { ingredient: "Mozzarella", lbs: 60, ozPerPizza: 3 },
        { ingredient: "Parmesan", lbs: 30, ozPerPizza: 1 },
      ],
    };
    const { container } = render(
      <CheeseRecipeEditor
        recipe={recipe}
        disabled={false}
        brands={[]}
        ingredientSuggestions={[]}
        onChange={onChange}
        onDelete={() => {}}
      />,
    );
    const lbs = container.querySelectorAll<HTMLInputElement>(
      'input[aria-label="lbs per batch"]',
    );
    fireEvent.change(lbs[0], { target: { value: "90" } });
    fireEvent.blur(lbs[0]);
    const saved = onChange.mock.calls.at(-1)?.[0] as CheeseRecipe;
    expect(saved.components[0].lbs).toBe(90);
    expect(saved.components[0].ozPerPizza).toBe(3);
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
    const inputs = lbsInputs(container);
    fireEvent.change(inputs[2], { target: { value: "10" } });

    const shares = shareValues(container);
    expect(shares).toEqual([60, 30, 10]);
  });

  // oz/pizza is not shown in the cheese recipe editor — it is an applicator
  // property (the same recipe can be applied at different weights by different
  // applicators, giving each a different per-ingredient oz). Share % is what
  // drives the per-ingredient split; applicator oz/pizza lives on the run form.
});
