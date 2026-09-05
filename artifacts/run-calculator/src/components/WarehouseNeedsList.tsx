import { memo } from "react";
import { groupWarehouseNeedRows, type WarehouseArea } from "../warehouseGrouping";

export type NeedRow = { label: string; value: string; sub?: string; area?: WarehouseArea };

function NeedsList({ rows }: { rows: NeedRow[] }) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground italic">No data</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground truncate">{row.label}</span>
          <span className="font-bold tabular-nums text-foreground whitespace-nowrap">
            {row.value} <span className="font-normal text-muted-foreground">{row.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export const WarehouseNeedsList = memo(function WarehouseNeedsList({ rows }: { rows: NeedRow[] }) {
  const groups = groupWarehouseNeedRows(rows);
  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No data</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.area} aria-label={`${group.area} needs`}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.area}
          </h3>
          <NeedsList rows={group.rows} />
        </section>
      ))}
    </div>
  );
});
