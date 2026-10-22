import type { ImportSnapshot } from "./importChanges";

// Only business fields already written by the local guide/schedule paths.
// Never retain workbook bytes, cell values/citations, formula text, or full profiles.
const FIELDS = new Set(["key", "brand", "flavor", "date", "notes", "casesPlanned",
  "frontlineRecipeName", "sauceOzPerPizza", "doughRecipeName", "isCartoned",
  "shipper", "circles", "skidStacking", "gripSheets", "pizzasPerCase", "casesPerSkid"]);
export function validateImportAppliedValues(value: unknown): ImportSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > 100_000) return null;
  const snapshot = value as ImportSnapshot;
  const keys = Object.keys(snapshot);
  if (!keys.length || keys.some((key) => !["profiles", "runs"].includes(key))) return null;
  let count = 0;
  for (const rows of Object.values(snapshot)) {
    if (!Array.isArray(rows)) return null;
    count += rows.length;
    if (count > 500) return null;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.key !== "string" || !row.key) return null;
      if (Object.entries(row).some(([key, field]) => !FIELDS.has(key) ||
        !(typeof field === "boolean" || typeof field === "number" && Number.isFinite(field) ||
          typeof field === "string" && field.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(field)))) return null;
    }
  }
  return snapshot;
}
