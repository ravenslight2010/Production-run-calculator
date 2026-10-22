import { describe, expect, it } from "vitest";
import { compareImportSnapshots, compareImportSourceVersions, projectImportWrites, type ImportSnapshot } from "./importChanges";
import { assertImportFileBytes, assertImportPreflight, preflightImportGrids } from "./importPreflight";
import { validateImportAppliedValues } from "./importAppliedValues";

describe("reviewed import changes", () => {
  const before: ImportSnapshot = { mixes: [{ id: "a", name: "Mix", batchSize: 100, components: [
    { ingredient: "Pepper", perPizza: 1, perBatchLbs: 10 },
    { ingredient: "Pepper", perPizza: 2, perBatchLbs: 20 },
  ] }] };
  it("is stable for unchanged values and ignores server bookkeeping", () => {
    expect(compareImportSnapshots(before, JSON.parse(JSON.stringify(before)))).toEqual([]);
    expect(compareImportSnapshots(before, { mixes: [{ ...before.mixes[0], updatedAtMs: 10, scope: "live", force: true }] })).toEqual([]);
  });
  it("preserves repeat-row identity and native ounces versus pounds", () => {
    const after = projectImportWrites(before, { mixes: { upsert: [{ id: "a", batchSize: 120, components: [
      { ingredient: "Pepper", perPizza: 2, perBatchLbs: 20 },
      { ingredient: "Pepper", perPizza: 1, perBatchLbs: 10 },
    ] }] } });
    const changes = compareImportSnapshots(before, after);
    expect(changes[0].fields).toContainEqual({ field: "batchSize", before: 100, after: 120, unit: "lbs/batch" });
    expect(changes[0].fields).toContainEqual({ field: "components[1].perPizza", before: 1, after: 2, unit: "oz/pizza" });
    expect(changes[0].fields).toContainEqual({ field: "components[1].perBatchLbs", before: 10, after: 20, unit: "lbs/batch" });
  });
  it("does not infer deletes from workbook absence; only explicit deletes remove", () => {
    expect(compareImportSnapshots(before, projectImportWrites(before, { mixes: { upsert: [] } }))).toEqual([]);
    expect(compareImportSnapshots(before, projectImportWrites(before, { mixes: { delete: ["a"] } }))[0].action).toBe("remove");
    const sourceChanges = compareImportSourceVersions(before, { mixes: [] });
    expect(sourceChanges[0].action).toBe("change");
    expect(sourceChanges[0].fields[0].field).toContain("not a deletion");
  });
  it("distinguishes links, creates and unknown fields without converting zero to missing", () => {
    expect(compareImportSnapshots({ profiles: [{ key: "a", doughRecipeName: "Old" }] },
      { profiles: [{ key: "a", doughRecipeName: "New" }] })[0].action).toBe("link");
    const diff = compareImportSnapshots({}, { profiles: [{ key: "a", casesPlanned: 0 }] });
    expect(diff[0].action).toBe("create");
    expect(diff[0].fields.find((field) => field.field === "casesPlanned")).toMatchObject({ before: undefined, after: 0 });
  });
});

