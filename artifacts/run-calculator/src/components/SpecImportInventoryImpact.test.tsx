import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SpecImportInventoryImpact", () => {
  const renderPreview = (visible = true) => {
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 1,
      pizzasPerCase: 10,
    };

    return render(
      <SpecImportInventoryImpact
        visible={visible}
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
  };

  it("allows a manual stock refresh and never invokes an inventory mutation", async () => {
    inventoryApi.fetchInventory.mockResolvedValue([]);
    renderPreview();

    expect((await screen.findAllByText("Not tracked in Inventory")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("status-stock-snapshot").textContent)
      .toMatch(/^Stock snapshot last loaded /);
    fireEvent.click(screen.getByTestId("button-refresh-stock"));
    await waitFor(() => {
      expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("button-refresh-stock")).toHaveProperty("disabled", false);
    });
    for (const [name, mutation] of Object.entries(inventoryApi)) {
      if (name === "fetchInventory") continue;
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("refreshes stock every minute while visible and stops polling when closed", async () => {
    vi.useFakeTimers();
    inventoryApi.fetchInventory.mockResolvedValue([]);
    const preview = renderPreview();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(2);

    preview.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(inventoryApi.fetchInventory).toHaveBeenCalledTimes(2);
  });

  it("keeps the last successful snapshot and reports a failed refresh", async () => {
    inventoryApi.fetchInventory
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Connection timed out"));
    renderPreview();

    expect((await screen.findAllByText("Not tracked in Inventory")).length).toBeGreaterThan(0);
    const loadedAt = screen.getByTestId("status-stock-snapshot").textContent;
    fireEvent.click(screen.getByTestId("button-refresh-stock"));

    const error = await screen.findByTestId("spec-import-stock-refresh-error");
    expect(error.textContent).toContain("Stock refresh failed.");
    expect(error.textContent).toContain("Connection timed out");
    expect(screen.getByTestId("status-stock-snapshot").textContent).toBe(loadedAt);
    expect((await screen.findAllByText("Not tracked in Inventory")).length).toBeGreaterThan(0);
  });

  it("reports a stalled stock request and makes refresh available again", async () => {
    vi.useFakeTimers();
    inventoryApi.fetchInventory.mockImplementation((signal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
      }),
    );
    renderPreview();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(screen.getByTestId("spec-import-stock-data-unavailable").textContent)
      .toContain("The stock request timed out. Try refreshing again.");
    expect(screen.getByTestId("button-refresh-stock")).toHaveProperty("disabled", false);
  });

  it("shows every included product and does not infer a shortage for per-case demand", async () => {
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

  it("compares shared stock with combined demand while retaining each product's quantity", async () => {
    inventoryApi.fetchInventory.mockResolvedValue([
      { key: "packaging:cartons:cases", onHand: 75 },
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
            cartoned: "yes",
            cartonsPerCase: 1,
            cartonSize: 1,
          },
        }}
        parsed={{
          profiles: [
            {
              brand: "Acme",
              flavor: "Supreme",
              pizzasPerCase: 10,
              applicators: [],
              pepperonis: [],
            },
            {
              brand: "Acme",
              flavor: "Supreme",
              pizzasPerCase: 10,
              applicators: [],
              pepperonis: [],
            },
          ],
          recipes: [],
        }}
        forceUpdateProfileKeys={new Set()}
      />,
    );

    expect((await screen.findAllByText("50 cases"))).toHaveLength(2);
    expect(screen.getAllByText(/Combined planned demand: 100 cases across 2 planned products/))
      .toHaveLength(2);
    expect(screen.getAllByText(/Short by 25 cases · 75 cases on hand/)).toHaveLength(2);
  });

  it("marks stock unavailable when the read-only inventory request fails", async () => {
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
