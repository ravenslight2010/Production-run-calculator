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
