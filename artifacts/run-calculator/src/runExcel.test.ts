// @vitest-environment node
//
// Unit tests for mergeImportRuns — combines same brand+flavor import runs on the
// same day into one run (cases summed, distinct notes joined). Mirrored verbatim
// web <-> mobile (replit.md parity), so testing the web copy guards both.

import { describe, it, expect } from "vitest";
import { mergeImportRuns, type ImportCommitRun } from "@/utils/runExcel";

const run = (
  brand: string,
  flavor: string,
  casesPlanned: number,
  notes = "",
): ImportCommitRun => ({ brand, flavor, casesPlanned, notes });

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
