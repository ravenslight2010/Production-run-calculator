import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  dailySyncTable,
  freezerSurplusAllocationsTable,
  freezerSurplusLotsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryLocationsTable,
  type FreezerSurplusAllocationRow,
  type FreezerSurplusLotRow,
} from "@workspace/db";
import {
  ConfirmFreezerSurplusBody,
  ReplaceFreezerSurplusAllocationBody,
  ReplaceFreezerSurplusAllocationParams,
} from "@workspace/api-zod";
import {
  isValidSurplusDate,
  normalizePositiveCases,
  normalizeSurplusProduct,
  type FreezerSurplusAllocation,
  type FreezerSurplusLedger,
  type FreezerSurplusLot,
} from "@workspace/freezer-pull";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();

class SurplusRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// Feature C: Freezer Pull → Inventory Sync
//
// When a freezer surplus lot is created, a matching inventory item + lot is
// created at the freezer location so finished cases are visible in both systems.
// When a surplus lot is allocated to a run, the cases are deducted from the
// freezer location's inventory lot (lot movement only, no ingredient re-deduction).
//
// Inventory item key convention: "finished:{brand}:{flavor}" (or "finished:{brand}"
// when flavor is empty). This keeps finished cases separate from ingredients/packaging
// and lets the warehouse view show finished goods alongside raw materials.
const FINISHED_PREFIX = "finished:";

function finishedItemKey(brand: string, flavor: string): string {
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  return f ? `${FINISHED_PREFIX}${b}:${f}` : `${FINISHED_PREFIX}${b}`;
}

function finishedItemName(brand: string, flavor: string): string {
  return flavor ? `${brand} — ${flavor}` : brand;
}

// Structural type that accepts both db and PgTransaction
type DbExecutor = { select: typeof db.select; insert: typeof db.insert; update: typeof db.update; delete: typeof db.delete };

async function ensureFinishedInventoryItem(
  tx: DbExecutor,
  scope: string,
  brand: string,
  flavor: string,
): Promise<{ id: number }> {
  const key = finishedItemKey(brand, flavor);
  const [existing] = await tx
    .select({ id: inventoryItemsTable.id })
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.key, key), eq(inventoryItemsTable.scope, scope)))
    .limit(1);
  if (existing) return { id: existing.id };
  const [created] = await tx
    .insert(inventoryItemsTable)
    .values({
      scope,
      key,
      category: "ingredient",
      name: finishedItemName(brand, flavor),
      unit: "cases",
      reorderThreshold: 0,
    })
    .returning();
  if (!created) throw new Error("Failed to create finished-case inventory item");
  return { id: created.id };
}

async function getFreezerLocationId(tx: DbExecutor, scope: string): Promise<number | null> {
  const [loc] = await tx
    .select({ id: inventoryLocationsTable.id })
    .from(inventoryLocationsTable)
    .where(and(eq(inventoryLocationsTable.scope, scope), eq(inventoryLocationsTable.isOnsite, false)))
    .limit(1);
  return loc?.id ?? null;
}

async function upsertFinishedInventoryLot(
  tx: DbExecutor,
  scope: string,
  itemId: number,
  freezerLocationId: number | null,
  cases: number,
): Promise<void> {
  if (freezerLocationId == null) return;
  const [lot] = await tx
    .select()
    .from(inventoryLotsTable)
    .where(
      and(
        eq(inventoryLotsTable.itemId, itemId),
        eq(inventoryLotsTable.locationId, freezerLocationId),
        eq(inventoryLotsTable.scope, scope),
      ),
    )
    .limit(1);
  if (lot) {
    const newQty = Math.max(0, lot.qtyRemaining - cases);
    await tx
      .update(inventoryLotsTable)
      .set({ qtyRemaining: newQty })
      .where(eq(inventoryLotsTable.id, lot.id));
  }
  await tx.insert(inventoryLedgerTable).values({
    scope,
    itemId,
    lotId: lot?.id ?? null,
    type: "consume",
    qtyDelta: -cases,
    runId: null,
    note: "Freezer surplus allocation",
  });
}

