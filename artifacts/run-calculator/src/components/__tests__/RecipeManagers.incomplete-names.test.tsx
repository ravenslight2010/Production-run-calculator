import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";
import type { NamedRecipe } from "@workspace/named-recipes";
import CheeseRecipesManager from "../CheeseRecipesManager";
import MixesManager from "../MixesManager";
import NamedRecipesManager from "../NamedRecipesManager";
import { saveCheeseRecipes } from "../../cheeseRecipes";
import { saveMixes } from "../../mixes";

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
  vi.mocked(saveCheeseRecipes).mockClear();
  vi.mocked(saveMixes).mockClear();
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
      namedRecipe({
        id: "malformed-customer",
        name: "Legacy Dough",
        brand: null as unknown as string,
        flavors: [null] as unknown as string[],
      }),
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

  it("keeps valid sauce rows usable with malformed customer metadata", () => {
    namedItems.push(
      namedRecipe({
        id: "malformed-customer",
        name: "Legacy Sauce",
        brand: { bad: true } as unknown as string,
        flavors: [null] as unknown as string[],
      }),
      namedRecipe({ id: "sauce-valid", name: "Valid Sauce" }),
    );

    renderWithQueryClient(<NamedRecipesManager kind="sauce" />);

    expect(screen.getByText("Valid Sauce")).toBeTruthy();
    fireEvent.click(screen.getByText("Valid Sauce"));
    expect(
      (screen.getByPlaceholderText("Recipe name…") as HTMLInputElement).value,
    ).toBe("Valid Sauce");
  });

  it("keeps valid cheese rows usable", () => {
    cheeseItems.push(
      cheeseRecipe({ id: "blank", name: "" }),
      cheeseRecipe({ id: "non-string", name: undefined as unknown as string }),
      cheeseRecipe({
        id: "malformed-customer",
        name: "Legacy Cheese",
        brand: null as unknown as string,
        flavors: [null] as unknown as string[],
      }),
      cheeseRecipe(),
    );

    renderWithQueryClient(<CheeseRecipesManager />);

    fireEvent.click(screen.getByRole("button", { name: /Northside/ }));
    expect(screen.getByText("Valid Cheese")).toBeTruthy();
    expect(screen.queryByText("Unnamed recipe")).toBeNull();

    fireEvent.click(screen.getByText("Valid Cheese"));

    expect(
      (screen.getByPlaceholderText("Cheese recipe name…") as HTMLInputElement)
        .value,
    ).toBe("Valid Cheese");
    expect(screen.getByTitle("Delete cheese recipe")).toBeTruthy();
  });

  it("renames only valid cheese rows while malformed rows remain visible", async () => {
    cheeseItems.push(
      cheeseRecipe({ id: "source-1", name: "Source Cheese 1" }),
      cheeseRecipe({ id: "source-2", name: "Source Cheese 2" }),
      cheeseRecipe({ id: "other", name: "Other Cheese", brand: "Other Co" }),
      cheeseRecipe({
        id: "malformed-customer",
        name: "Legacy Cheese",
        brand: null as unknown as string,
        flavors: [null] as unknown as string[],
      }),
    );

    renderWithQueryClient(<CheeseRecipesManager />);

    fireEvent.click(screen.getByRole("button", { name: /No customer/ }));
    expect(screen.getByText("Legacy Cheese")).toBeTruthy();

    const cheeseGroupHeader = screen.getByRole("button", { name: /Northside/ });
    fireEvent.click(cheeseGroupHeader);
    fireEvent.click(
      within(cheeseGroupHeader.parentElement!).getByTitle(
        "Rename or merge this customer",
      ),
    );
    fireEvent.change(screen.getByPlaceholderText("New name…"), {
      target: { value: "Southside" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(saveCheeseRecipes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "source-1", brand: "Southside" }),
          expect.objectContaining({ id: "source-2", brand: "Southside" }),
        ]),
      ),
    );
    const saved = vi.mocked(saveCheeseRecipes).mock.calls.at(-1)?.[0] ?? [];
    expect(saved.map((recipe) => recipe.id).sort()).toEqual(["source-1", "source-2"]);
    expect(screen.getByText("Legacy Cheese")).toBeTruthy();
    expect(screen.queryByPlaceholderText("New name…")).toBeNull();
  });

  it("keeps valid mix rows usable", () => {
    mixItems.push(
      mix({ id: "blank", name: " " }),
      mix({ id: "non-string", name: 42 as unknown as string }),
      mix({
        id: "malformed-customer",
        name: "Legacy Mix",
        brand: null as unknown as string,
        flavor: { bad: true } as unknown as string,
      }),
      mix(),
    );

    renderWithQueryClient(<MixesManager />);

    fireEvent.click(screen.getByRole("button", { name: /Northside/ }));
    expect(screen.getByText("Valid Mix")).toBeTruthy();
    expect(screen.queryByText("Unnamed mix")).toBeNull();

    fireEvent.click(screen.getByText("Valid Mix"));

    expect(
      (screen.getByPlaceholderText("Mix name…") as HTMLInputElement).value,
    ).toBe("Valid Mix");
    expect(screen.getByTitle("Delete mix")).toBeTruthy();
  });

  it("renames only valid mix rows while malformed rows remain visible", async () => {
    mixItems.push(
      mix({ id: "source-1", name: "Source Mix 1" }),
      mix({ id: "source-2", name: "Source Mix 2" }),
      mix({ id: "other", name: "Other Mix", brand: "Other Co" }),
      mix({
        id: "malformed-customer",
        name: "Legacy Mix",
        brand: null as unknown as string,
        flavor: { bad: true } as unknown as string,
      }),
    );

    renderWithQueryClient(<MixesManager />);

    fireEvent.click(screen.getByRole("button", { name: /No brand/ }));
    expect(screen.getByText("Legacy Mix")).toBeTruthy();

    const mixGroupHeader = screen.getByRole("button", { name: /Northside/ });
    fireEvent.click(mixGroupHeader);
    fireEvent.click(
      within(mixGroupHeader.parentElement!).getByTitle("Rename or merge this brand"),
    );
    fireEvent.change(screen.getByPlaceholderText("New name…"), {
      target: { value: "Southside" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(saveMixes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "source-1", brand: "Southside" }),
          expect.objectContaining({ id: "source-2", brand: "Southside" }),
        ]),
      ),
    );
    const saved = vi.mocked(saveMixes).mock.calls.at(-1)?.[0] ?? [];
    expect(saved.map((item) => item.id).sort()).toEqual(["source-1", "source-2"]);
    expect(screen.getByText("Legacy Mix")).toBeTruthy();
    expect(screen.queryByPlaceholderText("New name…")).toBeNull();
  });
});