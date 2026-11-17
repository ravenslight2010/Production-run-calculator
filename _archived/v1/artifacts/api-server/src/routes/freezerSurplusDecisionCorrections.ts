import { randomUUID } from "node:crypto";
import type { IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, freezerSurplusConfirmationsTable as confirmations,
  freezerSurplusDecisionCorrectionsTable as corrections,
  freezerSurplusLotsTable as lots, freezerSurplusAdjustmentsTable as adjustments,
  freezerSurplusAllocationsTable as allocations,
  type FreezerSurplusConfirmationRow,
} from "@workspace/db";
import { CorrectFreezerSurplusDecisionBody } from "@workspace/api-zod";
import { isValidSurplusDate, surplusProductKey } from "@workspace/freezer-pull";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

type Helpers = Pick<typeof import("./freezerSurplus"),
  "SurplusRequestError" | "ensureFinishedInventoryItem" | "getFreezerLocationId" |
  "addFinishedInventoryStock" | "removeFinishedInventoryStock" | "toApiConfirmation">;
type Executor = Pick<typeof db, "select">;
type DecisionState = Awaited<ReturnType<typeof readDecision>>;

async function readDecision(executor: Executor, scope: string, runId: string, h: Helpers) {
  const [original] = await executor.select().from(confirmations)
    .where(and(eq(confirmations.scope, scope), eq(confirmations.runId, runId))).limit(1);
  if (!original) throw new h.SurplusRequestError("This surplus decision is unavailable in the current scope.", 404);
  const history = await executor.select().from(corrections)
    .where(and(eq(corrections.scope, scope), eq(corrections.confirmationId, original.id)))
    .orderBy(desc(corrections.id)).limit(500);
  const latest = history[0];
  return {
    original,
    current: latest ? {
      ...original, cases: latest.cases, productionDate: latest.productionDate, lotId: latest.lotId,
    } : original,
    revision: latest?.eventId ?? original.id,
    lotIds: latest
      ? Array.isArray(latest.lotIds)
        ? latest.lotIds
        : latest.lotId ? [latest.lotId] : []
      : original.lotId ? [original.lotId] : [],
    history,
  };
}

function serialize(decision: Awaited<ReturnType<typeof readDecision>>, h: Helpers) {
  return {
    original: h.toApiConfirmation(decision.original),
    current: h.toApiConfirmation(decision.current),
    revision: decision.revision,
    corrections: decision.history.map((row) => ({
      eventId: row.eventId, previousRevision: row.previousRevision, cases: row.cases,
      productionDate: row.productionDate, lotId: row.lotId, lotIds: row.lotIds, reason: row.reason,
      actorId: row.actorId, createdAt: row.createdAt.toISOString(),
    })),
  };
}

