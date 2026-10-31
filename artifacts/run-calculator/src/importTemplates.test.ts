// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseDeterministicSpecWorkbook } from "@workspace/spec-import";
import { assertImportPreflight, assertImportFileBytes, preflightImportGrids } from "@workspace/spec-import/import-preflight";
import { parsePremixWorkbook } from "@workspace/premix-import";
import { parseCheeseWorkbook } from "@workspace/cheese-import";
import { parseShippingGuide, shippingPatchFromRow } from "@workspace/shipping-import";
import { parseDoughGuide, parseSauceGuide } from "@workspace/recipe-guide-import";
import { buildExportWorkbook } from "./specExportWorkbook";
import { parseRunWorkbook } from "./utils/runExcel";
import { buildImportTemplate, IMPORT_TEMPLATES } from "./importTemplates";

function roundTrip(format: (typeof IMPORT_TEMPLATES)[number]["format"]) {
  const bytes = XLSX.write(buildExportWorkbook(buildImportTemplate(format)), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  assertImportFileBytes(bytes.byteLength);
  const workbook = XLSX.read(bytes, { type: "array" });
  const grids = workbook.SheetNames.map((name) => ({
    name, rows: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false }),
  }));
  assertImportPreflight(grids, format);
  return { bytes, grids };
}

describe("optional import templates", () => {
  it("covers all seven contracts with bounded, editable, formula-free workbooks", () => {
    expect(IMPORT_TEMPLATES.map(({ format }) => format)).toEqual(["spec", "premix", "cheese", "shipping", "sauce", "dough", "schedule"]);
    for (const { format } of IMPORT_TEMPLATES) {
      const { grids } = roundTrip(format);
      expect(grids.length).toBeGreaterThan(0);
      expect(JSON.stringify(grids)).toContain("Example");
      expect(grids.every((grid) => grid.rows.every((row) => row.every((cell) => !String(cell).startsWith("="))))).toBe(true);
      expect(buildImportTemplate(format)).toEqual(buildImportTemplate(format));
    }
  });
  it("keeps spec sauce/applicator/pepperoni ounces and dough metadata distinct", () => {
    const result = parseDeterministicSpecWorkbook(roundTrip("spec").grids);
    expect(result).toMatchObject({ supported: true, unresolved: [] });
    expect(result.parsed.profiles).toHaveLength(1);
    expect(result.parsed.profiles[0]).toMatchObject({
      brand: "Example Customer", flavor: "Example Pizza", sauceOzPerPizza: 3.5,
      targetDoughballWeight: 10.25,
      applicators: [{ type: "Mozzarella", ozPerPizza: 4 }],
      pepperonis: [{ type: "Pepperoni", sticks: 1, ozPerPizza: 0.75 }],
    });
  });
  it("preserves independent premix oz/pizza and batch lbs", () => {
    const parsed = parsePremixWorkbook(roundTrip("premix").grids);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ batchSize: 40, components: [{ ingredient: "Green Pepper", perPizza: 1.5, perBatch: 40 }] });
  });
  it("imports cheese as batch pounds, not per-pizza ounces", () => {
    const parsed = parseCheeseWorkbook(roundTrip("cheese").grids);
    expect(parsed.recipes).toHaveLength(1);
    expect(parsed.recipes[0].components).toEqual([expect.objectContaining({ ingredient: "Mozzarella", lbs: 40 })]);
  });
  it("maps shipping counts without guessing unsupported packaging", () => {
    const parsed = parseShippingGuide(roundTrip("shipping").grids);
    expect(parsed).toHaveLength(1);
    expect(shippingPatchFromRow(parsed[0])).toEqual({
      patch: { shipper: "12in", circles: "12in", pizzasPerCase: 12, casesPerSkid: 60, gripSheets: "none", skidStacking: "column" },
      unmapped: [],
    });
  });
  it("uses native sauce and dough mapping sentences, not ingredient formulas", () => {
    const sauce = parseSauceGuide(roundTrip("sauce").grids.flatMap((grid) => grid.rows.map((row) => row.join(" "))).join("\n"));
    expect(sauce).toHaveLength(1);
    expect(sauce[0]).toMatchObject({ brand: "Example Customer", recipeName: "Example Sauce", ozPerPizza: 3.5 });
    const dough = parseDoughGuide(roundTrip("dough").grids);
    expect(dough).toHaveLength(1);
    expect(dough[0]).toMatchObject({ brand: "Example Customer", doughRecipeName: "Example Dough" });
  });
  it("round-trips ISO schedule dates and planned case counts", () => {
    const parsed = parseRunWorkbook(roundTrip("schedule").bytes);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ brand: "Example Customer", flavor: "Example Pizza", casesPlanned: 100, date: "2026-01-15" });
  });
  it("prepares two dated schedule sections on the same worksheet, validating each day", () => {
    const grids = buildImportTemplate("schedule");
    grids[0].rows.push(
      [],
      ["2026-01-16", "Brand", "Flavor", "Cases Planned"],
      ["", "Example Customer", "Example Pizza Two", "250"],
    );
    const bytes = XLSX.write(buildExportWorkbook(grids), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const prepared = parseRunWorkbook(bytes, "two-days.xlsx");
    expect(prepared.errors).toEqual([]);
    expect(prepared.rows).toEqual([
      expect.objectContaining({ date: "2026-01-15", flavor: "Example Pizza", casesPlanned: 100 }),
      expect.objectContaining({ date: "2026-01-16", flavor: "Example Pizza Two", casesPlanned: 250 }),
    ]);
    grids[0].rows[4][3] = "-250";
    const invalid = XLSX.write(buildExportWorkbook(grids), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(() => parseRunWorkbook(invalid, "two-days.xlsx")).toThrow(/row 5.*casesplanned/);
  });
  it("keeps unfamiliar customer layouts reviewable rather than template-invalid", () => {
    for (const { format } of IMPORT_TEMPLATES) {
      const grids = [{ name: "Customer layout", rows: [["Customer-specific heading"], ["Some product", "3,5 oz"]] }];
      expect(preflightImportGrids(grids, format)).toEqual([expect.objectContaining({ severity: "review" })]);
      expect(() => assertImportPreflight(grids, format)).not.toThrow();
    }
  });
  it("treats cleared example amounts as unknown and rejects malformed canonical amounts", () => {
    const grids = buildImportTemplate("premix");
    const ingredient = grids[0].rows.find((row) => row[0] === "Green Pepper")!;
    ingredient[1] = "";
    expect(preflightImportGrids(grids, "premix")).toContainEqual(expect.objectContaining({ severity: "review", column: "Per Pizza (oz)" }));
    expect(() => assertImportPreflight(grids, "premix")).not.toThrow();
    ingredient[1] = "-1.5";
    expect(() => assertImportPreflight(grids, "premix")).toThrow("perpizzaoz");
    ingredient[1] = "1,5 oz";
    expect(() => assertImportPreflight(grids, "premix")).toThrow("perpizzaoz");
  });
});
