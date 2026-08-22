import { describe, expect, it } from "vitest";
import { groupWarehouseNeedRows } from "./warehouseGrouping";

describe("groupWarehouseNeedRows", () => {
  it("orders populated areas consistently and omits empty areas", () => {
    const groups = groupWarehouseNeedRows([
      { label: "Boxes", value: "4", sub: "cases", area: "Packaging" },
      { label: "Flour", value: "12", sub: "lbs", area: "Dough" },
      { label: "Mozzarella", value: "8", sub: "lbs", area: "Frontline" },
    ]);

    expect(groups.map((group) => group.area)).toEqual(["Dough", "Frontline", "Packaging"]);
    expect(groups[0]?.rows[0]?.label).toBe("Flour");
    expect(groups[1]?.rows[0]?.label).toBe("Mozzarella");
    expect(groups[2]?.rows[0]?.label).toBe("Boxes");
  });

  it("does not change row values or order within an area", () => {
    const rows = [
      { label: "A", value: "1", sub: "lbs", area: "Sauce" as const },
      { label: "B", value: "2", sub: "batches", area: "Sauce" as const },
    ];

    expect(groupWarehouseNeedRows(rows)).toEqual([{ area: "Sauce", rows }]);
  });

  it("groups a large warehouse dataset in one linear pass", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => ({
      label: `Ingredient ${index}`,
      value: String(index),
      area: (["Dough", "Sauce", "Frontline", "Packaging"] as const)[index % 4],
    }));
    const start = performance.now();
    const groups = groupWarehouseNeedRows(rows);
    const durationMs = performance.now() - start;
    expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(rows.length);
    expect(durationMs).toBeLessThan(100);
  });
});