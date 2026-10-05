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
    expect(queryClient.getQueryData<MasterDataBootstrap>(MASTER_DATA_QUERY_KEY)?.ingredients[0])
      .toMatchObject({ allergens: ["wheat"], allergensReviewed: true });
  });
});
