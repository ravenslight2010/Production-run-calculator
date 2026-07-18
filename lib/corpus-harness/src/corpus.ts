// Corpus loader for the customer's real source workbook library
// (attached_assets/source-library). Reads each .xlsx into the same
// SheetGrid shape the app's importers consume (mirrors the web glue's
// readWorkbookGrids: header:1, defval:"", blankrows:false, cells stringified).
//
// The corpus is REAL customer data — it stays in attached_assets and is read
// in place, never copied. Only DETERMINISTIC importer layers run over it here
// (no AI calls), so the harness is safe for CI/validation.

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export type SheetGrid = { name: string; rows: string[][] };

export const CORPUS_KINDS = [
  "specs",
  "dough",
  "sauce",
  "cheese",
  "premix",
  "shipping",
  "schedule",
] as const;
export type CorpusKind = (typeof CORPUS_KINDS)[number];

/** Locate attached_assets/source-library from any package's cwd. */
export function corpusRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "attached_assets", "source-library");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("attached_assets/source-library not found from " + process.cwd());
}

/** Sorted .xlsx file names for one corpus kind. */
export function corpusFiles(kind: CorpusKind): string[] {
  const dir = path.join(corpusRoot(), kind);
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .sort();
}

/** Read one workbook into grids (same shape as the app's readWorkbookGrids). */
export function readGrids(kind: CorpusKind, file: string): SheetGrid[] {
  const buf = fs.readFileSync(path.join(corpusRoot(), kind, file));
  const wb = XLSX.read(buf);
  const grids: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    grids.push({
      name,
      rows: rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [])),
    });
  }
  return grids;
}

/** Strip the upload-timestamp suffix for stable snapshot keys. */
export function corpusFileKey(file: string): string {
  return file.replace(/_\d{10,}(?=\.xlsx$)/i, "");
}
