import * as XLSX from "xlsx";
import {
  runLabel,
  type RunState,
  type RunSettings,
} from "@/context/RunContext";

/**
 * Shared Excel (.xlsx) + QuickBooks CSV row model for production runs.
 *
 * This module is intentionally mirrored verbatim from the web app
 * (artifacts/run-calculator/src/utils/runExcel.ts) per the web/mobile parity
 * rule in replit.md. Columns, validation, fuzzy matching and the QuickBooks
 * layout MUST stay identical across both apps. Adapt only platform IO at the UI
 * layer, never the row model below.
 */

export const RUN_EXPORT_COLUMNS = [
  "Date",
  "Run",
  "Brand",
  "Flavor",
  "Status",
  "Cases Planned",
  "Cases Made",
  "Pizzas",
  "PPM",
  "Started",
  "Ended",
  "Net Duration",
  "Downtime",
  "Stoppages",
  "Dough Batches",
  "Sauce Batches",
  "Notes",
] as const;

export type RunExportRow = Record<(typeof RUN_EXPORT_COLUMNS)[number], string | number>;

// Match the web app's fmtClock / fmtTime exactly so .xlsx output is identical.
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusOf(run: RunState): string {
  return run.endedAt ? "Finished" : run.isRunning || run.startedAt ? "Running" : "Upcoming";
}

/**
 * Normalized planning inputs for the export's batch math. Each platform maps its
 * own field names onto this shape (e.g. web `targetDoughballWeight` ↔ mobile
 * `doughballWeightOz`) so the formula below produces IDENTICAL numbers on both.
 * This is the single source of truth for exported Dough/Sauce batch totals — do
 * not compute them from a platform-specific calc engine.
 */
export type ExportBatchInput = {
  casesNeeded: number;
  pizzasPerCase: number;
  casesPerLayer: number;
  doughballOz: number;
  doughBatchYield: number;
  doughRecipeLbs: number;
  sauceOzPerPizza: number;
  sauceBarrelLbs: number;
  frontlineRecipeLbs: number;
};

/** Planned-total dough & sauce batches. Identical math web + mobile. */
export function computeExportBatches(i: ExportBatchInput): { doughBatches: number; sauceBatches: number } {
  const totalPizzas = i.casesNeeded * i.pizzasPerCase;
  const totalPizzasForSauce = totalPizzas + i.casesPerLayer * i.pizzasPerCase;
  const sauceEffBarrel = i.frontlineRecipeLbs > 0 ? i.frontlineRecipeLbs : i.sauceBarrelLbs;
  const sauceLbs = (totalPizzasForSauce * i.sauceOzPerPizza) / 16 + 30;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const effYield =
    i.doughRecipeLbs > 0 && i.doughballOz > 0
      ? (i.doughRecipeLbs * 16) / i.doughballOz
      : i.doughBatchYield;
  const doughBatches = effYield > 0 ? totalPizzas / effYield : 0;
  return { doughBatches, sauceBatches };
}

