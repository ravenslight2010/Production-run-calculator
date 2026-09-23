import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";
import type { NamedRecipe } from "@workspace/named-recipes";
import CheeseRecipesManager from "../CheeseRecipesManager";
import MixesManager from "../MixesManager";
import NamedRecipesManager from "../NamedRecipesManager";

const namedItems: NamedRecipe[] = [];
const cheeseItems: CheeseRecipe[] = [];
const mixItems: Mix[] = [];

vi.mock("../../hooks/useNamedRecipes", () => ({
  useNamedRecipes: () => ({ items: namedItems, isLoading: false }),
}));
vi.mock("../../hooks/useCheeseRecipes", () => ({
  useCheeseRecipes: () => ({ items: cheeseItems, isLoading: false }),
}));
vi.mock("../../hooks/useMixes", () => ({
  useMixes: () => ({ items: mixItems, isLoading: false }),
}));
vi.mock("../../namedRecipes", () => ({
  saveNamedRecipes: vi.fn(async (next: NamedRecipe[]) => next),
  deleteNamedRecipes: vi.fn(async () => []),
}));
vi.mock("../../cheeseRecipes", () => ({
  saveCheeseRecipes: vi.fn(async (next: CheeseRecipe[]) => next),
  deleteCheeseRecipes: vi.fn(async () => []),
}));
vi.mock("../../mixes", () => ({
  saveMixes: vi.fn(async (next: Mix[]) => next),
  deleteMixes: vi.fn(async () => []),
}));
vi.mock("../../specImportAliases", () => ({
  maybeLearnPoolRename: vi.fn(),
  maybeLearnBrandRename: vi.fn(),
  maybeLearnRowBrandChange: vi.fn(),
}));

afterEach(() => {
  cleanup();
  namedItems.length = 0;
  cheeseItems.length = 0;
  mixItems.length = 0;
});

function renderWithQueryClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function namedRecipe(overrides: Partial<NamedRecipe> = {}): NamedRecipe {
  return {
    id: "dough-valid",
    name: "Valid Dough",
    notes: "",
    components: [],
    enabled: true,
    brand: "",
    flavors: [],
    ...overrides,
  };
}

function cheeseRecipe(overrides: Partial<CheeseRecipe> = {}): CheeseRecipe {
  return {
    id: "cheese-valid",
    name: "Valid Cheese",
    brand: "Northside",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
    ...overrides,
  };
}

function mix(overrides: Partial<Mix> = {}): Mix {
  return {
    id: "mix-valid",
    name: "Valid Mix",
    brand: "Northside",
    flavor: "Cheese",
    batchSize: 10,
    daysEarly: 0,
    notes: "",
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
    ...overrides,
  };
}

describe("recipe managers with incomplete persisted names", () => {
  it("keeps valid dough and sauce rows usable", () => {
    namedItems.push(
      namedRecipe({ id: "blank", name: "   " }),
      namedRecipe({ id: "non-string", name: null as unknown as string }),
      namedRecipe(),
    );

    renderWithQueryClient(<NamedRecipesManager kind="dough" />);

    expect(screen.getByText("Valid Dough")).toBeTruthy();
    expect(screen.queryByText("Unnamed recipe")).toBeNull();

    fireEvent.click(screen.getByText("Valid Dough"));

    expect(
      (screen.getByPlaceholderText("Recipe name…") as HTMLInputElement).value,
    ).toBe("Valid Dough");
    expect(screen.getByTitle("Delete recipe")).toBeTruthy();
  });

  it("keeps valid cheese rows usable", () => {
    cheeseItems.push(
      cheeseRecipe({ id: "blank", name: "" }),
      cheeseRecipe({ id: "non-string", name: undefined as unknown as string }),
      cheeseRecipe(),
    );

    renderWithQueryClient(<CheeseRecipesManager />);

    expect(screen.getByText("Valid Cheese")).toBeTruthy();
    expect(screen.queryByText("Unnamed recipe")).toBeNull();

    fireEvent.click(screen.getByText("Valid Cheese"));

    expect(
      (screen.getByPlaceholderText("Cheese recipe name…") as HTMLInputElement)
        .value,
    ).toBe("Valid Cheese");
    expect(screen.getByTitle("Delete cheese recipe")).toBeTruthy();
  });

  it("keeps valid mix rows usable", () => {
    mixItems.push(
      mix({ id: "blank", name: " " }),
      mix({ id: "non-string", name: 42 as unknown as string }),
      mix(),
    );

    renderWithQueryClient(<MixesManager />);

    expect(screen.getByText("Valid Mix")).toBeTruthy();
    expect(screen.queryByText("Unnamed mix")).toBeNull();

    fireEvent.click(screen.getByText("Valid Mix"));

    expect(
      (screen.getByPlaceholderText("Mix name…") as HTMLInputElement).value,
    ).toBe("Valid Mix");
    expect(screen.getByTitle("Delete mix")).toBeTruthy();
  });
});