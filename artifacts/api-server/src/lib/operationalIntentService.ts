import { createHash, randomUUID } from "node:crypto";
import {
  completedRunHistoryTable,
  dailySyncTable,
  dataResetTable,
  db,
  operationalIntentLedgerTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Scope } from "./requestScope";
import { appendSyncOutboxEvent } from "./syncOutbox";
import { emptySyncData } from "./syncContract";
import { applyOperationalIntent, type OperationalIntent } from "./operationalIntents";
import { isExactOperationalCommandRetry } from "./operationalCommandIdentity";
import type { consumeRunInTransaction } from "../routes/inventory";

export type OperationalIntentCommand = {
  actorId: string;
  deviceId: string;
  baseRevision: number;
  actionData: Record<string, unknown>;
};

export type OperationalIntentTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OperationalIntentTransactionResult =
  ReturnType<typeof applyOperationalIntent> & {
    cursor?: number;
    canonicalRevision: number;
    serverTime: number;
  };

type ReconcileOperationalIntentInput = {
  intent: OperationalIntent;
  command: OperationalIntentCommand;
  scope: Scope;
  now: number;
  consumeRun: typeof consumeRunInTransaction;
};

/**
 * Apply one validated offline command under the caller's transaction.
 *
 * The route owns request validation, retry policy, transaction creation,
 * failure translation, and broadcast. This service owns only the atomic
 * reset-fenced reconciliation and durable receipt write.
 */
