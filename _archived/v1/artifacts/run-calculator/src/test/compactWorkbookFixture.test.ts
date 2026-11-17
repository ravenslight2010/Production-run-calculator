// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { compactWorkbookFixture } from "./compactWorkbookFixture";

describe("compact workbook test fixture", () => {
  it("removes formatting-only range inflation without moving or dropping values or formulas", () => {
    const workbook = XLSX.utils.book_new();
    const sheet: XLSX.WorkSheet = {
      B3: { t: "s", v: "Recipe" },
      C4: { t: "n", v: 0 },
      D5: { t: "b", v: false },
      E6: { t: "n", f: "C4+1" },
      "!ref": "A1:XFD100",
    };
    XLSX.utils.book_append_sheet(workbook, sheet, "Fixture");
    const source: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const result = XLSX.read(compactWorkbookFixture(source), { type: "array" });
    expect(result.SheetNames).toEqual(["Fixture"]);
    expect(result.Sheets.Fixture["!ref"]).toBe("B3:E6");
    expect(result.Sheets.Fixture.B3.v).toBe("Recipe");
    expect(result.Sheets.Fixture.C4.v).toBe(0);
    expect(result.Sheets.Fixture.D5.v).toBe(false);
    expect(result.Sheets.Fixture.E6.f).toBe("C4+1");
    expect(XLSX.read(source, { type: "array" }).Sheets.Fixture["!ref"]).toBe("A1:XFD100");
  });
});
