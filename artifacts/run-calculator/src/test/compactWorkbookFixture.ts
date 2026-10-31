import * as XLSX from "xlsx";

/**
 * Test-only copy with ranges bounded by actual values/formulas, not formatting.
 * Source bytes remain unchanged; production imports must still reject oversized
 * ranges. No populated cell is removed or moved.
 */
export function compactWorkbookFixture(data: ArrayBuffer): ArrayBuffer {
  const workbook = XLSX.read(data, { type: "array" });
  for (const sheet of Object.values(workbook.Sheets)) {
    let bounds: XLSX.Range | undefined;
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address] as XLSX.CellObject;
      if (cell.v == null && !cell.f) continue;
      const position = XLSX.utils.decode_cell(address);
      if (!bounds) {
        bounds = { s: { ...position }, e: { ...position } };
      } else {
        bounds.s.r = Math.min(bounds.s.r, position.r);
        bounds.s.c = Math.min(bounds.s.c, position.c);
        bounds.e.r = Math.max(bounds.e.r, position.r);
        bounds.e.c = Math.max(bounds.e.c, position.c);
      }
    }
    if (bounds) sheet["!ref"] = XLSX.utils.encode_range(bounds);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
