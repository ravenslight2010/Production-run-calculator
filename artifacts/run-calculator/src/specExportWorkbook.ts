import * as XLSX from "xlsx";
import type { SheetGrid } from "@workspace/spec-export";

/** Build a styled workbook without performing browser/file IO. */
export function buildExportWorkbook(grids: ReadonlyArray<SheetGrid>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const g of grids) {
    const ws = XLSX.utils.aoa_to_sheet(g.rows);
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const bold = new Set(g.boldRows ?? []);
    const accent = new Set(g.accentRows ?? []);
    const headers = new Set(g.headerRows ?? []);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        const isAccent = accent.has(r);
        const isHeader = headers.has(r);
        cell.s = {
          font: {
            bold: bold.has(r) || isAccent || isHeader,
            color: isAccent ? { rgb: "FFFFFF" } : { rgb: "1F2937" },
          },
          fill: isAccent
            ? { patternType: "solid", fgColor: { rgb: "E87524" } }
            : isHeader
              ? { patternType: "solid", fgColor: { rgb: "E5E7EB" } }
              : undefined,
          alignment: {
            vertical: "top",
            wrapText: g.wrapText ?? false,
          },
          border: isHeader
            ? { bottom: { style: "thin", color: { rgb: "9CA3AF" } } }
            : undefined,
        };
      }
    }
    if (g.columnWidths?.length) {
      ws["!cols"] = g.columnWidths.map((wch) => ({ wch }));
    }
    if (g.freezeRows && g.freezeRows > 0) {
      (ws as XLSX.WorkSheet & { "!freeze"?: { xSplit: number; ySplit: number; topLeftCell: string } })["!freeze"] = {
        xSplit: 0,
        ySplit: g.freezeRows,
        topLeftCell: `A${g.freezeRows + 1}`,
      };
    }
    if (g.autoFilter) {
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: g.autoFilter.startRow, c: range.s.c },
          e: { r: g.autoFilter.endRow, c: range.e.c },
        }),
      };
    }
    for (const rule of g.numberFormats ?? []) {
      for (const c of rule.columns) {
        for (let r = range.s.r; r <= range.e.r; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.v !== "") cell.z = rule.format;
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, g.name);
  }
  return wb;
}

/** Build a styled workbook and trigger its browser download. */
export function downloadWorkbook(grids: ReadonlyArray<SheetGrid>, filename: string): void {
  XLSX.writeFile(buildExportWorkbook(grids), filename);
}