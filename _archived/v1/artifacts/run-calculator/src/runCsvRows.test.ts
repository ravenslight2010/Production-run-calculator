// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { currentRunCsvRows, historyRunCsvRows } from "./runCsvRows";
import { DEFAULT_VALUES, type HistoryDay, type RunMeta } from "./types";

const runs: RunMeta[] = [
  { id: "canonical", brand: "Synthetic", flavor: "Cheese", startedAt: 100, endedAt: 200 },
  { id: "pending", brand: "Synthetic", flavor: "Pepperoni", startedAt: 300, endedAt: 400 },
];
const buildRow = (date: string, run: RunMeta) =>
  [date, run.brand, run.flavor, "Finished", "17", "16", "0", "start", "end", "duration", "0", "ppm", "", ""];
function assertWidths(rows: string[][], width: number): void {
  expect(rows[0]).toHaveLength(width);
  for (const row of rows.slice(1)) expect(row).toHaveLength(rows[0].length);
}

describe("production CSV column/provenance contract", () => {
  it.each([{ items: [] }, { items: runs }])("keeps current-day headers and all rows at 14 columns", ({ items }) => {
    const valuesFor = vi.fn(() => DEFAULT_VALUES);
    const builder = vi.fn(buildRow);
    const rows = currentRunCsvRows("2026-10-23", items, valuesFor, builder);
    assertWidths(rows, 14);
    expect(rows[0]).not.toContain("Record source");
    expect(valuesFor).toHaveBeenCalledTimes(items.length);
    for (const run of items) {
      expect(builder).toHaveBeenCalledWith("2026-10-23", run, DEFAULT_VALUES);
    }
  });

  it.each([
    { runs: [], pendingRunIds: [] },
    { runs: [runs[0]], pendingRunIds: [] },
    { runs: [runs[1]], pendingRunIds: ["pending"] },
    { runs, pendingRunIds: ["pending"] },
  ])("labels every archived/pending row under its matching provenance header", (fixture) => {
    const day: HistoryDay = { date: "2026-10-23", runValues: {}, ...fixture };
    const rows = historyRunCsvRows(day, buildRow);
    assertWidths(rows, 15);
    expect(rows[0].at(-1)).toBe("Record source");
    day.runs.forEach((run, index) => {
      expect(rows[index + 1].at(-1)).toBe(day.pendingRunIds?.includes(run.id)
        ? "Pending local completion — not server-acknowledged"
        : "Canonical server completion — view/export only");
    });
  });

  it("uses the tested row builders in both actual Home download actions", () => {
    const source = readFileSync("src/pages/home.tsx", "utf8");
    const current = source.slice(source.indexOf("  function exportCSV()"), source.indexOf("  function exportHistoryCSV("));
    const history = source.slice(source.indexOf("  function exportHistoryCSV("), source.indexOf("  async function exportExcel("));
    expect(current).toContain("currentRunCsvRows(");
    expect(history).toContain("historyRunCsvRows(day, buildRunCsvRow)");
    expect(current).not.toContain('"Record source"');
    expect(history).not.toContain("rows.push");
  });
});
