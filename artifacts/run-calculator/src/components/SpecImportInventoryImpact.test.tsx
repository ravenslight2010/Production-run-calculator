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

    expect((await screen.findAllByText("Not tracked in Inventory")).length).toBeGreaterThan(0);
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(1);
    for (const [name, mutation] of Object.entries(inventoryApi)) {
      if (name === "fetchInventory") continue;
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("shows each included product and does not infer a shortage for per-case demand", async () => {
    inventoryApi.fetchInventory.mockResolvedValue([
      { key: "ingredient:Pepperoni:lbs", onHand: 0 },
    ]);

    render(
      <SpecImportInventoryImpact
        visible
        run={{
          brand: "Acme",
          flavor: "Supreme",
          values: {
            ...DEFAULT_VALUES,
            casesNeeded: 5,
            pizzasPerCase: 10,
            app1Type: "Pepperoni",
            app1OzPerPizza: 0.5,
          },
        }}
        parsed={{
          profiles: [
            {
              brand: "Acme",
              flavor: "Supreme",
              pizzasPerCase: 10,
              applicators: [{ type: "Pepperoni", ozPerPizza: 1 }],
              pepperonis: [],
            },
            {
              brand: "Acme",
              flavor: "Veggie",
              pizzasPerCase: 12,
              applicators: [{ type: "Pepperoni", ozPerPizza: 2 }],
              pepperonis: [],
            },
          ],
          recipes: [],
        }}
        forceUpdateProfileKeys={new Set()}
      />,
    );

    expect(await screen.findByText("5 planned cases")).toBeTruthy();
    expect(screen.getByText("Per case · no planned case count")).toBeTruthy();
    expect(screen.getByText("Acme — Supreme")).toBeTruthy();
    expect(screen.getByText("Acme — Veggie")).toBeTruthy();
    expect(screen.getByText(/Short by .*lbs/)).toBeTruthy();
    expect(screen.getByText(/shortage not estimated without a planned case count/)).toBeTruthy();
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(1);
    for (const [name, mutation] of Object.entries(inventoryApi)) {
      if (name === "fetchInventory") continue;
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("marks stock levels unavailable when the read-only inventory request fails", async () => {
    inventoryApi.fetchInventory.mockRejectedValue(new Error("Inventory service offline"));

    render(
      <SpecImportInventoryImpact
        visible
        run={{
          brand: "Acme",
          flavor: "Supreme",
          values: { ...DEFAULT_VALUES, casesNeeded: 2, pizzasPerCase: 10 },
        }}
        parsed={{
          profiles: [{
            brand: "Acme",
            flavor: "Supreme",
            pizzasPerCase: 10,
            applicators: [{ type: "Pepperoni", ozPerPizza: 1 }],
            pepperonis: [],
          }],
          recipes: [],
        }}
        forceUpdateProfileKeys={new Set()}
      />,
    );

    expect(await screen.findByTestId("spec-import-stock-data-unavailable")).toBeTruthy();
    expect((await screen.findAllByText("Stock level unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Short by/)).toBeNull();
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(1);
  });
});
