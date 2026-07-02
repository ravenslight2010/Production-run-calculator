// @vitest-environment node
//
// Unit tests for mergeImportRuns — combines same brand+flavor import runs on the
// same day into one run (cases summed, distinct notes joined). Mirrored verbatim
// web <-> mobile (replit.md parity), so testing the web copy guards both.

import { describe, it, expect } from "vitest";
import {
  mergeImportRuns,
  collectImportAliases,
  type ImportCommitRun,
} from "@/utils/runExcel";

const run = (
  brand: string,
  flavor: string,
  casesPlanned: number,
  notes = "",
): ImportCommitRun => ({ brand, flavor, casesPlanned, notes });

const SKIP = "";
const CREATE = "__create__";
const opts = { skip: SKIP, create: CREATE };
const aliasRow = (brand: string, flavor = "") => ({ brand, flavor });

describe("mergeImportRuns", () => {
  it("combines two runs of the same brand+flavor, summing cases", () => {
    const out = mergeImportRuns([run("Acme", "Cheese", 10), run("Acme", "Cheese", 5)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ brand: "Acme", flavor: "Cheese", casesPlanned: 15 });
  });

  it("matches brand/flavor case-insensitively and trimmed", () => {
    const out = mergeImportRuns([run("Acme", "Cheese", 3), run("  acme ", " CHEESE ", 7)]);
    expect(out).toHaveLength(1);
    expect(out[0].casesPlanned).toBe(10);
    // Keeps the first-seen canonical brand/flavor casing.
    expect(out[0].brand).toBe("Acme");
    expect(out[0].flavor).toBe("Cheese");
  });

  it("joins distinct notes with '; ' and dedups identical notes", () => {
    const out = mergeImportRuns([
      run("Acme", "Cheese", 1, "morning"),
      run("Acme", "Cheese", 1, "rush"),
      run("Acme", "Cheese", 1, "morning"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].notes).toBe("morning; rush");
  });

  it("keeps different brand or flavor as separate runs, preserving first-seen order", () => {
    const out = mergeImportRuns([
      run("Beta", "Pepperoni", 2),
      run("Acme", "Cheese", 4),
      run("Beta", "Pepperoni", 3),
      run("Acme", "Veggie", 1),
    ]);
    expect(out.map((r) => `${r.brand}/${r.flavor}=${r.casesPlanned}`)).toEqual([
      "Beta/Pepperoni=5",
      "Acme/Cheese=4",
      "Acme/Veggie=1",
    ]);
  });

  it("treats empty flavor as its own merge key", () => {
    const out = mergeImportRuns([run("Acme", "", 2), run("Acme", "", 3)]);
    expect(out).toHaveLength(1);
    expect(out[0].casesPlanned).toBe(5);
  });

  it("ignores blank notes when joining", () => {
    const out = mergeImportRuns([run("Acme", "Cheese", 1, ""), run("Acme", "Cheese", 1, "note")]);
    expect(out[0].notes).toBe("note");
  });
});

describe("collectImportAliases", () => {
  it("records a brand alias when imported name resolves to a different saved name", () => {
    const out = collectImportAliases(
      [aliasRow("Acme Foods")],
      { "acme foods": "Acme" },
      {},
      opts,
    );
    expect(out).toEqual([
      { type: "brand", externalName: "Acme Foods", canonicalName: "Acme", brandContext: null },
    ]);
  });

  it("records a flavor alias keyed by its canonical parent brand", () => {
    const out = collectImportAliases(
      [aliasRow("Acme", "Pep")],
      { acme: "Acme" },
      { "acme|||pep": "Pepperoni" },
      opts,
    );
    expect(out).toEqual([
      { type: "flavor", externalName: "Pep", canonicalName: "Pepperoni", brandContext: "Acme" },
    ]);
  });

  it("uses the resolved canonical brand as the flavor key even when the brand was itself aliased", () => {
    const out = collectImportAliases(
      [aliasRow("Acme Foods", "Pep")],
      { "acme foods": "Acme" },
      { "acme|||pep": "Pepperoni" },
      opts,
    );
    expect(out).toContainEqual({
      type: "flavor",
      externalName: "Pep",
      canonicalName: "Pepperoni",
      brandContext: "Acme",
    });
    expect(out).toContainEqual({
      type: "brand",
      externalName: "Acme Foods",
      canonicalName: "Acme",
      brandContext: null,
    });
  });

  it("does NOT record an alias when the imported name already equals the saved name (case-insensitively)", () => {
    const out = collectImportAliases(
      [aliasRow("acme", "cheese")],
      { acme: "Acme" },
      { "acme|||cheese": "Cheese" },
      opts,
    );
    expect(out).toEqual([]);
  });

  it("skips SKIP and CREATE choices for both brand and flavor", () => {
    const out = collectImportAliases(
      [aliasRow("New Brand", "New Flavor"), aliasRow("Other", "Spicy")],
      { "new brand": CREATE, other: SKIP },
      { "other|||spicy": "Spicy Sausage" },
      opts,
    );
    // New Brand is CREATE → no brand alias; its CREATE flavor is also skipped.
    // Other is SKIP → never resolves a brand, so its flavor is never considered.
    expect(out).toEqual([]);
  });

  it("does not record a flavor alias when the flavor choice is CREATE", () => {
    const out = collectImportAliases(
      [aliasRow("Acme", "Pep")],
      { acme: "Acme" },
      { "acme|||pep": CREATE },
      opts,
    );
    expect(out).toEqual([]);
  });

  it("dedupes repeated rows producing the same alias", () => {
    const out = collectImportAliases(
      [aliasRow("Acme Foods", "Pep"), aliasRow("Acme Foods", "Pep")],
      { "acme foods": "Acme" },
      { "acme|||pep": "Pepperoni" },
      opts,
    );
    expect(out.filter((a) => a.type === "brand")).toHaveLength(1);
    expect(out.filter((a) => a.type === "flavor")).toHaveLength(1);
  });

  it("ignores blank brand rows and rows with blank flavor", () => {
    const out = collectImportAliases(
      [aliasRow("  ", "Pep"), aliasRow("Acme Foods", "")],
      { "acme foods": "Acme" },
      {},
      opts,
    );
    // blank brand row dropped entirely; second row only yields the brand alias.
    expect(out).toEqual([
      { type: "brand", externalName: "Acme Foods", canonicalName: "Acme", brandContext: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Multi-sheet day-block schedule planner import
// ---------------------------------------------------------------------------
//
// These guard the real-file shape: per-day header rows
// ["<label>", <date-serial>, "Brand","Flavor","Units","Customer","Ship","PO"],
// run rows beneath, and a subtotal row with blank brand/flavor. Mirrored
// verbatim web <-> mobile, so testing the web copy guards both.

import * as XLSX from "xlsx";
import {
  parseScheduleWorkbook,
  workbookIsSchedule,
  parseWorkbookObject,
  filterImportFromDate,
  isNumericLikeCell,
} from "@/utils/runExcel";

// 2026-06-22 and 2026-06-29 as Excel 1900-system serials.
const SERIAL_20260622 = 46195;
const SERIAL_20260629 = 46202;
const SHIP_SERIAL = 46206; // 2026-07-03

function sheetFromAoa(aoa: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa);
}

function wbWith(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, sheetFromAoa(aoa), name);
  }
  return wb;
}

const HEADER = (serial: number) => [
  "Monday - Day",
  serial,
  "Brand",
  "Flavor",
  "Units",
  "Customer",
  "Ship",
  "PO",
];

describe("parseScheduleWorkbook", () => {
  it("parses dated day-block rows, folding customer/PO/ship into notes", () => {
    const wb = wbWith({
      "Week 1": [
        HEADER(SERIAL_20260622),
        ["", "", "Lucias", "Pepperoni", 300, "Bernatello's", SHIP_SERIAL, 401072],
        ["", "", "Lucias", "Supreme", 120, "Bernatello's", SHIP_SERIAL, 401072],
        ["", "", "", "", 420, "", "", ""], // subtotal row -> skipped
      ],
    });
    const res = parseScheduleWorkbook(wb);
    expect(res.multiDay).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      date: "2026-06-22",
      brand: "Lucias",
      flavor: "Pepperoni",
      casesPlanned: 300,
    });
    expect(res.rows[0].notes).toBe("Bernatello's • PO 401072 • Ship 2026-07-03");
  });

  it("handles multiple day-blocks across sheets with their own dates", () => {
    const wb = wbWith({
      "Week 1": [
        HEADER(SERIAL_20260622),
        ["", "", "Lucias", "Cheese", 100, "Cust", "", ""],
        ["", "", "", "", 100, "", "", ""],
        [],
        HEADER(SERIAL_20260629),
        ["", "", "Lowes", "Veggie", 96, "MDI", "", 555],
      ],
    });
    const res = parseScheduleWorkbook(wb);
    expect(res.rows.map((r) => r.date)).toEqual(["2026-06-22", "2026-06-29"]);
    expect(res.rows[1]).toMatchObject({ brand: "Lowes", flavor: "Veggie", casesPlanned: 96 });
  });

  it("flags rows with brand/flavor but no resolvable block date as errors", () => {
    const wb = wbWith({
      Bad: [
        ["Label", "not-a-date", "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
        ["", "", "Acme", "Cheese", 5, "", "", ""],
      ],
    });
    const res = parseScheduleWorkbook(wb);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
  });

  it("reports blank-brand non-run marker rows (notes/holidays) as errors, not runs", () => {
    const wb = wbWith({
      "Week 1": [
        HEADER(SERIAL_20260622),
        ["", "", "", "Closed - Holiday", "", "", "", ""],
        ["", "", "Acme", "Cheese", 10, "", "", ""],
      ],
    });
    const res = parseScheduleWorkbook(wb);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].brand).toBe("Acme");
    expect(res.errors.some((e) => e.message === "Missing Brand")).toBe(true);
  });

  it("silently skips stray numeric cells in the Brand column (no run, no error)", () => {
    const wb = wbWith({
      "Week 1": [
        HEADER(SERIAL_20260622),
        ["", "", "Acme", "Cheese", 10, "", "", ""],
        ["", "", "0.08", "", "", "", "", ""], // stray running-total cell
        ["", "", "1,250", "", "", "", "", ""], // stray total with separator
      ],
    });
    const res = parseScheduleWorkbook(wb);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].brand).toBe("Acme");
    // Numeric junk must NOT surface as a brand candidate nor inflate the skip count.
    expect(res.errors).toHaveLength(0);
  });
});

