import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  mixesTable,
  mixSurplusAllocationsTable,
  mixSurplusLotsTable,
  type MixSurplusAllocationRow,
  type MixSurplusLotRow,
} from "@workspace/db";
import {
  RecordMixSurplusBody,
  ReplaceMixSurplusAllocationsBody,
  ReplaceMixSurplusAllocationsParams,
  type MixSurplusAllocation,
  type MixSurplusBalance,
  type MixSurplusLedger,
  type MixSurplusLot,
} from "@workspace/api-zod";
import { isValidSurplusDate } from "@workspace/freezer-pull";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();

class MixSurplusRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toApiLot(row: MixSurplusLotRow): MixSurplusLot {
  return {
    id: row.id,
    mixId: row.mixId,
    name: row.name,
    ...(row.brand ? { brand: row.brand } : {}),
    ...(row.flavor ? { flavor: row.flavor } : {}),
    ...(row.isPrep ? { isPrep: row.isPrep } : {}),
    productionDate: new Date(`${row.productionDate}T00:00:00Z`),
    location: row.location,
    amountMade: row.amountMade,
    amountUsed: row.amountUsed,
    amountRemaining: row.amountRemaining,
  };
}

function toApiAllocation(row: MixSurplusAllocationRow): MixSurplusAllocation {
  return {
    id: row.id,
    lotId: row.lotId,
    mixId: row.mixId,
    ...(row.runId ? { runId: row.runId } : {}),
    runDate: new Date(`${row.runDate}T00:00:00Z`),
    ...(row.brand ? { brand: row.brand } : {}),
    ...(row.flavor ? { flavor: row.flavor } : {}),
    ...(row.isPrep ? { isPrep: row.isPrep } : {}),
    amount: row.amount,
  };
}

async function listLedger(
  executor: { select: typeof db.select } = db,
): Promise<MixSurplusLedger> {
  const scope = currentScope();
  const [lotRows, allocationRows] = await Promise.all([
    executor
      .select()
      .from(mixSurplusLotsTable)
      .where(eq(mixSurplusLotsTable.scope, scope)),
    executor
      .select()
      .from(mixSurplusAllocationsTable)
      .where(eq(mixSurplusAllocationsTable.scope, scope)),
  ]);
  const byMix = new Map<string, { name: string; lbs: number; dates: Set<string> }>();
  for (const lot of lotRows) {
    if (lot.amountRemaining <= 0) continue;
    const cur = byMix.get(lot.mixId) ?? { name: lot.name, lbs: 0, dates: new Set<string>() };
    if (lot.name) cur.name = lot.name;
    cur.lbs = round2(cur.lbs + lot.amountRemaining);
    cur.dates.add(lot.productionDate);
    byMix.set(lot.mixId, cur);
  }
  const balances: MixSurplusBalance[] = [...byMix.entries()].map(([mixId, b]) => ({
    mixId,
    name: b.name,
    lbs: b.lbs,
    productionDates: [...b.dates].sort().map((d) => new Date(`${d}T00:00:00Z`)),
  }));
  return {
    lots: lotRows.map(toApiLot),
    allocations: allocationRows.map(toApiAllocation),
    balances,
  };
}

router.get("/mix-surplus", async (req: Request, res: Response) => {
  try {
    res.json(await listLedger());
  } catch (err) {
    req.log.error({ err }, "mix_surplus_list_failed");
    res.status(500).json({ error: "Couldn't load the mix surplus ledger" });
  }
});

