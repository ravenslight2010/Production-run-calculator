/** Shared, deterministic preflight. Unknown layouts remain review/fallback cases. */
export type ImportFormat = "spec" | "premix" | "cheese" | "shipping" | "sauce" | "dough" | "schedule";
export type PreflightGrid = { name: string; sourceFile?: string; rows: readonly (readonly unknown[])[] };
export type ImportPreflightDiagnostic = {
  severity: "error" | "review";
  file?: string;
  sheet?: string;
  row?: number;
  column?: string;
  message: string;
};
export const IMPORT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const IMPORT_GRID_MAX_ROWS = 20_000;
export const IMPORT_GRID_MAX_COLUMNS = 300;
export const IMPORT_GRID_MAX_CELLS = 500_000;
export function assertImportFileBytes(bytes: number, file?: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${file || "File"}: the file is empty. Select a populated source file.`);
  if (bytes > IMPORT_FILE_MAX_BYTES) throw new Error(`${file || "File"}: exceeds the 25 MB import limit. Split the source into smaller files.`);
}
const key = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
export function preflightImportGrids(grids: readonly PreflightGrid[], format?: ImportFormat): ImportPreflightDiagnostic[] {
  const diagnostics: ImportPreflightDiagnostic[] = [];
  let cells = 0;
  if (!grids.length || !grids.some((sheet) => sheet.rows.some((row) => row.some((value) => String(value ?? "").trim())))) {
    return [{ severity: "error", message: "No populated worksheets were found. Select a workbook containing data." }];
  }
  if (grids.length > 100) return [{ severity: "error", message: "More than 100 worksheets. Split the workbook before importing." }];
  for (const sheet of grids) {
    const context = { file: sheet.sourceFile, sheet: sheet.name };
    if (sheet.rows.length > IMPORT_GRID_MAX_ROWS || sheet.rows.some((row) => row.length > IMPORT_GRID_MAX_COLUMNS)) {
      diagnostics.push({ ...context, severity: "error", message: "Worksheet exceeds 20,000 rows or 300 columns. Remove unused formatted ranges or split the workbook." });
      continue;
    }
    cells += sheet.rows.reduce((sum, row) => sum + row.length, 0);
    let recognized = false;
    let active: {
      headers: string[];
      row: number;
      isFormula: boolean;
      numericColumns: { header: string; index: number }[];
    } | null = null;
    // Only exact exported table signatures are canonical. Loose procedure,
    // planner and customer-specific layouts must not inherit these requirements.
    // After recognizing the first section, inspect later section headers too:
    // recipe blocks and dated schedules can repeat or reorder their columns.
    for (let r = 0; r < sheet.rows.length; r++) {
      if (!recognized && r >= 30) break;
      const headers = sheet.rows[r].map(key);
      const isSpec = (!format || format === "spec") &&
        headers.includes("dietype") && (headers.includes("saucerecipe") || headers.includes("doughrecipe"));
      const isSchedule = (!format || format === "schedule") &&
        headers.includes("casesplanned") && headers.includes("brand");
      const isShipping = (!format || format === "shipping") && headers.includes("brand") &&
        headers.includes("pizzaspercase") && headers.includes("casesperskid");
      const isDoughGuide = (!format || format === "dough") && !isSpec &&
        headers.includes("brand") && headers.includes("doughrecipe");
      const isSauceGuide = (!format || format === "sauce") && !isSpec &&
        headers.includes("brand") && headers.includes("saucerecipe") && headers.includes("sauceozperpizza");
      const isFormula = (!format || format === "premix" || format === "cheese") &&
        headers.includes("ingredient") && (headers.includes("perpizza") || headers.includes("perpizzaoz")) && headers.includes("perbatchlbs");
      if (isSpec || isSchedule || isShipping || isDoughGuide || isSauceGuide || isFormula) {
        recognized = true;
        const required = isSpec ? ["brand", "flavor"] : isSchedule ? ["brand", "flavor", "casesplanned"]
          : isFormula ? ["ingredient", headers.includes("perpizzaoz") ? "perpizzaoz" : "perpizza", "perbatchlbs"] : ["brand"];
        for (const column of required) {
          if (!headers.includes(column)) diagnostics.push({ ...context, severity: "error", row: r + 1, column, message: `Canonical ${isSpec ? "spec" : "schedule"} table is missing the ${column} column. Restore the header or use the original layout.` });
        }
        const numericColumns = headers.map((header, index) => ({ header, index })).filter(({ header }) =>
          isSchedule ? header === "casesplanned" : /^(?:sauceozpizza|sauceozperpizza|targetdoughballweightoz|doughballspertray|pizzaspercase|casesperskid|perpizza|perpizzaoz|perbatchlbs)$/.test(header));
        active = { headers, row: r, isFormula, numericColumns };
        continue;
      }
      if (!active) continue;
      const row = sheet.rows[r];
      if (!row.some((value) => String(value ?? "").trim())) continue;
      const identity = key(row[active.headers.indexOf(active.isFormula ? "ingredient" : "brand")]);
      // Formula totals/metadata end a block; wait for another recognized header.
      // Never read the next recipe's name or product link as numeric ingredients.
      if (active.isFormula && /^(?:total|subtotal|notes?|instructions?|preparedby|date|productbrand|productflavor|isprep)$/.test(identity)) {
        active = null;
        continue;
      }
      if (!identity || /^(?:total|subtotal|notes?|instructions?|preparedby|date)$/.test(identity)) continue;
      for (const { header, index } of active.numericColumns) {
        const value = String(row[index] ?? "").trim();
        // Blank/formula-without-cached-result values require review, not zero.
        if (!value) {
          if (diagnostics.length < 40) diagnostics.push({ ...context, severity: "review", row: r + 1,
            column: String(sheet.rows[active.row][index]), message: "Blank amount is unknown. Review the parsed proposal; no zero has been inferred by preflight." });
          continue;
        }
        const number = Number(value.replace(/,/g, ""));
        if (!Number.isFinite(number) || number < 0) diagnostics.push({
          ...context, severity: "error", row: r + 1, column: String(sheet.rows[active.row][index]),
          message: `${header} must contain a non-negative number, or be blank for explicit review. Correct this cell before importing.`,
        });
        if (diagnostics.length >= 40) return diagnostics;
      }
    }
    if (!recognized) diagnostics.push({ ...context, severity: "review", message: "Layout is not a recognized canonical table. Use the existing format-specific parser and review/fallback; no canonical columns have been assumed." });
  }
  if (cells > IMPORT_GRID_MAX_CELLS) diagnostics.unshift({ severity: "error", message: "Workbook exceeds 500,000 cells. Remove unused ranges or split the workbook." });
  return diagnostics;
}
export function assertImportPreflight(grids: readonly PreflightGrid[], format?: ImportFormat): ImportPreflightDiagnostic[] {
  const diagnostics = preflightImportGrids(grids, format);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) throw new Error(errors.map((error) =>
    [error.file, error.sheet, error.row ? `row ${error.row}` : "", error.column ? `column ${error.column}` : "", error.message].filter(Boolean).join(" · "),
  ).join("\n"));
  return diagnostics;
}
