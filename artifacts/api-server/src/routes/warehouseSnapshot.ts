// Server-authority warehouse snapshot ("server is boss when online").
//
// GET /inventory/warehouse-snapshot returns the reorder list, use-first list,
// and transfer warnings computed server-side from canonical sync data +
// inventory. The web client prefers this response when online and falls back
// to its own local computation when offline, so numbers can never drift
// between devices and the battery/CPU cost of the advisory cards is paid once
// on the server instead of on every inventory refresh per device.
//
// Math parity: this route feeds the SAME @workspace/inventory-math functions
// the web + mobile apps use (nothing re-implemented). Profile resolution is
// deliberately the server-pool source of truth (brand_profiles table).

import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  dailySyncTable,
  brandProfilesTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLocationsTable,
  inventorySettingsTable,
  freezerSurplusLotsTable,
  freezerSurplusAllocationsTable,
} from "@workspace/db";
import { applySubstitutions, type IngredientSubstitution } from "@workspace/inventory-math";
import { summarizeSurplusForRun, type FreezerSurplusAllocation, type FreezerSurplusLot } from "@workspace/freezer-pull";
import { currentScope } from "../lib/requestScope";
import { facilityDate } from "../lib/facilityTime";
import {
  computeWarehouseSnapshot,
  DEFAULT_EXPIRY_SOON_DAYS,
  type WarehouseSnapshotItem,
  type WarehouseSnapshotLocation,
} from "../lib/warehouseSnapshot";

const router: Router = Router();

async function loadSettingsSoonDays(): Promise<number> {
  const scope = currentScope();
  const rows = await db
    .select({ expirySoonDays: inventorySettingsTable.expirySoonDays })
    .from(inventorySettingsTable)
    .where(eq(inventorySettingsTable.scope, scope))
    .limit(1);
  return rows[0]?.expirySoonDays ?? DEFAULT_EXPIRY_SOON_DAYS;
}

async function loadItems(): Promise<WarehouseSnapshotItem[]> {
  const scope = currentScope();
  const locations = await db
    .select()
    .from(inventoryLocationsTable)
    .where(eq(inventoryLocationsTable.scope, scope))
    .orderBy(asc(inventoryLocationsTable.isOnsite), asc(inventoryLocationsTable.name));
  const onsite = locations.find((l) => l.isOnsite)?.id ?? null;
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.scope, scope))
    .orderBy(asc(inventoryItemsTable.category), asc(inventoryItemsTable.name));
  const lots = await db
    .select()
    .from(inventoryLotsTable)
    .where(eq(inventoryLotsTable.scope, scope));
  const lotsByItem = new Map<number, WarehouseSnapshotItem["lots"]>();
  for (const lot of lots) {
    const arr = lotsByItem.get(lot.itemId) ?? [];
    arr.push({
      id: lot.id,
      locationId: lot.locationId,
      qtyRemaining: lot.qtyRemaining,
      expirationDate: lot.expirationDate,
    });
    lotsByItem.set(lot.itemId, arr);
  }
  return items.map((item) => {
    const itemLots = lotsByItem.get(item.id) ?? [];
    const onHand = itemLots.reduce((sum, l) => sum + (Number(l.qtyRemaining) || 0), 0);
    const byLocation = locations.map((loc) => ({
      locationId: loc.id,
      locationName: loc.name,
      isOnsite: loc.isOnsite,
      onHand: itemLots
        .filter((l) => (l.locationId ?? null) === (loc.isOnsite ? onsite : loc.id))
        .reduce((sum, l) => sum + (Number(l.qtyRemaining) || 0), 0),
    }));
    return {
      key: item.key,
      name: item.name,
      unit: item.unit,
      category: item.category,
      onHand,
      reorderThreshold: item.reorderThreshold,
      byLocation,
      lots: itemLots,
    };
  });
}