router.post("/mix-surplus", requireCapability("manage-inventory"), async (req: Request, res: Response) => {
  const rawProductionDate =
    req.body && typeof req.body === "object"
      ? (req.body as { productionDate?: unknown }).productionDate
      : undefined;
  const parsed = RecordMixSurplusBody.safeParse(req.body);
  if (!parsed.success || !isValidSurplusDate(rawProductionDate)) {
    res.status(400).json({ error: "Invalid surplus record. Enter a mix and a positive amount." });
    return;
  }
  const scope = currentScope();
  try {
    const [mixRow] = await db
      .select()
      .from(mixesTable)
      .where(and(eq(mixesTable.id, parsed.data.mixId), eq(mixesTable.scope, scope)))
      .limit(1);
    if (!mixRow) {
      res.status(400).json({ error: "Unknown mix. Refresh and try again." });
      return;
    }
    const amountMade = round2(Math.max(0, parsed.data.amountMade));
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      // Same-date surplus for the same mix extends the existing dated lot
      // instead of duplicating (mirrors the day-start recording in
      // inventory.ts) so one mix + production date stays one lot.
      const [existing] = await tx
        .select()
        .from(mixSurplusLotsTable)
        .where(
          and(
            eq(mixSurplusLotsTable.scope, scope),
            eq(mixSurplusLotsTable.mixId, mixRow.id),
            eq(mixSurplusLotsTable.productionDate, rawProductionDate as string),
          ),
        )
        .for("update")
        .limit(1);
      let row: MixSurplusLotRow | undefined;
      if (existing) {
        [row] = await tx
          .update(mixSurplusLotsTable)
          .set({
            amountMade: round2(existing.amountMade + amountMade),
            amountRemaining: round2(existing.amountRemaining + amountMade),
            updatedAt: now,
          })
          .where(
            and(
              eq(mixSurplusLotsTable.id, existing.id),
              eq(mixSurplusLotsTable.scope, scope),
            ),
          )
          .returning();
      } else {
        [row] = await tx
          .insert(mixSurplusLotsTable)
          .values({
            id: randomUUID(),
            scope,
            mixId: mixRow.id,
            name: mixRow.name,
            brand: mixRow.brand,
            flavor: mixRow.flavor,
            isPrep: mixRow.isPrep,
            productionDate: rawProductionDate as string,
            amountMade,
            amountUsed: 0,
            amountRemaining: amountMade,
            location: "freezer",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      }
      if (!row) throw new Error("Mix surplus lot insert returned no row");
      return { row, ledger: await listLedger(tx) };
    });
    req.log.info(
      { operation: "record", scope, lotId: result.row.id, amountMade },
      "mix_surplus_operation",
    );
    res.status(201).json({ ...result.ledger, createdLot: toApiLot(result.row) });
  } catch (err) {
    req.log.error({ err, operation: "record", scope }, "mix_surplus_operation_failed");
    res.status(500).json({ error: "Couldn't save the mix surplus record. Try again." });
  }
});

