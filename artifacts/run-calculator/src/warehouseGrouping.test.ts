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
});