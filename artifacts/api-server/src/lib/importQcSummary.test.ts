import { describe, expect, it } from "vitest";
import { buildImportQcSummary } from "./importQcSummary";

describe("retained import QC summary", () => {
  it("accounts for creates, updates, deletes and private note-only changes without retaining private values", () => {
    const result = buildImportQcSummary({
      mixes: [{ id: "update", name: "Δ", batchSize: 1, components: [{ ingredient: "Cheese", perPizza: 2 }] }, { id: "delete", name: "Deleted" }, { id: "note", notes: "PRIVATE_BEFORE" }],
    }, {
      mixes: [{ id: "update", name: "Δ", batchSize: 2, components: [{ ingredient: "Cheese", perPizza: 3 }] }, { id: "create", name: "Créée" }, { id: "note", notes: "PRIVATE_AFTER" }],
      sourceText: "PRIVATE_WORKBOOK",
    });
    expect(result.entities).toEqual([{ entity: "mixes", before: 3, after: 3, created: 1, updated: 2, deleted: 1 }]);
    expect(result.changes[0]).toMatchObject({
      before: { batchSize: 1, "components[0].perPizza": 2 },
      after: { batchSize: 2, "components[0].perPizza": 3 },
    });
    expect(result.changes.find((change) => change.row === "note")?.fields).toEqual(["notes"]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  });

  it("bounds row/field/scalar/text retention and marks omitted changed rows", () => {
    const after = { mixes: Array.from({ length: 500 }, (_, index) => ({
      id: String(index), name: "X".repeat(1000), notes: "PRIVATE_NOTE",
      components: Array.from({ length: 100 }, () => ({ ingredient: "Y".repeat(1000), perPizza: 1 })),
      ...Object.fromEntries(Array.from({ length: 100 }, (_, field) => [`numeric${field}`, field])),
    })) };
    const result = buildImportQcSummary({}, after);
    expect(result.changes).toHaveLength(30);
    expect(result.omittedChanges).toBe(470);
    expect(result.entities[0].created).toBe(500);
    expect(result.changes.every((row) => row.row.length <= 120 && row.fields.length <= 40 && Object.keys(row.after).length <= 24)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100000);
  });
});
