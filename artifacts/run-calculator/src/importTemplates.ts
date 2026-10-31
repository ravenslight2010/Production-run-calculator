import type { SheetGrid } from "@workspace/spec-export";
import { buildSpecsExportGrids, buildMixExportGrids, buildCheeseExportGrids } from "@workspace/spec-export";
import { assertImportPreflight, type ImportFormat } from "@workspace/spec-import/import-preflight";
import { downloadWorkbook } from "./specExportWorkbook";

export { IMPORT_TEMPLATES } from "./importTemplateCatalog";

/** Fictional examples only. Never read factory data or write an import receipt. */
export function buildImportTemplate(format: ImportFormat): SheetGrid[] {
  const brand = "Example Customer";
  const flavor = "Example Pizza";
  let grids: SheetGrid[];
  switch (format) {
    case "spec":
      grids = buildSpecsExportGrids({ profiles: [{
        brand, flavor, dieType: "Argus", sauceOzPerPizza: 3.5,
        doughRecipeName: "Example Dough", sauceRecipeName: "Example Sauce",
        targetDoughballWeight: 10.25, doughballsPerTray: 20,
        applicators: [{ type: "Mozzarella", ozPerPizza: 4 }],
        pepperonis: [{ type: "Pepperoni", sticks: 1, ozPerPizza: 0.75 }],
      }], doughRecipes: [], sauceRecipes: [], cheeseRecipes: [] });
      break;
    case "premix":
      grids = buildMixExportGrids([{
        id: "example", name: "Example Topping Mix", brand, flavor,
        batchSize: 40, components: [{ ingredient: "Green Pepper", perPizza: 1.5, perBatchLbs: 40 }],
        enabled: true, daysEarly: 0, amountAlreadyMade: 0,
      }]);
      break;
    case "cheese":
      grids = buildCheeseExportGrids({
        profiles: [{ brand, flavor, applicators: [{ type: "Cheese", ozPerPizza: 4 }], pepperonis: [], cheeseRecipeNames: ["Example Cheese"] }],
        doughRecipes: [], sauceRecipes: [],
        cheeseRecipes: [{ name: "Example Cheese", rows: [{ ingredient: "Mozzarella", lbs: 40 }] }],
      });
      break;
    case "shipping":
      grids = [{ name: "Shipping", rows: [
        ["Brand", "Box", "Circle", "Pizzas Per Case", "Cases Per Skid", "Grip Sheets", "Stacking"],
        [brand, '12"', '12"', "12", "60", "N/A", "Column"],
      ], headerRows: [0] }];
      break;
    case "sauce":
      grids = [{ name: "Sauce Guide", rows: [
        ["Sauce guide — replace the example sentence"],
        [`${brand} uses Example Sauce for ${flavor} at 3.5oz`],
      ], headerRows: [0] }];
      break;
    case "dough":
      grids = [{ name: "Dough Guide", rows: [
        ["Dough guide — replace the example sentence"],
        [`${brand} (${flavor}) = Example Dough`],
      ], headerRows: [0] }];
      break;
    case "schedule":
      grids = [{ name: "Schedule", rows: [
        ["2026-01-15", "Brand", "Flavor", "Cases Planned"],
        ["", brand, flavor, "100"],
      ], headerRows: [0] }];
      break;
    default:
      throw new Error("Unsupported import template.");
  }
  assertImportPreflight(grids, format);
  return grids.map((grid) => ({ wrapText: true, columnWidths: [42, 28, 24, 24, 24, 24, 24], ...grid }));
}

export function downloadImportTemplate(format: ImportFormat): void {
  downloadWorkbook(buildImportTemplate(format), `import-template-${format}.xlsx`);
}
