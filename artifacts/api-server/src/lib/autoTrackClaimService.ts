import {
  dailySyncTable,
  dataResetTable,
  db,
  operationalIntentLedgerTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Scope } from "./requestScope";
import {
  applyAutoTrackClaim,
  attachServerOwnedAutoTrackClaim,
  type AutoTrackClaim,
} from "./autoTrackCoordination";
import { emptySyncData } from "./syncContract";
import { appendSyncOutboxEvent } from "./syncOutbox";

type AutoTrackClaimTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AutoTrackClaimCommand = {
  actorId: string;
  deviceId: string;
  baseRevision: number;
  actionData: Record<string, unknown>;
};

export type AutoTrackClaimServiceInput = {
  scope: Scope;
  date: string;
  claim: AutoTrackClaim;
  suppliedEpoch: number;
  command: AutoTrackClaimCommand;
  senderId: string;
};

export type AutoTrackClaimServiceResult =
  ReturnType<typeof applyAutoTrackClaim> & {
    canonicalRevision: number;
    serverTime: number;
    duplicate: boolean;
    resetStale?: number;
  };

export type AutoTrackClaimServiceDependencies = {
  appendAutomaticApplicatorEvidence: (
    tx: AutoTrackClaimTransaction,
    args: {
      scope: string;
      date: string;
      runId: string;
      slot: number;
      observedTotal: number;
      eventId: string;
    },
  ) => Promise<void>;
  consumeSauceBarrelInTransaction: (
    tx: AutoTrackClaimTransaction,
    runId: string,
    barrelIndex: number,
    itemKey: string,
    qty: number,
    requireItem: boolean,
    eventId: string,
  ) => Promise<unknown>;
};

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Persist one automatic tracking claim. Keep the reset, day-state, and event
 * ledger row locks in this order: competing claims and retries depend on the
 * serialized canonical snapshot and its durable idempotency receipt.
 */
