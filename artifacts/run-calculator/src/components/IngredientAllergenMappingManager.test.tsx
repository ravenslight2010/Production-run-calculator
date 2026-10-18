// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Ingredient } from "@workspace/ingredient-catalog";
import {
  MASTER_DATA_QUERY_KEY,
  type MasterDataBootstrap,
} from "../masterData";
import IngredientAllergenMappingManager from "./IngredientAllergenMappingManager";

const allergenApi = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useUpdateIngredientAllergenMapping: () => ({
    mutateAsync: allergenApi.mutateAsync,
    reset: allergenApi.reset,
    isPending: false,
    isError: false,
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  allergenApi.mutateAsync.mockReset();
  allergenApi.reset.mockReset();
});

describe("IngredientAllergenMappingManager", () => {
  it("saves a reviewed mapping and refreshes the cached ingredient", async () => {
    const ingredient: Ingredient = {
      id: "flour",
      name: "Flour",
      categories: ["dough"],
      mergedInto: null,
      enabled: true,
      allergens: [],
      allergensReviewed: false,
    };
    const savedIngredient: Ingredient = {
      ...ingredient,
      allergens: ["wheat"],
      allergensReviewed: true,
    };
    allergenApi.mutateAsync.mockResolvedValue(savedIngredient);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      MASTER_DATA_QUERY_KEY,
      { ingredients: [ingredient] } as unknown as MasterDataBootstrap,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <IngredientAllergenMappingManager />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("allergen-review-queue-toggle"));
    fireEvent.click(screen.getByTestId("allergen-mapping-select-flour"));
    fireEvent.click(screen.getByTestId("allergen-checkbox-wheat"));
    fireEvent.click(screen.getByTestId("allergen-reviewed-checkbox"));
    fireEvent.click(screen.getByTestId("save-allergen-mapping"));

    await waitFor(() => {
      expect(allergenApi.mutateAsync).toHaveBeenCalledWith({
        id: "flour",
        data: { allergens: ["wheat"], reviewed: true },
      });
    });
    expect(await screen.findByText(/Saved: Reviewed — Wheat/)).toBeTruthy();
    expect(screen.getByTestId("allergen-review-queue-count").textContent).toBe("0");
    expect(screen.queryByTestId("allergen-mapping-select-flour")).toBeNull();
    expect(queryClient.getQueryData<MasterDataBootstrap>(MASTER_DATA_QUERY_KEY)?.ingredients[0])
      .toMatchObject({ allergens: ["wheat"], allergensReviewed: true });
  });

  it("filters unknown and uncertain mappings while keeping reviewed-empty mappings out", () => {
    const ingredients: Ingredient[] = [
      {
        id: "flour",
        name: "Flour",
        categories: ["dough"],
        mergedInto: null,
        enabled: true,
        allergens: [],
        allergensReviewed: false,
      },
      {
        id: "water",
        name: "Water",
        categories: ["general"],
        mergedInto: null,
        enabled: true,
        allergens: [],
        allergensReviewed: true,
      },
      {
        id: "uncertain",
        name: "Uncertain additive",
        categories: ["general"],
        mergedInto: null,
        enabled: true,
        allergens: ["unknown-value"] as Ingredient["allergens"],
        allergensReviewed: true,
      },
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      MASTER_DATA_QUERY_KEY,
      { ingredients } as unknown as MasterDataBootstrap,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <IngredientAllergenMappingManager />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("allergen-review-queue-count").textContent).toBe("2");
    fireEvent.click(screen.getByTestId("allergen-review-queue-toggle"));

    expect(screen.getByTestId("allergen-mapping-select-flour")).toBeTruthy();
    expect(screen.getByTestId("allergen-mapping-select-uncertain")).toBeTruthy();
    expect(screen.queryByTestId("allergen-mapping-select-water")).toBeNull();
    fireEvent.click(screen.getByTestId("allergen-mapping-select-flour"));
    expect(screen.getByTestId("allergen-mapping-editor")).toBeTruthy();
    expect(screen.getByText(/remains unknown until its mapping is explicitly reviewed/i)).toBeTruthy();
  });

  it("caps the visible review queue and keeps search available within the capped results", () => {
    const ingredients: Ingredient[] = Array.from({ length: 52 }, (_, index) => ({
      id: `ingredient-${index}`,
      name: `Ingredient ${String(index).padStart(2, "0")}`,
      categories: ["general"],
      mergedInto: null,
      enabled: true,
      allergens: [],
      allergensReviewed: false,
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      MASTER_DATA_QUERY_KEY,
      { ingredients } as unknown as MasterDataBootstrap,
    );
    render(
      <QueryClientProvider client={queryClient}>
        <IngredientAllergenMappingManager />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("allergen-review-queue-toggle"));
    expect(screen.getByTestId("allergen-review-queue-count").textContent).toBe("50+");
    expect(screen.getByTestId("allergen-review-queue-count").getAttribute("aria-label")).toBe(
      "52 ingredients need allergen review",
    );
    expect(screen.getAllByTestId(/^allergen-mapping-select-/)).toHaveLength(50);

    fireEvent.change(screen.getByTestId("allergen-ingredient-search"), {
      target: { value: "Ingredient 51" },
    });
    expect(screen.getAllByTestId(/^allergen-mapping-select-/)).toHaveLength(1);
    expect(screen.getByTestId("allergen-mapping-select-ingredient-51")).toBeTruthy();
  });
});
