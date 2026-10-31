import { describe, expect, it, vi } from "vitest";
// The original module's repair callbacks must never execute. Schema placeholders
// let its pure helpers load without any pool, database or operational records.
vi.mock("@workspace/db", () =>
  Object.fromEntries(
    [
      "aiCorrectionsTable",
      "brandProfilesTable",
      "cheeseRecipesTable",
      "dailySyncTable",
      "doughRecipesTable",
      "incidentsTable",
      "mixesTable",
      "sauceRecipesTable",
      "savedSpecSheetsTable",
      "specImportAliasesTable",
    ].map((name) => [name, {}]),
  ),
);
import * as original from "../lib/repairs/historicalProfileAndContaminationRepairs";
import * as fresh from "./pepNormalization";
describe("fresh live sync normalization preserves production behavior", () => {
  it.each([
    {},
    {
      pep1Type: "NATURAL",
      pep2Type: "Natural Bacon",
      pep1TypeB: "natural (synthetic)",
    },
    { pep1Type: null, pep2TypeB: " natural ", unrelated: "Natural" },
    { pep1Type: "Pepperoni Stick - NATURAL", pep2Type: 10 },
  ])("normalizes only the same live fields", (input) => {
    const a = structuredClone(input),
      b = structuredClone(input);
    expect(fresh.healNaturalPepInValues(a)).toBe(
      original.healNaturalPepInValues(b),
    );
    expect(a).toEqual(b);
    expect(fresh.healNaturalPepInValues(a)).toBe(false);
  });
  it.each([
    undefined,
    null,
    "Natural",
    [],
    ["NATURAL", "natural", "Natural Bacon"],
    ["Pepperoni Stick - NATURAL", "Natural (synthetic)", 5, null],
    ["A", "a", "B"],
    ["Natural Bacon"],
  ])("keeps list conversion/deduplication unchanged", (input) => {
    expect(fresh.healNaturalPepList(input)).toEqual(
      original.healNaturalPepList(input),
    );
  });
});