export async function executeAutoTrackClaim(
  input: AutoTrackClaimServiceInput,
  dependencies: AutoTrackClaimServiceDependencies,
): Promise<AutoTrackClaimServiceResult> {
  const { scope, date, claim, suppliedEpoch, command, senderId } = input;
  let result: AutoTrackClaimServiceResult | undefined;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      result = await db.transaction(async (tx) => {
        const serverTime = Date.now();
        await tx.insert(dataResetTable)
          .values({ scope, epoch: 0, resetAt: new Date(serverTime) })
          .onConflictDoNothing();
        const [reset] = await tx.select().from(dataResetTable)
          .where(eq(dataResetTable.scope, scope)).for("update");
        const [existing] = await tx.select().from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
          .for("update");
        const commandId = `auto-track:${claim.eventId}`;
        const [seen] = await tx.select().from(operationalIntentLedgerTable)
          .where(and(
            eq(operationalIntentLedgerTable.scope, scope),
            eq(operationalIntentLedgerTable.date, date),
            eq(operationalIntentLedgerTable.intentId, commandId),
          ))
          .for("update");

        if (seen) {
          // The receipt proves exactly-once delivery, not ownership of today's
          // baseline. A later correction must survive an old claim retry.
          const snapshot = (existing?.data ?? emptySyncData(date)) as Record<string, unknown>;
          const channelState = (
            (snapshot as any).autoTrackCoordination?.runs?.[claim.runId]?.[claim.channel] ?? {
              generation: claim.generation,
              sequence: claim.sequence,
              nextDueAt: claim.nextDueAt,
              updatedAt: seen.serverReceivedAt.getTime(),
            }
          ) as ReturnType<typeof applyAutoTrackClaim>["channelState"];
          const values = ((snapshot as any).runValues?.[claim.runId] ?? {}) as Record<string, unknown>;
          return {
            data: snapshot,
            outcome: (seen.outcome === "accepted" ? "duplicate" : seen.outcome) as
              ReturnType<typeof applyAutoTrackClaim>["outcome"],
            channelState,
            values,
            canonicalRevision: existing?.canonicalRevision ?? 0,
            serverTime: Date.now(),
            duplicate: true,
            ...(seen.outcome === "stale" ? { resetStale: reset?.epoch ?? 0 } : {}),
          };
        }

        if (!Number.isSafeInteger(suppliedEpoch) || suppliedEpoch < 0
          || (reset?.epoch ?? 0) !== suppliedEpoch) {
          const canonicalRevision = (existing?.canonicalRevision ?? 0) + 1;
          const snapshot = (existing?.data ?? emptySyncData(date)) as Record<string, unknown>;
          if (existing) {
            await tx.update(dailySyncTable)
              .set({ canonicalRevision, updatedAt: new Date(serverTime) })
              .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
          } else {
            await tx.insert(dailySyncTable).values({
              scope,
              date,
              data: snapshot as any,
              canonicalRevision,
              updatedAt: new Date(serverTime),
            });
          }
          await tx.insert(operationalIntentLedgerTable).values({
            scope,
            date,
            intentId: commandId,
            outcome: "stale",
            snapshot: snapshot as any,
            commandType: "auto-track",
            actorId: command.actorId,
            deviceId: command.deviceId,
            baseRevision: command.baseRevision,
            canonicalRevision,
            actionData: command.actionData,
            serverReceivedAt: new Date(serverTime),
          });
          return {
            data: snapshot,
            outcome: "stale" as const,
            channelState: {
              generation: claim.generation,
              sequence: 0,
              nextDueAt: claim.nextDueAt,
              updatedAt: serverTime,
            },
            values: {},
            canonicalRevision,
            serverTime,
            duplicate: false,
            resetStale: reset?.epoch ?? 0,
          };
        }

        const applied = applyAutoTrackClaim(existing?.data ?? emptySyncData(date), claim);
        const canonicalData = applied.outcome === "accepted"
          ? attachServerOwnedAutoTrackClaim(applied.data, claim, applied.channelState.updatedAt)
          : applied.data;
        if (applied.outcome === "accepted" && /^app[1-4]-batch$/.test(claim.channel)) {
          const mutation = claim.mutations.find((candidate) => /^app[1-4]BatchesMade$/.test(candidate.field));
          if (mutation) {
            await dependencies.appendAutomaticApplicatorEvidence(tx, {
              scope,
              date,
              runId: claim.runId,
              slot: Number(claim.channel[3]),
              observedTotal: mutation.to,
              eventId: claim.eventId,
            });
          }
        }
        if (applied.outcome === "accepted" && applied.inventoryConsumption?.kind === "sauce-barrel") {
          const consumption = applied.inventoryConsumption;
          await dependencies.consumeSauceBarrelInTransaction(
            tx,
            consumption.runId,
            consumption.barrelIndex,
            consumption.itemKey,
            consumption.qty,
            true,
            consumption.eventId,
          );
        }

        const canonicalRevision = (existing?.canonicalRevision ?? 0) + 1;
        if (existing) {
          await tx.update(dailySyncTable)
            .set({ data: canonicalData as any, canonicalRevision, updatedAt: new Date(serverTime) })
            .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
        } else {
          await tx.insert(dailySyncTable)
            .values({ date, scope, data: canonicalData as any, canonicalRevision, updatedAt: new Date(serverTime) });
        }
        await tx.insert(operationalIntentLedgerTable).values({
          scope,
          date,
          intentId: commandId,
          outcome: applied.outcome,
          snapshot: canonicalData as any,
          commandType: "auto-track",
          actorId: command.actorId,
          deviceId: command.deviceId,
          baseRevision: command.baseRevision,
          canonicalRevision,
          actionData: command.actionData,
          serverReceivedAt: new Date(serverTime),
        });
        if (applied.outcome === "accepted") {
          await appendSyncOutboxEvent(tx, {
            kind: "day-state",
            scope,
            date,
            senderId,
            canonicalRevision,
          });
        }
        return { ...applied, data: canonicalData, canonicalRevision, serverTime, duplicate: false };
      });
      break;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }

  if (!result) throw new Error("Auto-track claim did not complete");
  return result;
}
