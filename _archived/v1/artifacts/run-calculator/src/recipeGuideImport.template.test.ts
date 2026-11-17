import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildImportTemplate } from "./importTemplates";
import { buildExportWorkbook } from "./specExportWorkbook";
import { prepareSauceGuideImport, prepareDoughGuideImport } from "./recipeGuideImport";

beforeEach(() => { localStorage.clear(); });
const bytes = (format: "sauce" | "dough") => XLSX.write(
  buildExportWorkbook(buildImportTemplate(format)), { type: "array", bookType: "xlsx" },
) as ArrayBuffer;

describe("guide template preparation uses the existing review pipeline", () => {
  it("prepares the sauce workbook with no Apply or persistence", async () => {
    const before = { ...localStorage };
    const prepared = await prepareSauceGuideImport(bytes("sauce"), ["Example Sauce"], "IMPORT-TEMPLATE-SAUCE.XLSX");
    expect(prepared.candidates).toHaveLength(1);
    expect(prepared.candidates[0]).toMatchObject({ ozPerPizza: 3.5 });
    expect({ ...localStorage }).toEqual(before);
  });
  it("prepares the native dough workbook without changing profiles", async () => {
    const before = { ...localStorage };
    const prepared = await prepareDoughGuideImport(bytes("dough"), ["Example Dough"], "import-template-dough.xlsx");
    expect(prepared.candidates).toHaveLength(1);
    expect({ ...localStorage }).toEqual(before);
  });
  it("does not silently interpret broken Word input as a workbook", async () => {
    await expect(prepareSauceGuideImport(bytes("sauce"), [], "broken.docx")).rejects.toThrow("word/document.xml not found");
    await expect(prepareSauceGuideImport(new ArrayBuffer(0), [], "empty.xlsx")).rejects.toThrow("empty");
    const empty = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([["not a sauce mapping"]]), "Unknown");
    await expect(prepareSauceGuideImport(XLSX.write(empty, { type: "array" }), [], "unknown.xlsx")).rejects.toThrow("No sauce guide entries");
  });
});