router.put(
  "/mix-surplus/allocations/:runDate",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const rawRunDate = req.params.runDate;
    const path = ReplaceMixSurplusAllocationsParams.safeParse({
      runDate: new Date(`${rawRunDate}T00:00:00Z`),
    });
    const parsed = ReplaceMixSurplusAllocationsBody.safeParse(req.body);
    if (!path.success || !parsed.success || !isValidSurplusDate(rawRunDate)) {
      res.status(400).json({ error: "Invalid allocation. Enter a make-day and lot amounts." });
      return;
    }
    const runDate = rawRunDate;
    const scope = currentScope();
    const requested = new Map<string, number>();
    for (const selection of parsed.data.allocations) {
      const amount = round2(Math.max(0, selection.amount));
      if (!selection.lotId.trim()) {
        res.status(400).json({ error: "Each selected surplus lot needs an amount." });
        return;
      }
      requested.set(selection.lotId.trim(), (requested.get(selection.lotId.trim()) ?? 0) + amount);
    }
    try {
      const result = await db.transaction(async (tx) => {
        const existingAllocations = await tx
          .select()
          .from(mixSurplusAllocationsTable)
          .where(
            and(
              eq(mixSurplusAllocationsTable.scope, scope),
              eq(mixSurplusAllocationsTable.runDate, runDate),
            ),
          )
          .for("update");
        const oldByLot = new Map<string, number>();
        for (const allocation of existingAllocations) {
          oldByLot.set(allocation.lotId, (oldByLot.get(allocation.lotId) ?? 0) + allocation.amount);
        }
        const lotIds = [...new Set([...oldByLot.keys(), ...requested.keys()])];
        const lots = lotIds.length
          ? await tx
              .select()
              .from(mixSurplusLotsTable)
              .where(
                and(
                  eq(mixSurplusLotsTable.scope, scope),
                  inArray(mixSurplusLotsTable.id, lotIds),
                ),
              )
              .for("update")
          : [];
        const lotById = new Map(lots.map((lot) => [lot.id, lot]));
        for (const lotId of lotIds) {
          const lot = lotById.get(lotId);
          if (!lot) throw new MixSurplusRequestError("One selected surplus lot is no longer available.", 409);
          const oldAmt = oldByLot.get(lotId) ?? 0;
          const newAmt = requested.get(lotId) ?? 0;
          const availableAfterRelease = round2(lot.amountRemaining + oldAmt);
          if (newAmt > availableAfterRelease) {
            throw new MixSurplusRequestError(
              `${lot.name || "This mix"} has only ${availableAfterRelease} lbs available in that dated lot.`,
              409,
            );
          }
          const nextRemaining = round2(lot.amountRemaining + oldAmt - newAmt);
          const nextUsed = round2(Math.max(0, lot.amountUsed - oldAmt) + newAmt);
          await tx
            .update(mixSurplusLotsTable)
            .set({ amountRemaining: nextRemaining, amountUsed: nextUsed, updatedAt: new Date() })
            .where(
              and(
                eq(mixSurplusLotsTable.id, lotId),
                eq(mixSurplusLotsTable.scope, scope),
              ),
            );
          lot.amountRemaining = nextRemaining;
          lot.amountUsed = nextUsed;
        }
        if (existingAllocations.length > 0) {
          await tx
            .delete(mixSurplusAllocationsTable)
            .where(
              and(
                eq(mixSurplusAllocationsTable.runDate, runDate),
                eq(mixSurplusAllocationsTable.scope, scope),
              ),
            );
        }
        for (const [lotId, amount] of requested) {
          const lot = lotById.get(lotId);
          if (!lot || amount <= 0) continue;
          await tx.insert(mixSurplusAllocationsTable).values({
            id: `${runDate}:${lotId}`,
            scope,
            lotId,
            mixId: lot.mixId,
            runId: "",
            runDate,
            brand: lot.brand,
            flavor: lot.flavor,
            isPrep: lot.isPrep,
            amount,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return listLedger(tx);
      });
      req.log.info({ operation: "allocate", scope, runDate }, "mix_surplus_operation");
      res.json(result);
    } catch (err) {
      if (err instanceof MixSurplusRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err, operation: "allocate", scope }, "mix_surplus_operation_failed");
      res.status(500).json({ error: "Couldn't update the mix surplus allocation. Try again." });
    }
  },
);

router.delete(
  "/mix-surplus/lots/:id",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const rawLotId = req.params.id;
    if (typeof rawLotId !== "string" || !rawLotId.trim() || rawLotId.trim() === "undefined") {
      res.status(400).json({ error: "Invalid surplus lot." });
      return;
    }
    const lotId = rawLotId.trim();
    const scope = currentScope();
    try {
      const result = await db.transaction(async (tx) => {
        const [lot] = await tx
          .select()
          .from(mixSurplusLotsTable)
          .where(and(eq(mixSurplusLotsTable.id, lotId), eq(mixSurplusLotsTable.scope, scope)))
          .for("update")
          .limit(1);
        if (!lot || lot.amountRemaining <= 0) {
          throw new MixSurplusRequestError("Surplus lot not found or already voided.", 404);
        }
        // Amount committed via allocations is what the scalar reducer has applied
        // to the plan; voiding releases those pounds.
        const voided = lot.amountUsed;
        await tx
          .delete(mixSurplusAllocationsTable)
          .where(
            and(
              eq(mixSurplusAllocationsTable.lotId, lotId),
              eq(mixSurplusAllocationsTable.scope, scope),
            ),
          );
        await tx
          .update(mixSurplusLotsTable)
          .set({ amountRemaining: 0, updatedAt: new Date() })
          .where(
            and(
              eq(mixSurplusLotsTable.id, lotId),
              eq(mixSurplusLotsTable.scope, scope),
            ),
          );
        // Scalar sync: the mix's amountAlreadyMade reducer must stop counting
        // disposed surplus (ledger == scalar invariant).
        const [mixRow] = await tx
          .select({ amountAlreadyMade: mixesTable.amountAlreadyMade })
          .from(mixesTable)
          .where(and(eq(mixesTable.id, lot.mixId), eq(mixesTable.scope, scope)))
          .for("update")
          .limit(1);
        if (mixRow) {
          await tx
            .update(mixesTable)
            .set({
              amountAlreadyMade: round2(Math.max(0, mixRow.amountAlreadyMade - voided)),
              updatedAt: new Date(),
            })
            .where(and(eq(mixesTable.id, lot.mixId), eq(mixesTable.scope, scope)));
        }
        return listLedger(tx);
      });
      req.log.info({ operation: "void", scope, lotId }, "mix_surplus_operation");
      res.json(result);
    } catch (err) {
      if (err instanceof MixSurplusRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err, operation: "void", scope }, "mix_surplus_operation_failed");
      res.status(500).json({ error: "Couldn't void the mix surplus lot. Try again." });
    }
  },
);

export default router;