describe("isNumericLikeCell", () => {
  it("flags purely numeric cells (including EU decimals, separators, symbols)", () => {
    for (const s of ["0.08", "0,08", "1,250", "12%", "$3.50", " 42 ", "(5)"]) {
      expect(isNumericLikeCell(s)).toBe(true);
    }
  });

  it("does not flag real brand/flavor names or blanks", () => {
    for (const s of ["", "Acme", "Cheese", "Club", "Chicken Bacon Ranch", "PO 401072"]) {
      expect(isNumericLikeCell(s)).toBe(false);
    }
  });
});

describe("workbookIsSchedule", () => {
  it("detects a dated day-block workbook", () => {
    const wb = wbWith({
      S: [HEADER(SERIAL_20260622), ["", "", "Acme", "Cheese", 10, "", "", ""]],
    });
    expect(workbookIsSchedule(wb)).toBe(true);
  });

  it("returns false for a flat single-sheet workbook", () => {
    const wb = wbWith({
      Sheet1: [
        ["Brand", "Flavor", "Cases Planned", "Notes"],
        ["Acme", "Cheese", 10, "x"],
      ],
    });
    expect(workbookIsSchedule(wb)).toBe(false);
  });

  it("parseWorkbookObject auto-routes: schedule -> multiDay, flat -> single", () => {
    const sched = wbWith({
      S: [HEADER(SERIAL_20260622), ["", "", "Acme", "Cheese", 10, "", "", ""]],
    });
    expect(parseWorkbookObject(sched).multiDay).toBe(true);

    const flat = wbWith({
      Sheet1: [
        ["Brand", "Flavor", "Cases Planned", "Notes"],
        ["Acme", "Cheese", 10, "x"],
      ],
    });
    const flatRes = parseWorkbookObject(flat);
    expect(flatRes.multiDay).toBeFalsy();
    expect(flatRes.rows).toHaveLength(1);
  });

  it("flat parser silently skips stray numeric Brand / lone numeric Flavor rows", () => {
    const flat = wbWith({
      Sheet1: [
        ["Brand", "Flavor", "Cases Planned", "Notes"],
        ["Acme", "Cheese", 10, "x"],
        ["0.08", "", "", ""], // stray running-total cell in Brand column
        ["", "1,250", "", ""], // stray numeric total in a lone Flavor cell
      ],
    });
    const res = parseWorkbookObject(flat);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].brand).toBe("Acme");
    expect(res.errors).toHaveLength(0);
  });
});

describe("filterImportFromDate", () => {
  const sched = (): ReturnType<typeof parseScheduleWorkbook> =>
    parseScheduleWorkbook(
      wbWith({
        S: [
          HEADER(SERIAL_20260622),
          ["", "", "A", "x", 1, "", "", ""],
          [],
          HEADER(SERIAL_20260629),
          ["", "", "B", "y", 2, "", "", ""],
        ],
      }),
    );

  it("keeps rows on/after fromISO and drops earlier ones", () => {
    const out = filterImportFromDate(sched(), "2026-06-29");
    expect(out.rows.map((r) => r.date)).toEqual(["2026-06-29"]);
  });

  it("keeps all rows when fromISO is on the earliest date (inclusive)", () => {
    const out = filterImportFromDate(sched(), "2026-06-22");
    expect(out.rows).toHaveLength(2);
  });

  it("passes non-multiDay results through unchanged", () => {
    const flat = parseWorkbookObject(
      wbWith({ Sheet1: [["Brand", "Flavor", "Cases Planned"], ["A", "x", 1]] }),
    );
    expect(filterImportFromDate(flat, "2099-01-01")).toBe(flat);
  });
});
