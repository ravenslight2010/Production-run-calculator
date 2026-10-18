import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ExcelImportDialog from "../ExcelImportDialog";
import ShippingImportDialog from "../ShippingImportDialog";
import { DoughGuideImportDialog } from "../RecipeGuideImportDialog";
import CheeseImportDialog from "../CheeseImportDialog";
import PremixImportDialog from "../PremixImportDialog";
import type { CheeseImportPrepared } from "@/cheeseImport";
import type { PremixImportPrepared } from "@/premixImport";
import type { WorkbookCellReference } from "@workspace/spec-import";

vi.mock("@/importAliases", () => ({
  fetchImportAliases: vi.fn(async () => []),
  saveImportAliases: vi.fn(async () => {}),
}));
vi.mock("@/matchImport", () => ({
  requestMatchImport: vi.fn(async () => ({ matches: [] })),
}));
vi.mock("@/aiCorrections", () => ({
  notifyCorrectionWriteFailure: vi.fn(),
  saveAiCorrections: vi.fn(async () => {}),
}));

afterEach(() => cleanup());

const source = (sheet: string, cell: string, file = "review.xlsx"): WorkbookCellReference => ({
  file,
  sheet,
  cell,
});

describe("workbook import review citations", () => {
  it("shows run-planner field cells in the parsed-row review", async () => {
    render(
      <ExcelImportDialog
        open
        onClose={() => {}}
        result={{
          rows: [{
            rowNumber: 2,
            brand: "Acme",
            flavor: "Classic",
            casesPlanned: 12,
            notes: "",
            source: {
              file: "runs.xlsx",
              sheet: "Week 1",
              cells: { brand: "C2", flavor: "D2", casesPlanned: "E2" },
            },
          }],
          errors: [],
        }}
        brands={["Acme"]}
        brandFlavors={{ Acme: ["Classic"] }}
        canCreate={false}
        defaultDate="2026-10-08"
        onConfirm={() => {}}
      />,
    );
    expect(await screen.findByText(/runs\.xlsx · Week 1!C2/)).toBeTruthy();
    expect(screen.getByText(/runs\.xlsx · Week 1!E2/)).toBeTruthy();
  });

  it("shows shipping source cells and flags a remapped brand as unverified", async () => {
    render(
      <ShippingImportDialog
        open
        onClose={() => {}}
        loading={false}
        error={null}
        applying={false}
        onConfirm={() => {}}
        prepared={{
          candidates: [{
            id: "ship-0",
            brand: "Acme",
            guideName: "Acme Foods",
            patch: { shipper: "12in" },
            patchSources: { shipper: source("Shipping", "B2") },
            sourceCell: source("Shipping", "A2"),
            unmapped: [],
          }],
          brands: ["Acme"],
          flavorsByBrand: {},
        } as never}
      />,
    );
    expect(await screen.findByText(/review\.xlsx · Shipping!B2/)).toBeTruthy();
    const citations = screen.getAllByTestId("workbook-source-citation");
    expect(citations.some((node) => node.getAttribute("data-unverified") === "true")).toBe(true);
  });

  it("shows the dough-guide assignment cell and marks a non-literal recipe match", async () => {
    render(
      <DoughGuideImportDialog
        open
        onClose={() => {}}
        loading={false}
        error={null}
        applying={false}
        onConfirm={() => {}}
        prepared={{
          candidates: [{
            id: "dough-0",
            guideBrandName: "Acme",
            brand: "Acme",
            guideName: "Thin Dough",
            matchedDoughRecipeName: "CRB Thin",
            flavors: null,
            sourceCell: source("Dough", "A2"),
          }],
          brands: ["Acme"],
          flavorsByBrand: {},
          doughRecipeNames: ["CRB Thin"],
        }}
      />,
    );
    const citation = await screen.findByTestId("workbook-source-citation");
    expect(citation.textContent).toContain("Dough!A2");
    expect(citation.getAttribute("data-unverified")).toBe("true");
  });

  it("shows cheese recipe field citations and flags a heuristic link", async () => {
    const recipe = {
      id: "cheese:acme:blend",
      name: "Acme Blend",
      brand: "Acme",
      flavors: ["Classic"],
      components: [{ ingredient: "Mozzarella", lbs: 20 }],
      cellulose: "",
      shredderSetting: "2",
      notes: "",
      enabled: true,
    };
    const prepared = {
      candidates: [{
        recipe,
        status: "new",
        linkTo: { ...recipe, id: "saved:blend", name: "Existing Blend" },
        linkedByAlias: false,
      }],
      summary: { total: 1, created: 1, updated: 0 },
      sourceByRecipeId: {
        [recipe.id]: {
          recipeName: source("Acme", "A5", "cheese.xlsx"),
          recipeNameText: "Acme Blend",
          sheetBrand: "Acme",
          shredderSetting: source("Acme", "A2", "cheese.xlsx"),
          assignmentCells: [source("Acme", "A3", "cheese.xlsx")],
          components: [{
            ingredientName: "Mozzarella",
            lbsValue: 20,
            ingredient: source("Acme", "A7", "cheese.xlsx"),
            lbs: source("Acme", "B7", "cheese.xlsx"),
          }],
        },
      },
      existingPool: [],
      prepItems: [],
      absentRecipes: [],
      newAliases: [],
    } as unknown as CheeseImportPrepared;
    render(
      <CheeseImportDialog
        open
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        onConfirm={() => {}}
      />,
    );
    expect(await screen.findByText(/cheese\.xlsx · Acme!A5/)).toBeTruthy();
    expect(screen.getAllByTestId("workbook-source-citation").some(
      (node) => node.getAttribute("data-unverified") === "true",
    )).toBe(true);
  });

  it("shows premix field citations and labels unresolved product matching unverified", async () => {
    const mix = {
      id: "mix:acme",
      name: "Acme Mix",
      brand: "Acme",
      flavor: "Classic",
      batchSize: 25,
      daysEarly: 0,
      components: [{ ingredient: "Onion", perPizza: 0.5, perBatchLbs: 25 }],
    };
    const prepared = {
      mixes: [mix],
      candidates: [{ mix, status: "new" }],
      summary: { total: 1, created: 1, updated: 0 },
      newAliases: [],
      brands: ["Acme"],
      flavorsByBrand: { Acme: ["Classic"] },
      existingIds: [],
      existingMixes: [],
      redirectSuggestions: {},
      freezerPulls: {},
      prepItems: [],
      sourceByMixId: {
        [mix.id]: {
          name: source("Acme", "A1", "premix.xlsx"),
          batchSize: source("Acme", "C6", "premix.xlsx"),
          productMatchVerified: false,
          resolvedBrand: "Acme",
          resolvedFlavor: "Classic",
          components: [{
            ingredientName: "Onion",
            perPizzaValue: 0.5,
            perBatchValue: 25,
            ingredient: source("Acme", "A3", "premix.xlsx"),
            perPizza: source("Acme", "B3", "premix.xlsx"),
            perBatch: source("Acme", "C3", "premix.xlsx"),
          }],
        },
      },
    } as unknown as PremixImportPrepared;
    render(
      <PremixImportDialog
        open
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        onConfirm={() => {}}
      />,
    );
    expect(await screen.findByText(/premix\.xlsx · Acme!C6/)).toBeTruthy();
    expect(screen.getAllByTestId("workbook-source-citation").some(
      (node) => node.getAttribute("data-unverified") === "true",
    )).toBe(true);
  });
});