async function addFinishedInventoryStock(
  tx: DbExecutor,
  scope: string,
  itemId: number,
  freezerLocationId: number | null,
  cases: number,
): Promise<void> {
  if (freezerLocationId == null) return;
  const [existingLot] = await tx
    .select()
    .from(inventoryLotsTable)
    .where(
      and(
        eq(inventoryLotsTable.itemId, itemId),
        eq(inventoryLotsTable.locationId, freezerLocationId),
        eq(inventoryLotsTable.scope, scope),
      ),
    )
    .limit(1);
  if (existingLot) {
    await tx
      .update(inventoryLotsTable)
      .set({ qtyRemaining: existingLot.qtyRemaining + cases })
      .where(eq(inventoryLotsTable.id, existingLot.id));
  } else {
    await tx.insert(inventoryLotsTable).values({
      scope,
      itemId,
      locationId: freezerLocationId,
      lotNumber: "",
      qtyReceived: cases,
      qtyRemaining: cases,
    });
  }
  await tx.insert(inventoryLedgerTable).values({
    scope,
    itemId,
    lotId: existingLot?.id ?? null,
    type: "restock",
    qtyDelta: cases,
    runId: null,
    note: "Freezer surplus lot confirmed",
  });
}

function toApiLot(row: FreezerSurplusLotRow): FreezerSurplusLot {
  return {
    id: row.id,
    brand: row.brand,
    flavor: row.flavor,
    productKey: row.productKey,
    productionDate: row.productionDate,
    totalCases: row.totalCases,
    remainingCases: row.remainingCases,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApiAllocation(
  row: FreezerSurplusAllocationRow,
): FreezerSurplusAllocation {
  return {
    id: row.id,
    lotId: row.lotId,
    runId: row.runId,
    runDate: row.runDate,
    brand: row.brand,
    flavor: row.flavor,
    productKey: row.productKey,
    cases: row.cases,
  };
}

async function listLedger(executor: { select: typeof db.select } = db): Promise<FreezerSurplusLedger> {
  const scope = currentScope();
  const [lots, allocations] = await Promise.all([
    executor
      .select()
      .from(freezerSurplusLotsTable)
      .where(eq(freezerSurplusLotsTable.scope, scope)),
    executor
      .select()
      .from(freezerSurplusAllocationsTable)
      .where(eq(freezerSurplusAllocationsTable.scope, scope)),
  ]);
  return {
    lots: lots.map(toApiLot),
    allocations: allocations.map(toApiAllocation),
  };
}

function validateDate(value: unknown, field: string): string {
  if (!isValidSurplusDate(value)) {
    throw new SurplusRequestError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

router.get("/freezer-surplus", async (req: Request, res: Response) => {
  try {
    res.json(await listLedger());
  } catch (err) {
    req.log.error({ err }, "freezer_surplus_list_failed");
    res.status(500).json({ error: "Couldn't load finished-case freezer surplus" });
  }
});

router.post("/freezer-surplus", requireCapability("manage-inventory"), async (req: Request, res: Response) => {
  const rawProductionDate =
    req.body && typeof req.body === "object" ? (req.body as { productionDate?: unknown }).productionDate : undefined;
  if (!isValidSurplusDate(rawProductionDate)) {
    res.status(400).json({ error: "Invalid surplus lot. Enter a product, date, and positive case count." });
    return;
  }
  const parsed = ConfirmFreezerSurplusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid surplus lot. Enter a product, date, and positive case count." });
    return;
  }
  const product = normalizeSurplusProduct(parsed.data.brand, parsed.data.flavor);
  const productionDate = rawProductionDate;
  const cases = normalizePositiveCases(parsed.data.cases);
  if (!product || !isValidSurplusDate(productionDate) || cases === null) {
    res.status(400).json({ error: "Invalid surplus lot. Enter a product, date, and positive case count." });
    return;
  }
  try {
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(freezerSurplusLotsTable)
        .values({
          id: randomUUID(),
          scope: currentScope(),
          brand: product.brand,
          flavor: product.flavor,
          productKey: product.productKey,
          productionDate,
          totalCases: cases,
          remainingCases: cases,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("Lot insert returned no row");
      // Feature C: create + restock the finished-case inventory at the freezer location
      const item = await ensureFinishedInventoryItem(tx, currentScope(), product.brand, product.flavor);
      const freezerLoc = await getFreezerLocationId(tx, currentScope());
      await addFinishedInventoryStock(tx, currentScope(), item.id, freezerLoc, cases);
      return { row, ledger: await listLedger(tx) };
    });
    req.log.info(
      { operation: "confirm", scope: currentScope(), lotId: result.row.id, cases },
      "freezer_surplus_operation",
    );
    res.status(201).json({ ...result.ledger, createdLot: toApiLot(result.row) });
  } catch (err) {
    req.log.error({ err, operation: "confirm", scope: currentScope() }, "freezer_surplus_operation_failed");
    res.status(500).json({ error: "Couldn't save the finished-case surplus. Try again." });
  }
});

router.put(
  "/freezer-surplus/allocations/:runId",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const rawRunDate =
      req.body && typeof req.body === "object" ? (req.body as { runDate?: unknown }).runDate : undefined;
    if (!isValidSurplusDate(rawRunDate)) {
      res.status(400).json({ error: "Invalid run product or date." });
      return;
    }
    const path = ReplaceFreezerSurplusAllocationParams.safeParse(req.params);
    const parsed = ReplaceFreezerSurplusAllocationBody.safeParse(req.body);
    if (
      !path.success ||
      typeof req.params.runId !== "string" ||
      !req.params.runId.trim() ||
      req.params.runId.trim() === "undefined" ||
      !parsed.success
    ) {
      res.status(400).json({ error: "Invalid run or surplus allocation." });
      return;
    }
    const runId = path.data.runId.trim();
    const product = normalizeSurplusProduct(parsed.data.brand, parsed.data.flavor);
    const runDate = rawRunDate;
    if (!product || !isValidSurplusDate(runDate)) {
      res.status(400).json({ error: "Invalid run product or date." });
      return;
    }
    const requested = new Map<string, number>();
    for (const selection of parsed.data.allocations) {
      const lotId = selection.lotId.trim();
      const cases = normalizePositiveCases(selection.cases);
      if (!lotId || cases === null) {
        res.status(400).json({ error: "Each selected surplus lot needs a positive case count." });
        return;
      }
      requested.set(lotId, (requested.get(lotId) ?? 0) + cases);
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [existingAllocations, runRows] = await Promise.all([
          tx
            .select()
            .from(freezerSurplusAllocationsTable)
            .where(
              and(
                eq(freezerSurplusAllocationsTable.scope, currentScope()),
                eq(freezerSurplusAllocationsTable.runId, runId),
              ),
            )
            .for("update"),
          tx
            .select({ data: dailySyncTable.data })
            .from(dailySyncTable)
            .where(eq(dailySyncTable.scope, currentScope()))
            .for("update"),
        ]);
        const existingRun = runRows
          .flatMap((row) => {
            const raw = row.data as { dayState?: { runs?: unknown[] } } | null;
            return Array.isArray(raw?.dayState?.runs) ? raw.dayState.runs : [];
          })
          .find(
            (candidate) =>
              candidate &&
              typeof candidate === "object" &&
              (candidate as { id?: unknown }).id === runId,
          ) as
          | { brand?: unknown; flavor?: unknown; startedAt?: unknown; endedAt?: unknown }
          | undefined;
        if (existingRun?.startedAt || existingRun?.endedAt) {
          throw new SurplusRequestError("This run has already started or finished; its surplus pull cannot be changed.", 409);
        }
        if (
          existingRun &&
          (!normalizeSurplusProduct(existingRun.brand, existingRun.flavor) ||
            normalizeSurplusProduct(existingRun.brand, existingRun.flavor)?.productKey !== product.productKey)
        ) {
          throw new SurplusRequestError("The selected surplus does not match this run's brand and flavor.");
        }
        const oldByLot = new Map<string, number>();
        for (const allocation of existingAllocations) {
          oldByLot.set(allocation.lotId, (oldByLot.get(allocation.lotId) ?? 0) + allocation.cases);
        }
        const lotIds = [...new Set([...oldByLot.keys(), ...requested.keys()])];
        const lots = lotIds.length
          ? await tx
              .select()
              .from(freezerSurplusLotsTable)
              .where(
                and(
                  eq(freezerSurplusLotsTable.scope, currentScope()),
                  inArray(freezerSurplusLotsTable.id, lotIds),
                ),
              )
              .for("update")
          : [];
        const lotById = new Map(lots.map((lot) => [lot.id, lot]));
        for (const lotId of lotIds) {
          const lot = lotById.get(lotId);
          if (!lot) throw new SurplusRequestError("One selected surplus lot is no longer available.");
          if (lot.productKey !== product.productKey) {
            throw new SurplusRequestError("A selected surplus lot belongs to a different product.");
          }
          const availableAfterRelease = lot.remainingCases + (oldByLot.get(lotId) ?? 0);
          const wanted = requested.get(lotId) ?? 0;
          if (wanted > availableAfterRelease) {
            throw new SurplusRequestError(
              `${lot.brand}${lot.flavor ? ` — ${lot.flavor}` : ""} has only ${availableAfterRelease} cases available in that dated lot.`,
            );
          }
        }
        for (const allocation of existingAllocations) {
          await tx
            .update(freezerSurplusLotsTable)
            .set({
              remainingCases: (lotById.get(allocation.lotId)?.remainingCases ?? 0) + allocation.cases,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(freezerSurplusLotsTable.id, allocation.lotId),
                eq(freezerSurplusLotsTable.scope, currentScope()),
              ),
            );
          const lot = lotById.get(allocation.lotId);
          if (lot) lot.remainingCases += allocation.cases;
        }
        if (existingAllocations.length > 0) {
          await tx
            .delete(freezerSurplusAllocationsTable)
            .where(
              and(
                eq(freezerSurplusAllocationsTable.runId, runId),
                eq(freezerSurplusAllocationsTable.scope, currentScope()),
              ),
            );
        }
        // Feature C: also release/restore the finished-case inventory for old allocations
        if (existingAllocations.length > 0) {
          const totalOldCases = existingAllocations.reduce((sum, a) => sum + a.cases, 0);
          if (totalOldCases > 0) {
            const item = await ensureFinishedInventoryItem(tx, currentScope(), product.brand, product.flavor);
            const freezerLoc = await getFreezerLocationId(tx, currentScope());
            await addFinishedInventoryStock(tx, currentScope(), item.id, freezerLoc, totalOldCases);
          }
        }
        for (const [lotId, cases] of requested) {
          const lot = lotById.get(lotId);
          if (!lot) continue;
          await tx
            .update(freezerSurplusLotsTable)
            .set({ remainingCases: lot.remainingCases - cases, updatedAt: new Date() })
            .where(
              and(
                eq(freezerSurplusLotsTable.id, lotId),
                eq(freezerSurplusLotsTable.scope, currentScope()),
              ),
            );
          await tx.insert(freezerSurplusAllocationsTable).values({
            id: `${runId}:${lotId}`,
            scope: currentScope(),
            lotId,
            runId,
            runDate,
            brand: product.brand,
            flavor: product.flavor,
            productKey: product.productKey,
            cases,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        // Feature C: deduct newly allocated cases from finished-case inventory
        const totalNewCases = [...requested.values()].reduce((sum, c) => sum + c, 0);
        if (totalNewCases > 0) {
          const item = await ensureFinishedInventoryItem(tx, currentScope(), product.brand, product.flavor);
          const freezerLoc = await getFreezerLocationId(tx, currentScope());
          await upsertFinishedInventoryLot(tx, currentScope(), item.id, freezerLoc, totalNewCases);
        }
        return listLedger(tx);
      });
      req.log.info(
        { operation: "allocate", scope: currentScope(), runId, selectedLotCount: requested.size },
        "freezer_surplus_operation",
      );
      res.json(result);
    } catch (err) {
      if (err instanceof SurplusRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err, operation: "allocate", scope: currentScope(), runId }, "freezer_surplus_operation_failed");
      res.status(500).json({ error: "Couldn't apply the surplus pull. Refresh and try again." });
    }
  },
);

export default router;