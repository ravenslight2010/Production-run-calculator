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
  const grouped = new Map<WarehouseArea, WarehouseNeedRow[]>();
  for (const row of rows) {
    if (!row.area) continue;
    const areaRows = grouped.get(row.area);
    if (areaRows) areaRows.push(row);
    else grouped.set(row.area, [row]);
  }
  return WAREHOUSE_AREAS.flatMap((area) => {
    const areaRows = grouped.get(area);
    return areaRows?.length ? [{ area, rows: areaRows }] : [];
  });
}