export function registerSurplusDecisionCorrections(router: IRouter, h: Helpers) {
  const route = "/freezer-surplus/confirmations/:runId/corrections";
  router.get(route, requireCapability("manage-inventory"), async (req, res) => {
    try {
      const runId = String(req.params.runId);
      if (!runId.trim() || runId.length > 120) {
        throw new h.SurplusRequestError("Choose a valid completed run.");
      }
      // A single read transaction gives the original and latest correction a
      // consistent snapshot; no writes or historical run association occur.
      const decision = await readDecision(db, currentScope(), runId, h);
      res.json(serialize(decision, h));
    } catch (err) {
      if (err instanceof h.SurplusRequestError) {
        res.status(err.status).json({ error: err.message });
      } else {
        req.log.error({ err }, "freezer_surplus_decision_read_failed");
        res.status(500).json({ error: "Couldn't load the surplus decision. Try again." });
      }
    }
  });

  router.post(route, requireCapability("manage-inventory"), async (req, res) => {
    const parsed = CorrectFreezerSurplusDecisionBody.safeParse(req.body);
    const runId = String(req.params.runId);
    if (!parsed.success || !runId.trim() || runId.length > 120) {
      res.status(400).json({ error: "Enter a valid run, correction ID, revision, whole-case count and reason." });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Sign in before correcting a surplus decision." });
      return;
    }
    const { eventId, previousRevision, cases } = parsed.data;
    const reason = parsed.data.reason.trim();
    const requestedDate = parsed.data.productionDate?.toISOString().slice(0, 10);
    const date = cases > 0 ? requestedDate ?? null : null;
    if (!reason || (cases > 0 && !isValidSurplusDate(date)) ||
        (cases === 0 && parsed.data.productionDate != null)) {
      res.status(400).json({ error: "Provide a reason and a valid production date for positive cases only." });
      return;
    }
    const scope = currentScope();
    try {
      const result = await db.transaction(async (tx) => {
        // Same lock as the immutable confirmation writer. Event identity is
        // also serialized across runs, before either receipt or stock changes.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"surplus-decision-event:" + scope}), hashtext(${eventId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"freezer-surplus-confirmation:" + scope}), hashtext(${runId}))`);
        const decision = await readDecision(tx, scope, runId, h);
        const [existing] = await tx.select().from(corrections)
          .where(and(eq(corrections.scope, scope), eq(corrections.eventId, eventId))).limit(1);
        if (existing) {
          if (existing.runId !== runId || existing.previousRevision !== previousRevision ||
              existing.cases !== cases || existing.productionDate !== date ||
              existing.reason !== reason || existing.actorId !== req.userId) {
            throw new h.SurplusRequestError("This correction ID was already used for a different request.", 409);
          }
          // Replay acknowledges this exact event even if a later correction
          // now exists. It must never reapply stock or claim the latest wins.
          return {
            replay: true,
            decision,
          };
        }
        if (decision.revision !== previousRevision) {
          throw new h.SurplusRequestError("This decision changed. Reload the saved decision before correcting it.", 409);
        }
        const before = decision.current;
        if (before.cases === cases && before.productionDate === date) {
          throw new h.SurplusRequestError("The corrected outcome is unchanged.", 409);
        }
        const previousLotIds = decision.lotIds;
        const stockLots = previousLotIds.length ? await tx.select().from(lots)
          .where(and(eq(lots.scope, scope), inArray(lots.id, previousLotIds)))
          .orderBy(lots.id).for("update") : [];
        if (before.cases > 0 &&
            (stockLots.length !== previousLotIds.length || stockLots.length === 0)) {
          throw new h.SurplusRequestError("The original dated stock is unavailable. No correction was applied.", 409);
        }
        const available = stockLots.reduce((sum, lot) => sum + lot.remainingCases, 0);
        const changingDate = before.cases > 0 && cases > 0 && before.productionDate !== date;
        if (changingDate) {
          for (const lot of stockLots) {
            const [allocation] = await tx.select({ id: allocations.id }).from(allocations)
              .where(and(eq(allocations.scope, scope), eq(allocations.lotId, lot.id))).limit(1);
            const [adjustment] = await tx.select({ id: adjustments.id }).from(adjustments)
              .where(and(eq(adjustments.scope, scope), eq(adjustments.lotId, lot.id))).limit(1);
            if (!lot.dateCorrectionSafe || allocation || adjustment) {
              throw new h.SurplusRequestError("The date cannot change after allocation or adjustment, or when allocation history is unknown.", 409);
            }
          }
          if (available !== before.cases) {
            throw new h.SurplusRequestError("The date cannot change when linked lot balances do not match the saved outcome.", 409);
          }
        }
        const remove = changingDate ? before.cases : Math.max(0, before.cases - cases);
        if (remove > 0 && available < remove) {
          throw new h.SurplusRequestError("This reduction would remove allocated, used, damaged or unavailable cases.", 409);
        }
        const location = await h.getFreezerLocationId(tx, scope);
        if (location === null) throw new h.SurplusRequestError("Set up a freezer storage location before correcting stock.", 409);
        const item = await h.ensureFinishedInventoryItem(
          tx, scope, before.brand, before.flavor, stockLots[0]?.inventoryItemId,
        );
        const note = `Surplus decision correction ${eventId}: ${reason}`;
        if (remove > 0) {
          await h.removeFinishedInventoryStock(tx, scope, item.id, location, remove, note);
        }
        const add = changingDate ? cases : Math.max(0, cases - before.cases);
        if (add > 0) await h.addFinishedInventoryStock(tx, scope, item.id, location, add, note);
        let lotsAfter = changingDate || before.cases === 0 ? [] : [...previousLotIds];
        if (remove > 0) {
          let remainingToRemove = remove;
          for (const lot of stockLots) {
            if (remainingToRemove <= 0) break;
            const removed = Math.min(lot.remainingCases, remainingToRemove);
            await tx.update(lots).set({
              remainingCases: lot.remainingCases - removed,
              dateCorrectionSafe: false,
              updatedAt: new Date(),
            }).where(and(eq(lots.scope, scope), eq(lots.id, lot.id)));
            remainingToRemove -= removed;
          }
          if (remainingToRemove !== 0) {
            throw new h.SurplusRequestError("Freezer lot balances changed while applying the correction.", 409);
          }
        }
        let newLotId: string | null = null;
        if (add > 0) {
          newLotId = randomUUID();
          await tx.insert(lots).values({
            id: newLotId, scope, brand: before.brand, flavor: before.flavor,
            productKey: surplusProductKey(before.brand, before.flavor),
            inventoryItemId: item.id, dateCorrectionSafe: false,
            productionDate: date!, totalCases: add, remainingCases: add,
          });
          lotsAfter.push(newLotId);
        }
        if (changingDate) {
          // Every previous lot was fully available and is now retained as an
          // exhausted historical lot; the replacement lot represents the
          // full corrected count at the new date.
          lotsAfter = newLotId ? [newLotId] : [];
        }
        if (cases === 0) lotsAfter = [];
        const lotId = cases === 0 ? null : newLotId ?? before.lotId ?? lotsAfter[0] ?? null;
        await tx.insert(corrections).values({
          scope, eventId, confirmationId: decision.original.id, runId, previousRevision,
          cases, productionDate: date, lotId, lotIds: lotsAfter, reason, actorId: req.userId!,
        });
        return { replay: false, decision: await readDecision(tx, scope, runId, h) as DecisionState };
      });
      res.status(result.replay ? 200 : 201).json(serialize(result.decision, h));
    } catch (err) {
      if (err instanceof h.SurplusRequestError) {
        res.status(err.status).json({ error: err.message });
      } else {
        req.log.error({ err, scope, runId, eventId }, "freezer_surplus_decision_correction_failed");
        res.status(500).json({ error: "Couldn't save the correction. Retry the same request to check its outcome." });
      }
    }
  });
}
