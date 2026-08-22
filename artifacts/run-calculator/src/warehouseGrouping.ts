export const WAREHOUSE_AREAS = ["Dough", "Sauce", "Frontline", "Packaging"] as const;

export type WarehouseArea = (typeof WAREHOUSE_AREAS)[number];

export type WarehouseNeedRow = {
  label: string;
  value: string;
  sub?: string;
  area?: WarehouseArea;
};

export type WarehouseNeedGroup = {
  area: WarehouseArea;
  rows: WarehouseNeedRow[];
};

/**
 * Keep warehouse grouping in one place so the all-runs and per-run views use
 * exactly the same area ordering and omit empty areas consistently.
 */
export function groupWarehouseNeedRows(
  rows: readonly WarehouseNeedRow[],
): WarehouseNeedGroup[] {
  return WAREHOUSE_AREAS
    .map((area) => ({
      area,
      rows: rows.filter((row) => row.area === area),
    }))
    .filter((group) => group.rows.length > 0);
}