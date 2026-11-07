import {
  dailySyncTable,
  db,
  freezerAlertProjectionStatusTable,
  freezerAlertRunProjectionTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";

type ProjectionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type SnapshotRun = {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  pausedAt?: unknown;
};

type Snapshot = {
  dayState?: { runs?: unknown };
  runValues?: Record<string, Record<string, unknown> | undefined>;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectionRows(scope: string, date: string, snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const data = snapshot as Snapshot;
  const runs = Array.isArray(data.dayState?.runs) ? data.dayState.runs as SnapshotRun[] : [];
  const seen = new Set<string>();
  const rows = [];

  for (const run of runs) {
    if (typeof run?.id !== "string" || seen.has(run.id)) continue;
    seen.add(run.id);

    const startedAt = finiteNumber(run.startedAt);
    const endedAt = finiteNumber(run.endedAt);
    const pausedAt = finiteNumber(run.pausedAt);
    const isActive = (startedAt ?? 0) > 0 && !(endedAt ?? 0) && !(pausedAt ?? 0);
    const freezerTime = finiteNumber(data.runValues?.[run.id]?.freezerTime);
    const dueAt = endedAt !== null && endedAt !== 0 && (freezerTime ?? 0) > 0
      ? endedAt + freezerTime! * 60_000
      : null;

    if (!isActive && dueAt === null) continue;
    rows.push({
      scope,
      date,
      runId: run.id,
      startedAt,
      endedAt,
      freezerTime: dueAt === null ? null : freezerTime,
      dueAt: dueAt !== null && Number.isFinite(dueAt) ? dueAt : null,
      isActive,
    });
  }

  return rows;
}

/**
 * Replace one day's compact alert projection from its canonical snapshot.
 * Call after the daily_sync write, using the same transaction handle.
 */
export async function replaceFreezerAlertProjection(
  tx: ProjectionTransaction,
  scope: string,
  date: string,
  snapshot: unknown,
): Promise<void> {
  await tx.delete(freezerAlertRunProjectionTable).where(and(
    eq(freezerAlertRunProjectionTable.scope, scope),
    eq(freezerAlertRunProjectionTable.date, date),
  ));

  const rows = projectionRows(scope, date, snapshot);
  if (rows.length) await tx.insert(freezerAlertRunProjectionTable).values(rows);
}

export async function deleteFreezerAlertProjection(
  tx: ProjectionTransaction,
  scope: string,
  date: string,
): Promise<void> {
  await tx.delete(freezerAlertRunProjectionTable).where(and(
    eq(freezerAlertRunProjectionTable.scope, scope),
    eq(freezerAlertRunProjectionTable.date, date),
  ));
}

export async function hasCompleteFreezerAlertProjection(scope: string): Promise<boolean> {
  const [row] = await db.select({ scope: freezerAlertProjectionStatusTable.scope })
    .from(freezerAlertProjectionStatusTable)
    .where(eq(freezerAlertProjectionStatusTable.scope, scope))
    .limit(1);
  return !!row;
}

/**
 * Backfill existing scoped snapshots in bounded per-day transactions.
 * This is intentionally explicit; it is not called at application startup.
 */
export async function backfillFreezerAlertProjection(scope: string): Promise<{
  examinedDays: number;
  projectedRuns: number;
}> {
  const days = await db.select({ date: dailySyncTable.date })
    .from(dailySyncTable)
    .where(eq(dailySyncTable.scope, scope))
    .orderBy(asc(dailySyncTable.date));
  let examinedDays = 0;
  let projectedRuns = 0;

  for (const { date } of days) {
    const count = await db.transaction(async (tx) => {
      const [row] = await tx.select({ data: dailySyncTable.data })
        .from(dailySyncTable)
        .where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date)))
        .for("update");
      if (!row) return 0;
      await replaceFreezerAlertProjection(tx, scope, date, row.data);
      return projectionRows(scope, date, row.data).length;
    });
    examinedDays++;
    projectedRuns += count;
  }

  await db.insert(freezerAlertProjectionStatusTable)
    .values({ scope, completedAt: new Date() })
    .onConflictDoUpdate({
      target: freezerAlertProjectionStatusTable.scope,
      set: { completedAt: new Date() },
    });

  return { examinedDays, projectedRuns };
}

export function freezerAlertProjectionRowsForSnapshot(
  scope: string,
  date: string,
  snapshot: unknown,
): ReturnType<typeof projectionRows> {
  return projectionRows(scope, date, snapshot);
}
