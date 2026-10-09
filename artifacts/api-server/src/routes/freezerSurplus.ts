import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  dailySyncTable,
  freezerSurplusAdjustmentsTable,
  freezerSurplusAllocationsTable,
  freezerSurplusLotsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryLocationsTable,
  type FreezerSurplusAdjustmentRow,
  type FreezerSurplusAllocationRow,
  type FreezerSurplusLotRow,
} from "@workspace/db";
import {
  ConfirmFreezerSurplusBody,
  RecordFreezerSurplusAdjustmentBody,
  RecordFreezerSurplusAdjustmentParams,
  ReplaceFreezerSurplusAllocationBody,
  ReplaceFreezerSurplusAllocationParams,
} from "@workspace/api-zod";
import {
  isValidSurplusDate,
  normalizePositiveCases,
  normalizeSurplusProduct,
  type FreezerSurplusAllocation,
  type FreezerSurplusAdjustment,
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
  note = "Freezer surplus lot confirmed",
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
    note,
  });
}

async function removeFinishedInventoryStock(
  tx: DbExecutor,
  scope: string,
  itemId: number,
  freezerLocationId: number,
  cases: number,
  note: string,
): Promise<void> {
  const lots = await tx
    .select()
    .from(inventoryLotsTable)
    .where(
      and(
        eq(inventoryLotsTable.itemId, itemId),
        eq(inventoryLotsTable.locationId, freezerLocationId),
        eq(inventoryLotsTable.scope, scope),
      ),
    )
    .for("update");
  const onHand = lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
  if (onHand < cases) {
    throw new SurplusRequestError("Freezer finished-case stock is lower than the requested adjustment.", 409);
  }
  let casesToRemove = cases;
  for (const lot of lots) {
    if (casesToRemove <= 0) break;
    const removed = Math.min(lot.qtyRemaining, casesToRemove);
    if (removed <= 0) continue;
    await tx
      .update(inventoryLotsTable)
      .set({ qtyRemaining: lot.qtyRemaining - removed })
      .where(eq(inventoryLotsTable.id, lot.id));
    await tx.insert(inventoryLedgerTable).values({
      scope,
      itemId,
      lotId: lot.id,
      type: "adjust",
      qtyDelta: -removed,
      runId: null,
      note,
    });
    casesToRemove -= removed;
  }
  if (casesToRemove > 0) {
    throw new SurplusRequestError("Freezer finished-case stock changed while applying the adjustment.", 409);
  }
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

function toApiAdjustment(
  row: FreezerSurplusAdjustmentRow,
): FreezerSurplusAdjustment {
  return {
    eventId: row.eventId,
    lotId: row.lotId,
    eventType: row.eventType as FreezerSurplusAdjustment["eventType"],
    cases: row.cases,
    reason: row.reason,
    actorId: row.actorId,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.correctsEventId ? { correctsEventId: row.correctsEventId } : {}),
    createdAt: row.createdAt.toISOString(),
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

async function listAdjustments(executor: { select: typeof db.select } = db) {
  const rows = await executor
    .select()
    .from(freezerSurplusAdjustmentsTable)
    .where(eq(freezerSurplusAdjustmentsTable.scope, currentScope()))
    .orderBy(desc(freezerSurplusAdjustmentsTable.id))
    .limit(500);
  return rows.reverse().map(toApiAdjustment);
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

router.get(
  "/freezer-surplus/adjustments",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    try {
      res.json({ adjustments: await listAdjustments() });
    } catch (err) {
      req.log.error({ err }, "freezer_surplus_adjustment_history_failed");
      res.status(500).json({ error: "Couldn't load finished-case adjustment history" });
    }
  },
);

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

router.post(
  "/freezer-surplus/lots/:lotId/adjustments",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const path = RecordFreezerSurplusAdjustmentParams.safeParse(req.params);
    const parsed = RecordFreezerSurplusAdjustmentBody.safeParse(req.body);
    if (!path.success || !parsed.success) {
      res.status(400).json({ error: "Invalid finished-case freezer adjustment." });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Authentication is required to adjust freezer stock." });
      return;
    }

    const lotId = path.data.lotId.trim();
    const { eventId, eventType, cases } = parsed.data;
    const reason = parsed.data.reason.trim();
    const runId = parsed.data.runId?.trim() || undefined;
    const correctsEventId = parsed.data.correctsEventId;
    if (
      !lotId ||
      !reason ||
      (parsed.data.runId !== undefined && !runId) ||
      (eventType === "damage" && (runId !== undefined || correctsEventId !== undefined)) ||
      (eventType === "return" && (!runId || correctsEventId !== undefined)) ||
      (eventType === "correction" && (runId !== undefined || !correctsEventId))
    ) {
      res.status(400).json({ error: "The adjustment fields do not match the selected event type." });
      return;
    }

    const scope = currentScope();
    const actorId = req.userId;
    try {
      const result = await db.transaction(async (tx) => {
        // Serialize retries by stable event identity, even if a malformed client
        // retries the same key against a different lot.
        const idempotencyLock = `freezer-surplus-adjustment:${scope}:${eventId}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLock}, 0))`,
        );

        const [priorEvent] = await tx
          .select()
          .from(freezerSurplusAdjustmentsTable)
          .where(
            and(
              eq(freezerSurplusAdjustmentsTable.scope, scope),
              eq(freezerSurplusAdjustmentsTable.eventId, eventId),
            ),
          )
          .limit(1);
        if (priorEvent) {
          const sameRequest =
            priorEvent.lotId === lotId &&
            priorEvent.eventType === eventType &&
            priorEvent.cases === cases &&
            priorEvent.reason === reason &&
            priorEvent.runId === (runId ?? null) &&
            priorEvent.correctsEventId === (correctsEventId ?? null) &&
            priorEvent.actorId === actorId;
          if (!sameRequest) {
            throw new SurplusRequestError("This event ID was already used for a different adjustment.", 409);
          }
          return {
            ledger: await listLedger(tx),
            event: priorEvent,
            replayed: true,
          };
        }

        let returnAllocations: FreezerSurplusAllocationRow[] = [];
        let runRows: Array<{ data: unknown }> = [];
        if (eventType === "return") {
          // Match the allocation route's lock set and ordering before locking a
          // lot, so run state/allocation changes cannot race this return.
          [returnAllocations, runRows] = await Promise.all([
            tx
              .select()
              .from(freezerSurplusAllocationsTable)
              .where(
                and(
                  eq(freezerSurplusAllocationsTable.scope, scope),
                  eq(freezerSurplusAllocationsTable.runId, runId!),
                ),
              )
              .for("update"),
            tx
              .select({ data: dailySyncTable.data })
              .from(dailySyncTable)
              .where(eq(dailySyncTable.scope, scope))
              .for("update"),
          ]);
        }

        const [lot] = await tx
          .select()
          .from(freezerSurplusLotsTable)
          .where(
            and(
              eq(freezerSurplusLotsTable.scope, scope),
              eq(freezerSurplusLotsTable.id, lotId),
            ),
          )
          .for("update")
          .limit(1);
        if (!lot) throw new SurplusRequestError("The dated freezer lot is unavailable.", 404);

        const [item] = await tx
          .select({ id: inventoryItemsTable.id })
          .from(inventoryItemsTable)
          .where(
            and(
              eq(inventoryItemsTable.key, finishedItemKey(lot.brand, lot.flavor)),
              eq(inventoryItemsTable.scope, scope),
            ),
          )
          .limit(1);
        const freezerLocationId = await getFreezerLocationId(tx, scope);
        if (freezerLocationId == null) {
          throw new SurplusRequestError("A freezer inventory location is required before adjusting cases.", 409);
        }
        const inventoryItem = item ?? (
          eventType === "return" ||
          (eventType === "correction" && parsed.data.correctsEventId !== undefined)
            ? await ensureFinishedInventoryItem(tx, scope, lot.brand, lot.flavor)
            : null
        );

        const lotAdjustments = await tx
          .select()
          .from(freezerSurplusAdjustmentsTable)
          .where(
            and(
              eq(freezerSurplusAdjustmentsTable.scope, scope),
              eq(freezerSurplusAdjustmentsTable.lotId, lotId),
            ),
          )
          .for("update");

        let stockDirection: 1 | -1;
        let linkedRunId: string | null = null;
        if (eventType === "damage") {
          stockDirection = -1;
        } else if (eventType === "return") {
          const run = runRows
            .flatMap((row) => {
              const raw = row.data as { dayState?: { runs?: unknown[] } } | null;
              return Array.isArray(raw?.dayState?.runs) ? raw.dayState.runs : [];
            })
            .find(
              (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                (candidate as { id?: unknown }).id === runId,
            ) as { startedAt?: unknown; endedAt?: unknown } | undefined;
          if (!run?.startedAt && !run?.endedAt) {
            throw new SurplusRequestError("A return requires a run that has started or finished.", 409);
          }
          const allocation = returnAllocations.find((candidate) => candidate.lotId === lotId);
          if (!allocation) {
            throw new SurplusRequestError("The run has no allocation from this dated freezer lot.", 409);
          }
          const priorReturns = lotAdjustments.filter(
            (entry) => entry.eventType === "return" && entry.runId === runId,
          );
          const priorReturnIds = new Set(priorReturns.map((entry) => entry.eventId));
          const returnedCases = priorReturns.reduce((sum, entry) => sum + entry.cases, 0);
          const correctedCases = lotAdjustments
            .filter(
              (entry) =>
                entry.eventType === "correction" &&
                entry.correctsEventId !== null &&
                priorReturnIds.has(entry.correctsEventId),
            )
            .reduce((sum, entry) => sum + entry.cases, 0);
          const stillReturned = returnedCases - correctedCases;
          if (cases > allocation.cases - stillReturned) {
            throw new SurplusRequestError("The return exceeds this run's unreturned allocation from the lot.", 409);
          }
          stockDirection = 1;
          linkedRunId = runId!;
        } else {
          const original = lotAdjustments.find((entry) => entry.eventId === correctsEventId);
          if (!original || original.eventType === "correction") {
            throw new SurplusRequestError("A correction must reference a damage or return event from this lot.", 409);
          }
          const alreadyCorrected = lotAdjustments
            .filter(
              (entry) =>
                entry.eventType === "correction" &&
                entry.correctsEventId === original.eventId,
            )
            .reduce((sum, entry) => sum + entry.cases, 0);
          if (cases > original.cases - alreadyCorrected) {
            throw new SurplusRequestError("The correction exceeds the original event's uncorrected cases.", 409);
          }
          stockDirection = original.eventType === "damage" ? 1 : -1;
        }

        const newRemainingCases = lot.remainingCases + stockDirection * cases;
        if (newRemainingCases < 0) {
          throw new SurplusRequestError("The damage exceeds cases currently available in this dated lot.", 409);
        }
        if (newRemainingCases > lot.totalCases) {
          throw new SurplusRequestError("The adjustment would exceed the original cases in this dated lot.", 409);
        }
        if (!inventoryItem && stockDirection < 0) {
          throw new SurplusRequestError("Finished-case inventory is not available for this freezer lot.", 409);
        }

        await tx
          .update(freezerSurplusLotsTable)
          .set({ remainingCases: newRemainingCases, updatedAt: new Date() })
          .where(
            and(
              eq(freezerSurplusLotsTable.id, lotId),
              eq(freezerSurplusLotsTable.scope, scope),
            ),
          );

        if (stockDirection > 0) {
          const restoredItem =
            inventoryItem ?? await ensureFinishedInventoryItem(tx, scope, lot.brand, lot.flavor);
          await addFinishedInventoryStock(
            tx,
            scope,
            restoredItem.id,
            freezerLocationId,
            cases,
            eventType === "correction"
              ? `Finished-case adjustment correction: ${reason}`
              : `Finished-case return: ${reason}`,
          );
        } else {
          await removeFinishedInventoryStock(
            tx,
            scope,
            inventoryItem!.id,
            freezerLocationId,
            cases,
            eventType === "correction"
              ? `Finished-case adjustment correction: ${reason}`
              : `Finished-case damage: ${reason}`,
          );
        }

        const [event] = await tx
          .insert(freezerSurplusAdjustmentsTable)
          .values({
            scope,
            eventId,
            lotId,
            eventType,
            cases,
            reason,
            runId: linkedRunId,
            correctsEventId: correctsEventId ?? null,
            actorId,
          })
          .returning();
        if (!event) throw new Error("Freezer adjustment event insert returned no row");
        return {
          ledger: await listLedger(tx),
          event,
          replayed: false,
        };
      });

      req.log.info(
        { operation: "adjust", scope, lotId, eventId, eventType, cases },
        "freezer_surplus_operation",
      );
      res
        .status(result.replayed ? 200 : 201)
        .json({ ...result.ledger, createdAdjustment: toApiAdjustment(result.event) });
    } catch (err) {
      if (err instanceof SurplusRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err, operation: "adjust", scope, lotId, eventId }, "freezer_surplus_operation_failed");
      res.status(500).json({ error: "Couldn't adjust finished-case freezer stock. Try again." });
    }
  },
);

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
        const selectionIsUnchanged =
          existingAllocations.length === requested.size &&
          oldByLot.size === requested.size &&
          [...requested].every(([lotId, cases]) => oldByLot.get(lotId) === cases) &&
          existingAllocations.every(
            (allocation) =>
              allocation.runDate === runDate &&
              allocation.productKey === product.productKey &&
              allocation.brand === product.brand &&
              allocation.flavor === product.flavor,
          );
        if (selectionIsUnchanged) return listLedger(tx);

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