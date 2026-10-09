import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_VALUES } from "@/types";
import { SpecImportInventoryImpact } from "./SpecImportInventoryImpact";

const inventoryApi = vi.hoisted(() => ({
  fetchInventory: vi.fn(),
  createInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  restockInventory: vi.fn(),
  adjustInventory: vi.fn(),
  consumeRun: vi.fn(),
  consumeSauceBarrel: vi.fn(),
}));

vi.mock("@/inventoryShared", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/inventoryShared")>(),
  fetchInventory: inventoryApi.fetchInventory,
  createInventoryItem: inventoryApi.createInventoryItem,
  updateInventoryItem: inventoryApi.updateInventoryItem,
  deleteInventoryItem: inventoryApi.deleteInventoryItem,
  restockInventory: inventoryApi.restockInventory,
  adjustInventory: inventoryApi.adjustInventory,
  consumeRun: inventoryApi.consumeRun,
  consumeSauceBarrel: inventoryApi.consumeSauceBarrel,
}));
vi.mock("@/storage", () => ({
  specImportRecipeDisplayKind: () => "cheese",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SpecImportInventoryImpact", () => {
  it("reads stock for the preview and never invokes an inventory mutation", async () => {
    inventoryApi.fetchInventory.mockResolvedValue([]);
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 1,
      pizzasPerCase: 10,
    };

    render(
      <SpecImportInventoryImpact
        visible
        run={{ brand: "Acme", flavor: "Supreme", values }}
        parsed={{
          profiles: [{
            brand: "Acme",
            flavor: "Supreme",
            applicators: [],
            pepperonis: [{ type: "Pepperoni", sticks: 0, ozPerPizza: 1 }],
          }],
          recipes: [],
        }}
        forceUpdateProfileKeys={new Set()}
      />,
    );

    expect(await screen.findByText("Not tracked in Inventory")).toBeTruthy();
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(1);
    for (const [name, mutation] of Object.entries(inventoryApi)) {
      if (name === "fetchInventory") continue;
      expect(mutation).not.toHaveBeenCalled();
    }
  });
});
