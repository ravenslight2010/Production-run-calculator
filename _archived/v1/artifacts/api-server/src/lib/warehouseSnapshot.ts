// Server-side warehouse demand snapshot — the "server is boss when online"
// mirror of the client's ReorderCard / UseFirstCard / transfer warnings.
//
// Pure: every input is passed in (no DB reads here). The route in
// routes/warehouseSnapshot.ts loads sync rows, profiles, freezer surplus,
// inventory items/locations, and settings, then calls
// computeWarehouseSnapshot. The client falls back to its own local
// computation when offline, so any drift is only ever as stale as the last
// successful sync. All math is the SAME shared @workspace/inventory-math
// functions the web + mobile apps use — nothing is re-implemented.
//
// Basis parity with the web app (home.tsx):
//   - reorder   <- scheduled (future) run values -> ReorderCard
//   - useFirst  <- today's item keys (FEFO)     -> UseFirstCard
//   - transfer  <- today's run values           -> InventoryTab warnings

import {
  aggregateRunDemand,
  computeReorderList,
  computeTransferNeeds,
  computeUseFirstList,
  type InventoryCategory,
  type RunLinesInput,
  type LocationStock,
  type ReorderItem,
  type TransferDemand,
  type TransferNeed,
  type UseFirstEntry,
  type UseFirstItemInput,
} from "@workspace/inventory-math";

/** Server item shape (matches the /inventory response the web client uses). */
export type WarehouseSnapshotItem = {
  key: string;
  name: string;
  unit: string;
  category: string;
  onHand: number;
  reorderThreshold: number;
  byLocation: Array<{
    locationId: number | null;
    locationName: string;
    isOnsite: boolean;
    onHand: number;
  }>;
  lots: Array<{
    id: number;
    locationId: number | null;
    qtyRemaining: number;
    expirationDate: string | null;
  }>;
};

export type WarehouseSnapshotLocation = {
  id: number;
  name: string;
  isOnsite: boolean;
};

export type WarehouseSnapshotResult = {
  reorder: ReorderItem[];
  useFirst: UseFirstEntry[];
  transfer: TransferNeed[];
};

type RunLinesLike = Parameters<typeof aggregateRunDemand>[0][number];

function toRunLinesInput(vals: Record<string, unknown>): RunLinesInput {
  // Web FormValues uses targetDoughballWeight; the shared lib's canonical field
  // name is doughballWeightOz. Mirror the web's toRunLinesInput mapping. The
  // cast through unknown is required because runtime rows may legitimately lack
  // optional recipe fields; the lib guards every read with `Number(x) || 0`.
  const mapped: Record<string, unknown> = {
    ...vals,
    doughballWeightOz: Number(vals.targetDoughballWeight) || 0,
  };
  return mapped as unknown as RunLinesInput;
}

function toReorderInput(it: WarehouseSnapshotItem): {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  onHand: number;
  reorderThreshold: number;
} {
  return {
    key: it.key,
    name: it.name,
    unit: it.unit,
    category: it.category as InventoryCategory,
    onHand: Number(it.onHand) || 0,
    reorderThreshold: Number(it.reorderThreshold) || 0,
  };
}

function toUseFirstItem(it: WarehouseSnapshotItem): UseFirstItemInput {
  return {
    key: it.key,
    name: it.name,
    unit: it.unit,
    category: it.category as InventoryCategory,
    lots: (it.lots ?? []).map((l) => ({
      qtyRemaining: Number(l.qtyRemaining) || 0,
      expirationDate: l.expirationDate,
      locationId: l.locationId,
    })),
  };
}

export function buildStockByKey(
  items: WarehouseSnapshotItem[],
): Record<string, LocationStock[]> {
  const out: Record<string, LocationStock[]> = {};
  for (const it of items) {
    out[it.key] = (it.byLocation ?? []).map((loc) => ({
      locationId: loc.locationId ?? 0,
      locationName: loc.locationName,
      isOnsite: loc.isOnsite,
      onHand: Number(loc.onHand) || 0,
    }));
  }
  return out;
}

/** Roll scheduled run values into the per-item-key demand map. */
export function buildDemandByKey(
  scheduledVals: Array<Record<string, unknown>>,
): Record<string, number> {
  const demandByKey: Record<string, number> = {};
  for (const d of aggregateRunDemand(
    scheduledVals.map(toRunLinesInput) as RunLinesLike[],
    [],
  )) {
    demandByKey[d.key] = d.qty;
  }
  return demandByKey;
}

export function computeWarehouseSnapshot(input: {
  todayRunValues: Array<Record<string, unknown>>;
  scheduledRunValues: Array<Record<string, unknown>>;
  items: WarehouseSnapshotItem[];
  locations: WarehouseSnapshotLocation[];
  soonDays: number;
}): WarehouseSnapshotResult {
  const { items, locations, soonDays } = input;
  const scheduledVals = input.scheduledRunValues;
  const todayVals = input.todayRunValues;

  const demandByKey = buildDemandByKey(scheduledVals);
  const reorder = computeReorderList(items.map(toReorderInput), demandByKey);

  // Today's run values drive BOTH the use-first priority keys and the transfer
  // warnings (InventoryTab's computeRunTransferNeeds basis), so aggregate once.
  const todayDemands = aggregateRunDemand(
    todayVals.map(toRunLinesInput) as RunLinesLike[],
    [],
  );
  const useFirst = computeUseFirstList({
    items: items.map(toUseFirstItem),
    locations: locations.map((l) => ({ id: l.id, name: l.name, isOnsite: l.isOnsite })),
    soonDays,
    todayItemKeys: todayDemands.map((d) => d.key),
  });

  const transfer = computeTransferNeeds({
    demands: todayDemands as TransferDemand[],
    stockByKey: buildStockByKey(items),
  });

  return { reorder, useFirst, transfer };
}

/** Default expiry lead time; mirrors the web EXPIRY_SOON_DAYS fallback. */
export const DEFAULT_EXPIRY_SOON_DAYS = 7;
