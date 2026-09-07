import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { SheetGrid } from "@workspace/spec-export";
import { buildExportWorkbook } from "./specExportWorkbook";

describe("buildExportWorkbook", () => {
  it("applies hybrid formatting without changing real xlsx cell values", () => {
    const grid: SheetGrid = {
      name: "Acme",
      rows: [
        ["Brand", "Flavor", "Sauce oz/pizza"],
        ["Acme", "Pepperoni", "3.5"],
      ],
      boldRows: [0],
      accentRows: [0],
      headerRows: [0],
      columnWidths: [24, 24, 16],
      wrapText: true,
      freezeRows: 1,
      autoFilter: { startRow: 0, endRow: 1 },
      numberFormats: [{ columns: [2], format: "0.###" }],
    };
    const workbook = buildExportWorkbook([grid]);
    const sheet = workbook.Sheets.Acme!;
    expect(sheet.A1.s?.fill?.fgColor?.rgb).toBe("E87524");
    expect(sheet.A1.s?.font?.bold).toBe(true);
    expect(sheet.A1.s?.alignment?.wrapText).toBe(true);
    expect(sheet["!cols"]?.map((column) => column.wch)).toEqual([24, 24, 16]);
    expect(sheet["!autofilter"]?.ref).toBe("A1:C2");
    expect((sheet as XLSX.WorkSheet & { "!freeze"?: { ySplit: number } })["!freeze"]?.ySplit).toBe(1);

    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
    const recovered = XLSX.read(bytes, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(recovered.Sheets.Acme!, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    expect(rows).toEqual(grid.rows);
  });
});