describe("bounded format-aware preflight", () => {
  it("resumes formula validation under later headers, including reordered columns beyond row 30", () => {
    const rows: unknown[][] = [
      ["Ingredient", "Per Pizza (oz)", "Per Batch (lbs)"],
      ["Green Pepper", 1.5, 40],
      ["Total", "", 40],
      ["Product Brand", "Example Customer"],
      ["Product Flavor", "Second Pizza"],
      ["Example Onion Mix"],
      ...Array.from({ length: 30 }, () => []),
      ["Per Batch (lbs)", "Ingredient", "Per Pizza (oz)"],
      [50, "Onion", 2.25],
      ["", "Total", 50],
    ];
    const grids = [{ name: "Two recipes", rows }];
    expect(preflightImportGrids(grids, "premix")).toEqual([]);
    rows[37][2] = -2.25;
    expect(preflightImportGrids(grids, "premix")).toContainEqual(expect.objectContaining({
      severity: "error", row: 38, column: "Per Pizza (oz)",
    }));
    rows[37][2] = "";
    expect(preflightImportGrids(grids, "premix")).toEqual([expect.objectContaining({
      severity: "review", row: 38, column: "Per Pizza (oz)",
    })]);
  });
  it("validates each schedule section using that section's column positions", () => {
    const rows = [
      ["2026-01-15", "Brand", "Flavor", "Cases Planned"],
      ["", "Example Customer", "First", "100"],
      [],
      ["Cases Planned", "Flavor", "Brand", "2026-01-16"],
      ["250", "Second", "Example Customer", ""],
    ];
    const grids = [{ name: "Two days", rows }];
    expect(preflightImportGrids(grids, "schedule")).toEqual([]);
    rows[4][0] = "not a count";
    expect(() => assertImportPreflight(grids, "schedule")).toThrow(/row 5.*Cases Planned/);
  });
  it("rejects empty and oversized input before decoding/provider work", () => {
    expect(() => assertImportFileBytes(0, "empty.xlsx")).toThrow(/empty/i);
    expect(() => assertImportFileBytes(26 * 1024 * 1024, "large.xlsx")).toThrow(/large.xlsx/);
  });
  it("does not falsely reject an unfamiliar or ambiguous layout", () => {
    const grids = [{ name: "Recipe card", sourceFile: "sample.xlsx", rows: [["Sauce Guide"], ["BBQ", "Buy as is"]] }];
    expect(() => assertImportPreflight(grids)).not.toThrow();
    expect(preflightImportGrids(grids).some((item) => item.severity === "review")).toBe(true);
  });
  it("reports exact worksheet/column for recognized canonical invalid numbers", () => {
    const grids = [{ name: "Schedule", sourceFile: "sample.xlsx",
      rows: [["Brand", "Flavor", "Cases Planned"], ["Sample", "Plain", "not a number"]] }];
    expect(() => assertImportPreflight(grids, "schedule")).toThrow(/Schedule.*Cases Planned/);
  });
  it("treats blank canonical amounts as unknown, not zero or mandatory rejection", () => {
    const grids = [{ name: "Schedule", rows: [["Brand", "Flavor", "Cases Planned"], ["Sample", "Plain", ""]] }];
    expect(() => assertImportPreflight(grids, "schedule")).not.toThrow();
    expect(preflightImportGrids(grids, "schedule").some((item) => item.severity === "review")).toBe(true);
  });
  it.each([
    ["spec", ["Brand", "Flavor", "Die Type", "Sauce Recipe", "Sauce oz per pizza"], ["Synthetic", "Plain", "12 inch", "Sauce", -1]],
    ["premix", ["Ingredient", "Per Pizza", "Per Batch lbs"], ["Pepper", -1, 10]],
    ["cheese", ["Ingredient", "Per Pizza", "Per Batch lbs"], ["Cheese", -1, 10]],
    ["shipping", ["Brand", "Pizzas Per Case", "Cases Per Skid"], ["Synthetic", -1, 10]],
    ["sauce", ["Brand", "Sauce Recipe", "Sauce oz per pizza"], ["Synthetic", "Sauce", -1]],
  ] as const)("rejects invalid canonical %s values without rejecting unknown layouts", (format, headers, row) => {
    expect(() => assertImportPreflight([{ name: "Canonical", rows: [headers, row] }], format)).toThrow(/non-negative/);
    expect(() => assertImportPreflight([{ name: "Custom", rows: [["Custom table"], row] }], format)).not.toThrow();
  });
  it("accepts a name-only dough guide and ignores non-record footnotes", () => {
    expect(() => assertImportPreflight([{ name: "Dough", rows: [["Brand", "Dough Recipe"], ["Synthetic", "Shared dough"]] }], "dough")).not.toThrow();
    expect(() => assertImportPreflight([{ name: "Schedule", rows: [["Brand", "Flavor", "Cases Planned"], ["Synthetic", "", 10], ["Notes", "", "Call office"]] }], "schedule")).not.toThrow();
  });
});

describe("bounded applied-value history (not source retention)", () => {
  it("accepts only allowlisted business writes and rejects source text, nested profiles and oversized values", () => {
    expect(validateImportAppliedValues({ profiles: [{ key: "A", brand: "A", flavor: "", doughRecipeName: "Shared" }] })).not.toBeNull();
    for (const value of [
      { profiles: [{ key: "A", sourceFile: "private.xlsx" }] },
      { profiles: [{ key: "A", values: { sauceOzPerPizza: 3 } }] },
      { profiles: [{ key: "A", formula: "=SUM(A1:A10)" }] },
      { runs: Array.from({ length: 501 }, (_, index) => ({ key: String(index) })) },
    ]) expect(validateImportAppliedValues(value)).toBeNull();
  });
});