// Mirror the web's loadProfile(brand, flavor) merge against the server pool:
// values jsonb = dough blob, crustValues jsonb = crust blob. Per-run fields
// (casesNeeded etc.) are overlaid separately by the caller.
function profileValuesFor(brand: string, flavor: string): Record<string, unknown> | null {
  const profiles = profileCacheByKey.current;
  const key = `${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
  const profile = profiles.get(key);
  if (!profile) return null;
  return { ...(profile.values ?? {}), ...(profile.crustValues ?? {}) };
}

const profileCacheByKey: { current: Map<string, { values?: Record<string, unknown>; crustValues?: Record<string, unknown> }> } =
  { current: new Map() };

function applySurplusCarryIn(
  values: Record<string, unknown>,
  run: { id?: string; brand?: string; flavor?: string },
  lots: FreezerSurplusLot[],
  allocations: FreezerSurplusAllocation[],
): Record<string, unknown> {
  const originalTarget = Number(values.casesNeeded) || 0;
  if (originalTarget <= 0) return values;
  const summary = summarizeSurplusForRun({
    runId: run.id ?? "",
    brand: run.brand ?? "",
    flavor: run.flavor ?? "",
    originalTarget,
    lots,
    allocations,
  });
  return summary.carriedInCases > 0
    ? { ...values, casesNeeded: summary.productionCases }
    : values;
}

router.get("/inventory/warehouse-snapshot", async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const today = facilityDate();

    const rows = await db
      .select()
      .from(dailySyncTable)
      .where(eq(dailySyncTable.scope, scope))
      .orderBy(asc(dailySyncTable.date));
    const profiles = await db
      .select()
      .from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, scope));
    profileCacheByKey.current = new Map(profiles.map((p) => [p.key, p]));

    const surplusLots = await db
      .select()
      .from(freezerSurplusLotsTable)
      .where(eq(freezerSurplusLotsTable.scope, scope));
    const surplusAllocations = await db
      .select()
      .from(freezerSurplusAllocationsTable)
      .where(eq(freezerSurplusAllocationsTable.scope, scope));
    const lots: FreezerSurplusLot[] = surplusLots.map((r) => ({
      id: r.id,
      brand: r.brand,
      flavor: r.flavor,
      productKey: r.productKey,
      productionDate: r.productionDate,
      totalCases: r.totalCases,
      remainingCases: r.remainingCases,
    }));
    const allocations: FreezerSurplusAllocation[] = surplusAllocations.map((r) => ({
      id: r.id,
      lotId: r.lotId,
      runId: r.runId,
      runDate: r.runDate,
      brand: r.brand,
      flavor: r.flavor,
      productKey: r.productKey,
      cases: r.cases,
    }));

    const items = await loadItems();
    const locations: WarehouseSnapshotLocation[] = await db
      .select({ id: inventoryLocationsTable.id, name: inventoryLocationsTable.name, isOnsite: inventoryLocationsTable.isOnsite })
      .from(inventoryLocationsTable)
      .where(eq(inventoryLocationsTable.scope, scope));
    const soonDays = await loadSettingsSoonDays();

    const todayRunValues: Array<Record<string, unknown>> = [];
    const scheduledRunValues: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const data = row.data as {
        dayState?: {
          runs?: Array<{ id?: string; brand?: string; flavor?: string; }>;
          substitutions?: IngredientSubstitution[];
        };
        runValues?: Record<string, Record<string, unknown>>;
      } | null;
      const runs = data?.dayState?.runs ?? [];
      const substitutions = data?.dayState?.substitutions ?? [];
      for (const run of runs) {
        if (!run?.id) continue;
        const rawVals = data?.runValues?.[run.id];
        if (!rawVals || typeof rawVals !== "object") continue;
        const hasSubs = substitutions.length > 0;
        const base = hasSubs
          ? applySubstitutions(rawVals, substitutions) as Record<string, unknown>
          : rawVals as Record<string, unknown>;
        const effective = applySurplusCarryIn(base, run, lots, allocations);
        if (row.date === today) {
          // Transfer-warning basis: today's runs with their live values.
          todayRunValues.push(effective);
        } else if (row.date > today && run.brand && run.flavor) {
          // Reorder + use-first basis: future scheduled runs resolved from the
          // brand profile pool (mirrors the web scheduledValues builder).
          const profile = profileValuesFor(run.brand, run.flavor);
          const casesNeeded = Number((rawVals as Record<string, unknown>).casesNeeded) || 0;
          const dieType = String((rawVals as Record<string, unknown>).dieType ?? "") || undefined;
          const merged: Record<string, unknown> = {
            ...(profile ?? {}),
            casesNeeded,
            ...(run.brand ? { brand: run.brand } : {}),
            ...(run.flavor ? { flavor: run.flavor } : {}),
            ...(dieType ? { dieType } : {}),
          };
          const effectiveScheduled = applySurplusCarryIn(merged, run, lots, allocations);
          scheduledRunValues.push(effectiveScheduled);
        }
      }
    }

    const snapshot = computeWarehouseSnapshot({
      todayRunValues,
      scheduledRunValues,
      items,
      locations,
      soonDays,
    });

    res.json({ ...snapshot, generatedAt: Date.now() });
  } catch (err) {
    req.log.error({ err }, "warehouse_snapshot_failed");
    res.status(500).json({ error: "Couldn't build the warehouse snapshot. Try again." });
  }
});

export default router;