export async function reconcileOperationalIntentInTransaction(
  tx: OperationalIntentTransaction,
  { intent, command, scope, now, consumeRun }: ReconcileOperationalIntentInput,
): Promise<OperationalIntentTransactionResult> {
  const serverTime = Date.now();
  // Fence reset and intent under one transaction. A reset that wins
  // this lock makes the command review-required; it cannot resurrect
  // state between a preflight epoch read and the document write.
  await tx.insert(dataResetTable).values({ scope, epoch: 0, resetAt: new Date() })
    .onConflictDoNothing();
  const [reset] = await tx.select().from(dataResetTable)
    .where(eq(dataResetTable.scope, scope)).for("update");
  const [existing] = await tx.select().from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, intent.date), eq(dailySyncTable.scope, scope))).for("update");
  const [seen] = await tx.select().from(operationalIntentLedgerTable)
    .where(and(
      eq(operationalIntentLedgerTable.scope, scope),
      eq(operationalIntentLedgerTable.date, intent.date),
      eq(operationalIntentLedgerTable.intentId, intent.id),
    ))
    .for("update");

  // A duplicate returns the snapshot produced by its original transaction,
  // rather than whichever later command currently owns the daily document.
  if (seen && !isExactOperationalCommandRetry(seen, command)) return {
    // Do not disclose the old receipt or execute the substituted operation.
    // The ordinary conflict outcome retains the caller's local evidence.
    data: (existing?.data ?? emptySyncData(intent.date)) as Record<string, any>,
    outcome: "conflicted",
    duplicate: true,
    canonicalRevision: existing?.canonicalRevision ?? 0,
    serverTime,
  };
  if (seen) return {
    data: existing?.data ?? seen.snapshot ?? emptySyncData(intent.date),
    outcome: seen.outcome as ReturnType<typeof applyOperationalIntent>["outcome"],
    duplicate: true,
    cursor: seen.sequence,
    canonicalRevision: existing?.canonicalRevision ?? seen.canonicalRevision ?? 0,
    serverTime,
  };

  if ((reset?.epoch ?? 0) !== intent.resetEpoch) {
    const canonicalRevision = (existing?.canonicalRevision ?? 0) + 1;
    const snapshot = existing?.data ?? emptySyncData(intent.date);
    if (existing) {
      await tx.update(dailySyncTable)
        .set({ canonicalRevision, updatedAt: new Date(serverTime) })
        .where(and(eq(dailySyncTable.date, intent.date), eq(dailySyncTable.scope, scope)));
    } else {
      await tx.insert(dailySyncTable).values({
        scope,
        date: intent.date,
        data: snapshot as any,
        canonicalRevision,
        updatedAt: new Date(serverTime),
      });
    }
    const [receipt] = await tx.insert(operationalIntentLedgerTable).values({
      scope, date: intent.date, intentId: intent.id, outcome: "review-required",
      snapshot: snapshot as any,
      commandType: "operational-intent",
      actorId: command.actorId,
      deviceId: command.deviceId,
      baseRevision: command.baseRevision,
      canonicalRevision,
      actionData: command.actionData,
      serverReceivedAt: new Date(serverTime),
    }).returning({ sequence: operationalIntentLedgerTable.sequence });
    await appendSyncOutboxEvent(tx, {
      kind: "day-state",
      scope,
      date: intent.date,
      senderId: command.deviceId.slice(0, 160),
      canonicalRevision,
    });
    return {
      data: snapshot as Record<string, any>,
      outcome: "review-required",
      duplicate: false,
      cursor: receipt!.sequence,
      canonicalRevision,
      serverTime,
    };
  }

  const applied = applyOperationalIntent(existing?.data ?? emptySyncData(intent.date), intent, now, existing?.canonicalRevision ?? 0);
  applied.data.dayState = { ...applied.data.dayState, date: intent.date };
  if (
    applied.outcome === "accepted"
    && intent.action === "lifecycle"
    && intent.lifecycle === "end"
  ) {
    const [legacyCompletion] = await tx.select().from(completedRunHistoryTable).where(and(
      eq(completedRunHistoryTable.scope, scope),
      eq(completedRunHistoryTable.date, intent.date),
      eq(completedRunHistoryTable.runId, intent.runId),
    )).for("update");
    const lockedRun = (existing?.data as any)?.dayState?.runs?.find(
      (run: any) => run?.id === intent.runId,
    );
    const legacySnapshotRun = (legacyCompletion?.snapshot as any)?.dayState?.runs?.filter(
      (run: any) => run?.id === intent.runId,
    );
    const legacyAgeMs = legacyCompletion
      ? now - legacyCompletion.createdAt.getTime()
      : Number.POSITIVE_INFINITY;
    const compatibleLegacyCompletion = !!legacyCompletion
      && legacyCompletion.operationId === `completed:${intent.date}:${intent.runId}`
      && legacyAgeMs >= 0
      && legacyAgeMs <= 10 * 60_000
      && Array.isArray(legacySnapshotRun)
      && legacySnapshotRun.length === 1
      && Number(legacySnapshotRun[0].startedAt) === Number(lockedRun?.startedAt)
      && Number(legacySnapshotRun[0].endedAt) === legacyCompletion.completedAt.getTime()
      && legacyCompletion.completedAt.getTime() >= Number(lockedRun?.startedAt)
      && Math.abs(legacyCompletion.completedAt.getTime() - intent.effectiveAt) <= 10 * 60_000;
    // During the bounded migration window, an older client may have uploaded
    // immutable history just before its canonical End intent. Only that exact,
    // recently server-observed, fact-compatible record may bridge the window.
    if (compatibleLegacyCompletion) {
      applied.data.dayState = {
        ...applied.data.dayState,
        runs: (applied.data.dayState.runs as Array<Record<string, unknown>>).map((run) =>
          run.id === intent.runId
            ? { ...run, endedAt: legacyCompletion!.completedAt.getTime() }
            : run
        ),
      };
    } else if (legacyCompletion) {
      applied.data = (existing?.data ?? emptySyncData(intent.date)) as Record<string, any>;
      applied.outcome = "review-required";
    }
    if (applied.outcome === "accepted") {
      const snapshot = JSON.parse(JSON.stringify(applied.data, (_key, value) => value)) as Record<string, unknown>;
      const stable = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === "object") {
          return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, stable(child)]));
        }
        return value;
      };
      const canonicalSnapshot = stable(snapshot) as Record<string, unknown>;
      const snapshotHash = createHash("sha256").update(JSON.stringify(canonicalSnapshot)).digest("hex");
      const canonicalRun = (applied.data.dayState?.runs as Array<Record<string, unknown>>)
        .find((run) => run.id === intent.runId);
      const completedAt = Number(canonicalRun?.endedAt);
      if (!compatibleLegacyCompletion) {
        await tx.insert(completedRunHistoryTable).values({
          id: randomUUID(),
          scope,
          operationId: intent.id,
          runId: intent.runId,
          date: intent.date,
          completedAt: new Date(completedAt),
          snapshot: canonicalSnapshot,
          snapshotHash,
          actorId: command.actorId,
        });
      }
      await consumeRun(tx, intent.runId, intent.inventoryLines ?? []);
    }
  }

  const canonicalRevision = (existing?.canonicalRevision ?? 0) + 1;
  if (existing) {
    await tx.update(dailySyncTable).set({ data: applied.data as any, updatedAt: new Date() })
      .where(and(eq(dailySyncTable.date, intent.date), eq(dailySyncTable.scope, scope)));
  } else {
    await tx.insert(dailySyncTable).values({
      date: intent.date,
      scope,
      data: applied.data as any,
      canonicalRevision,
      updatedAt: new Date(),
    });
  }
  if (existing) {
    await tx.update(dailySyncTable)
      .set({ canonicalRevision, updatedAt: new Date() })
      .where(and(eq(dailySyncTable.date, intent.date), eq(dailySyncTable.scope, scope)));
  }
  const [receipt] = await tx.insert(operationalIntentLedgerTable).values({
    scope, date: intent.date, intentId: intent.id, outcome: applied.outcome,
    snapshot: applied.data as any,
    commandType: "operational-intent",
    actorId: command.actorId,
    deviceId: command.deviceId,
    baseRevision: command.baseRevision,
    canonicalRevision,
    actionData: command.actionData,
    serverReceivedAt: new Date(serverTime),
  }).returning({ sequence: operationalIntentLedgerTable.sequence });
  await appendSyncOutboxEvent(tx, {
    kind: "day-state",
    scope,
    date: intent.date,
    senderId: command.deviceId.slice(0, 160),
    canonicalRevision,
  });
  return { ...applied, cursor: receipt!.sequence, canonicalRevision, serverTime };
}