function sumRecipeLbs(recipe: { lbs?: number }[] | undefined): number {
  return (recipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
}

/** Build one export row object for a single run (identical fields web + mobile). */
export function buildRunExportRow(date: string, label: string, run: RunState): RunExportRow {
  const s = run.settings;
  const totalPizzas = s.casesNeeded * s.pizzasPerCase;
  const grossDurSec = run.startedAt && run.endedAt ? (run.endedAt - run.startedAt) / 1000 : 0;
  // Mobile has no "pause" stoppage type (web-only), so every closed stoppage
  // counts as downtime — matching web's "exclude pause" intent exactly.
  const downtimeSec = (run.stoppages ?? [])
    .filter((st) => st.endedAt)
    .reduce((acc, st) => acc + (st.endedAt! - st.startedAt) / 1000, 0);
  const netDurSec = Math.max(0, grossDurSec - downtimeSec);
  const casesMade = run.actualCases ?? s.casesNeeded;
  const netPpm =
    netDurSec > 0 && casesMade > 0 && s.pizzasPerCase > 0
      ? Math.round((casesMade * s.pizzasPerCase) / (netDurSec / 60))
      : 0;
  const stopReasons = (run.stoppages ?? [])
    .map(
      (st) =>
        `${st.reason ?? st.type}(${st.endedAt ? fmtTime((st.endedAt - st.startedAt) / 1000) : "open"})`,
    )
    .join("; ");
  const { doughBatches, sauceBatches } = computeExportBatches({
    casesNeeded: s.casesNeeded,
    pizzasPerCase: s.pizzasPerCase,
    casesPerLayer: s.casesPerLayer,
    doughballOz: s.doughballWeightOz,
    doughBatchYield: s.doughBatchYield,
    doughRecipeLbs: sumRecipeLbs(s.doughRecipe),
    sauceOzPerPizza: s.sauceOzPerPizza,
    sauceBarrelLbs: s.sauceBarrelLbs,
    frontlineRecipeLbs: sumRecipeLbs(s.frontlineRecipe),
  });
  return {
    Date: date,
    Run: label,
    Brand: s.brand,
    Flavor: s.flavor,
    Status: statusOf(run),
    "Cases Planned": s.casesNeeded,
    "Cases Made": run.actualCases ?? "",
    Pizzas: totalPizzas,
    PPM: netPpm > 0 ? netPpm : "",
    Started: run.startedAt ? fmtClock(run.startedAt) : "",
    Ended: run.endedAt ? fmtClock(run.endedAt) : "",
    "Net Duration": netDurSec > 0 ? fmtTime(netDurSec) : "",
    Downtime: downtimeSec > 0 ? fmtTime(downtimeSec) : "0",
    Stoppages: stopReasons,
    "Dough Batches": Math.round(doughBatches * 100) / 100,
    "Sauce Batches": Math.round(sauceBatches * 100) / 100,
    Notes: s.notes ?? "",
  };
}

/** Build an xlsx workbook from export rows. */
export function buildRunWorkbook(rows: RunExportRow[]): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...RUN_EXPORT_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Production Runs");
  return wb;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportRow = {
  rowNumber: number; // 1-based spreadsheet row (excluding header)
  brand: string;
  flavor: string;
  casesPlanned: number;
  notes: string;
  // Present only for multi-sheet "day-block" schedule workbooks: the production
  // day (YYYY-MM-DD) this run is planned for. Absent for the flat single-day
  // import format (where the user picks one target date in the dialog).
  date?: string;
};

export type ImportParseResult = {
  rows: ImportRow[];
  errors: { rowNumber: number; message: string }[];
  // True when the file was a multi-sheet day-block schedule planner: each row
  // carries its own `date` and the UI imports across many days (no single date
  // picker). Absent/false for the flat single-sheet format.
  multiDay?: boolean;
};

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(obj)) {
    const norm = k.trim().toLowerCase();
    if (keys.some((want) => norm === want)) {
      const v = obj[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return "";
}

/**
 * Parse an already-read workbook. Auto-detects the file shape:
 *  - Multi-sheet "day-block" schedule planner → {@link parseScheduleWorkbook}
 *    (rows carry their own date; `multiDay: true`).
 *  - Otherwise the flat single-sheet format (header on row 1; one date chosen in
 *    the dialog).
 * Used by the array path (web) and the base64 path (mobile).
 */
export function parseWorkbookObject(wb: XLSX.WorkBook): ImportParseResult {
  if (workbookIsSchedule(wb)) return parseScheduleWorkbook(wb);
  const sheetName = wb.SheetNames[0];
  const rows: ImportRow[] = [];
  const errors: { rowNumber: number; message: string }[] = [];
  if (!sheetName) {
    return { rows, errors: [{ rowNumber: 0, message: "No sheets found in file." }] };
  }
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  raw.forEach((obj, i) => {
    const rowNumber = i + 2; // +1 for header row, +1 for 1-based spreadsheet rows
    const brand = pick(obj, ["brand"]);
    const flavor = pick(obj, ["flavor"]);
    const casesStr = pick(obj, ["cases planned", "cases", "casesplanned", "casesneeded", "cases needed"]);
    const notes = pick(obj, ["notes"]);
    if (!brand && !flavor && !casesStr) return; // skip blank rows silently
    if (!brand) {
      errors.push({ rowNumber, message: "Missing Brand" });
      return;
    }
    const casesPlanned = casesStr === "" ? 0 : Number(casesStr);
    if (casesStr !== "" && (!isFinite(casesPlanned) || casesPlanned < 0)) {
      errors.push({ rowNumber, message: `Invalid Cases Planned "${casesStr}"` });
      return;
    }
    rows.push({ rowNumber, brand, flavor, casesPlanned: Math.round(casesPlanned), notes });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Multi-sheet "day-block" schedule planner import
// ---------------------------------------------------------------------------
//
// The customer's real production schedule is a weekly-tabbed planner. Each sheet
// holds several per-day blocks. A block begins with a header row shaped like:
//   ["Monday - Day", <excel-date-serial>, "Brand", "Flavor", "Units",
//    "Customer", "Ship", "PO"]
// followed by run rows (Brand/Flavor/Units/Customer/Ship/PO in those columns),
// ending in a subtotal row whose Brand/Flavor are blank. We parse every sheet,
// resolve each block's date, and emit one dated ImportRow per run. Customer / PO
// / Ship are folded into the run notes so nothing is lost. Mirrored VERBATIM in
// the web copy per the replit.md parity rule.

const SCHEDULE_UNIT_HEADERS = ["units", "cases", "qty", "quantity", "cases planned"];

function cellStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Excel serial date (1900 system) → "YYYY-MM-DD" in UTC, or null if implausible. */
function excelSerialToISO(serial: number): string | null {
  if (!isFinite(serial) || serial < 20000 || serial > 90000) return null; // ~1954–2146
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Coerce a spreadsheet cell into an ISO date string (YYYY-MM-DD) when it looks
 * like a date: an Excel serial number, a JS Date, or a recognizable date string
 * (ISO or M/D/Y). Returns null otherwise.
 */
function coerceCellDate(cell: unknown): string | null {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return excelSerialToISO(cell);
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return null;
    return `${cell.getUTCFullYear()}-${pad2(cell.getUTCMonth() + 1)}-${pad2(cell.getUTCDate())}`;
  }
  const s = String(cell).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`;
  }
  return null;
}

/** Index of the first cell in `row` whose trimmed/lowercased text is in `wants`. */
function findHeaderCol(row: unknown[], wants: string[]): number {
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (typeof v === "string" && wants.includes(v.trim().toLowerCase())) return i;
  }
  return -1;
}

/** A row is a day-block header when it labels Brand, Flavor and a units column. */
function isDayBlockHeader(row: unknown[]): boolean {
  return (
    findHeaderCol(row, ["brand"]) >= 0 &&
    findHeaderCol(row, ["flavor"]) >= 0 &&
    findHeaderCol(row, SCHEDULE_UNIT_HEADERS) >= 0
  );
}

/** Cheap detector: true if ANY sheet contains a dated day-block header. */
export function workbookIsSchedule(wb: XLSX.WorkBook): boolean {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    for (const row of aoa) {
      if (!Array.isArray(row) || !isDayBlockHeader(row)) continue;
      if (row.some((c) => coerceCellDate(c) != null)) return true;
    }
  }
  return false;
}

function buildScheduleNotes(
  row: unknown[],
  customerCol: number,
  shipCol: number,
  poCol: number,
): string {
  const parts: string[] = [];
  const customer = customerCol >= 0 ? cellStr(row[customerCol]) : "";
  const po = poCol >= 0 ? cellStr(row[poCol]) : "";
  const shipRaw = shipCol >= 0 ? row[shipCol] : "";
  const ship = coerceCellDate(shipRaw) ?? cellStr(shipRaw);
  if (customer) parts.push(customer);
  if (po) parts.push(`PO ${po}`);
  if (ship) parts.push(`Ship ${ship}`);
  return parts.join(" • ");
}

/**
 * Parse a multi-sheet day-block schedule planner into dated import rows. Every
 * run row gets the date of the block it sits under; rows with no resolvable date
 * or no brand are reported as errors. Always returns `multiDay: true`.
 */
export function parseScheduleWorkbook(wb: XLSX.WorkBook): ImportParseResult {
  const rows: ImportRow[] = [];
  const errors: { rowNumber: number; message: string }[] = [];
  let rowCounter = 0; // synthetic 1-based counter across all sheets (UI/merge display)
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    let i = 0;
    while (i < aoa.length) {
      const header = aoa[i];
      if (!Array.isArray(header) || !isDayBlockHeader(header)) {
        i++;
        continue;
      }
      const brandCol = findHeaderCol(header, ["brand"]);
      const flavorCol = findHeaderCol(header, ["flavor"]);
      const unitsCol = findHeaderCol(header, SCHEDULE_UNIT_HEADERS);
      const customerCol = findHeaderCol(header, ["customer"]);
      const shipCol = findHeaderCol(header, ["ship", "ship date", "shipdate"]);
      const poCol = findHeaderCol(header, ["po", "po #", "po#", "po number"]);
      let date: string | null = null;
      for (const c of header) {
        const d = coerceCellDate(c);
        if (d) {
          date = d;
          break;
        }
      }
      // Walk the run rows under this header until the next header or sheet end.
      let j = i + 1;
      for (; j < aoa.length; j++) {
        const r = aoa[j];
        if (!Array.isArray(r)) continue;
        if (isDayBlockHeader(r)) break;
        const brand = cellStr(r[brandCol]);
        const flavor = cellStr(r[flavorCol]);
        const unitsStr = cellStr(r[unitsCol]);
        if (!brand && !flavor) continue; // subtotal / spacer / blank row
        rowCounter++;
        if (!date) {
          errors.push({ rowNumber: rowCounter, message: `"${brand || flavor}" has no day date` });
          continue;
        }
        if (!brand) {
          errors.push({ rowNumber: rowCounter, message: "Missing Brand" });
          continue;
        }
        const casesPlanned = unitsStr === "" ? 0 : Number(unitsStr.replace(/[, ]/g, ""));
        if (unitsStr !== "" && (!isFinite(casesPlanned) || casesPlanned < 0)) {
          errors.push({ rowNumber: rowCounter, message: `Invalid Units "${unitsStr}"` });
          continue;
        }
        rows.push({
          rowNumber: rowCounter,
          date,
          brand,
          flavor,
          casesPlanned: Math.round(casesPlanned),
          notes: buildScheduleNotes(r, customerCol, shipCol, poCol),
        });
      }
      i = j; // resume at the next header (or end)
    }
  }
  return { rows, errors, multiDay: true };
}

/**
 * Drop dated rows that fall before `fromISO` (kept inclusive of `fromISO`).
 * Used to honor the "import only today-or-later runs" choice for multi-day
 * schedule files. Non-dated rows (flat format) and non-multiDay results pass
 * through unchanged. Pure — mirrored VERBATIM web + mobile.
 */
export function filterImportFromDate(result: ImportParseResult, fromISO: string): ImportParseResult {
  if (!result.multiDay) return result;
  return {
    ...result,
    rows: result.rows.filter((r) => !r.date || r.date >= fromISO),
  };
}

/** Parse a base64-encoded xlsx (used on native via expo-file-system). */
export function parseRunWorkbookBase64(base64: string): ImportParseResult {
  const wb = XLSX.read(base64, { type: "base64" });
  return parseWorkbookObject(wb);
}

// ---------------------------------------------------------------------------
// Fuzzy matching (Levenshtein) for brand/flavor mapping
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const prev = new Array<number>(bl + 1);
  const cur = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = cur[j];
  }
  return prev[bl];
}

export type FuzzyMatch = { value: string; score: number; exact: boolean };

/**
 * Match a candidate name against a list of known options.
 * Returns case-insensitive exact match first, otherwise fuzzy suggestions
 * sorted best-first (closest edit distance), filtered to reasonable similarity.
 */
export function fuzzyMatch(candidate: string, options: string[]): FuzzyMatch[] {
  const c = candidate.trim().toLowerCase();
  if (!c) return [];
  const exact = options.find((o) => o.trim().toLowerCase() === c);
  if (exact) return [{ value: exact, score: 0, exact: true }];
  const scored = options
    .map((o) => {
      const dist = levenshtein(c, o.trim().toLowerCase());
      const maxLen = Math.max(c.length, o.length, 1);
      return { value: o, score: dist, ratio: dist / maxLen, exact: false };
    })
    .filter((m) => m.ratio <= 0.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ value, score, exact }) => ({ value, score, exact }));
  return scored;
}

/** Case-insensitive exact lookup; returns the canonical option or null. */
export function exactMatch(candidate: string, options: string[]): string | null {
  const c = candidate.trim().toLowerCase();
  if (!c) return null;
  return options.find((o) => o.trim().toLowerCase() === c) ?? null;
}

// ---------------------------------------------------------------------------
// Same brand+flavor merge
// ---------------------------------------------------------------------------

export type ImportCommitRun = {
  brand: string;
  flavor: string;
  casesPlanned: number;
  notes: string;
};

/**
 * Combine resolved import runs that share the same brand AND flavor
 * (case-insensitive, trimmed) into a single run: cases are summed and distinct
 * notes are joined with "; ". Output order follows first appearance.
 *
 * This runs AFTER brand/flavor names are resolved to their canonical saved
 * values, so e.g. two "Cheese" rows for the same brand on the same day become
 * one run with the combined case count. Mirrored verbatim web + mobile per the
 * replit.md parity rule.
 */
export function mergeImportRuns(runs: ImportCommitRun[]): ImportCommitRun[] {
  const order: string[] = [];
  const map = new Map<
    string,
    { brand: string; flavor: string; casesPlanned: number; notes: string[] }
  >();
  for (const r of runs) {
    const key = `${r.brand.trim().toLowerCase()}|||${r.flavor.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.casesPlanned += r.casesPlanned;
      const note = r.notes.trim();
      if (note && !existing.notes.includes(note)) existing.notes.push(note);
    } else {
      order.push(key);
      const note = r.notes.trim();
      map.set(key, {
        brand: r.brand,
        flavor: r.flavor,
        casesPlanned: r.casesPlanned,
        notes: note ? [note] : [],
      });
    }
  }
  return order.map((k) => {
    const v = map.get(k)!;
    return {
      brand: v.brand,
      flavor: v.flavor,
      casesPlanned: v.casesPlanned,
      notes: v.notes.join("; "),
    };
  });
}

// ---------------------------------------------------------------------------
// QuickBooks CSV
// ---------------------------------------------------------------------------

export const QUICKBOOKS_COLUMNS = [
  "*InvoiceNo",
  "*Customer",
  "*InvoiceDate",
  "*DueDate",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "*ItemAmount",
] as const;

function csvEscape(v: string | number): string {
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build a QuickBooks-importable CSV of run totals as zero-amount reference
 * records (no live Intuit sync). One line per run; quantity = pizzas produced,
 * rate and amount are 0 so these never affect books.
 */
export function buildQuickBooksCsv(
  date: string,
  runs: { label: string; settings: RunSettings; actualCases?: number }[],
): string {
  const lines: string[] = [QUICKBOOKS_COLUMNS.map(csvEscape).join(",")];
  runs.forEach((r, i) => {
    const cases = r.actualCases ?? r.settings.casesNeeded;
    const pizzas = cases * r.settings.pizzasPerCase;
    const item = [r.settings.brand, r.settings.flavor].filter(Boolean).join(" ") || r.label;
    const row: (string | number)[] = [
      `RUN-${date}-${i + 1}`,
      "Production",
      date,
      date,
      item,
      `Production run: ${r.label} (${cases} cases / ${pizzas} pizzas)`,
      pizzas,
      0,
      0,
    ];
    lines.push(row.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

// ── Learned import aliases ───────────────────────────────────────────────────
// When the user confirms a non-exact match of an imported brand/flavor name to a
// saved one, we persist that mapping so FUTURE imports auto-apply it. This pure
// helper walks the resolved import choices and returns the alias pairs worth
// saving: only real saved matches (NOT Create/Skip) where the imported name
// differs from the saved name (case-insensitively). brandContext is the canonical
// parent brand for flavor aliases, null for brand aliases. Mirrored verbatim
// across web and mobile (replit.md parity); unit-tested in runExcel.test.ts.
export type ImportAliasPair = {
  type: "brand" | "flavor";
  externalName: string;
  canonicalName: string;
  brandContext: string | null;
};

export function collectImportAliases(
  rows: { brand: string; flavor: string }[],
  brandChoice: Record<string, string>,
  flavorChoice: Record<string, string>,
  opts: { skip: string; create: string },
): ImportAliasPair[] {
  const { skip, create } = opts;
  const byKey = new Map<string, ImportAliasPair>();
  const keyOf = (type: string, ext: string, ctx: string) =>
    `${type}|||${ext.toLowerCase()}|||${ctx.toLowerCase()}`;
  for (const r of rows) {
    const brand = (r.brand ?? "").trim();
    if (!brand) continue;
    const bc = brandChoice[brand.toLowerCase()] ?? skip;
    if (bc === skip) continue;
    let canonicalBrand: string;
    if (bc === create) {
      canonicalBrand = brand;
    } else {
      canonicalBrand = bc;
      if (brand.toLowerCase() !== bc.toLowerCase()) {
        byKey.set(keyOf("brand", brand, ""), {
          type: "brand",
          externalName: brand,
          canonicalName: bc,
          brandContext: null,
        });
      }
    }
    const flavor = (r.flavor ?? "").trim();
    if (!flavor) continue;
    const fKey = `${canonicalBrand.toLowerCase()}|||${flavor.toLowerCase()}`;
    const fc = flavorChoice[fKey] ?? skip;
    if (fc === skip || fc === create) continue;
    if (flavor.toLowerCase() !== fc.toLowerCase()) {
      byKey.set(keyOf("flavor", flavor, canonicalBrand), {
        type: "flavor",
        externalName: flavor,
        canonicalName: fc,
        brandContext: canonicalBrand,
      });
    }
  }
  return [...byKey.values()];
}

export { runLabel };
