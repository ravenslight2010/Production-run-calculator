import {
  dailySyncTable,
  db,
  freezerAlertProjectionStatusTable,
  freezerAlertRunProjectionTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, notExists, sql } from "drizzle-orm";

type ProjectionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const BACKFILL_PAGE_SIZE = 100;

const MAX_FREEZER_PROJECTION_AUDIT_DATES = 100;
const MAX_FREEZER_PROJECTION_AUDIT_FINDINGS = 100;

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

type ProjectionFact = ReturnType<typeof projectionRows>[number];
type ProjectionFactField = "startedAt" | "endedAt" | "freezerTime" | "dueAt" | "isActive";

export type FreezerAlertProjectionAuditFinding =
  | { kind: "missing"; scope: string; date: string; runId: string; expected: ProjectionFact }
  | { kind: "extra"; scope: string; date: string; runId: string; actual: ProjectionFact }
  | {
      kind: "mismatch";
      scope: string;
      date: string;
      runId: string;
      fields: ProjectionFactField[];
      expected: ProjectionFact;
      actual: ProjectionFact;
    };

export type FreezerAlertProjectionAuditResult = {
  scope: string;
  dates: string[];
  examinedDays: number;
  counts: { missing: number; extra: number; mismatch: number };
  findings: FreezerAlertProjectionAuditFinding[];
  truncated: boolean;
};

function validAuditDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Compare the compact alert projection with canonical snapshots for explicit
 * dates. This diagnostic is read-only: it never repairs, backfills, or marks a
 * scope complete. Date and finding limits keep both database reads and reports
 * bounded for operational use.
 */
export async function auditFreezerAlertProjection(
  scope: string,
  dates: readonly string[],
  options: { maxFindings?: number } = {},
): Promise<FreezerAlertProjectionAuditResult> {
  if (typeof scope !== "string" || !scope.trim() || scope.length > 128) {
    throw new TypeError("scope must be a non-empty string of at most 128 characters");
  }
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_FREEZER_PROJECTION_AUDIT_DATES) {
    throw new RangeError(`dates must contain between 1 and ${MAX_FREEZER_PROJECTION_AUDIT_DATES} dates`);
  }
  const selectedDates = [...dates];
  if (selectedDates.some((date) => !validAuditDate(date))) {
    throw new TypeError("every audit date must be a valid YYYY-MM-DD calendar date");
  }
  if (new Set(selectedDates).size !== selectedDates.length) {
    throw new TypeError("audit dates must be unique");
  }

  const maxFindings = options.maxFindings ?? MAX_FREEZER_PROJECTION_AUDIT_FINDINGS;
  if (!Number.isInteger(maxFindings) || maxFindings < 0 || maxFindings > MAX_FREEZER_PROJECTION_AUDIT_FINDINGS) {
    throw new RangeError(`maxFindings must be an integer between 0 and ${MAX_FREEZER_PROJECTION_AUDIT_FINDINGS}`);
  }

  const [canonicalRows, projectionRowsForDates] = await Promise.all([
    db.select({ date: dailySyncTable.date, data: dailySyncTable.data })
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.scope, scope), inArray(dailySyncTable.date, selectedDates))),
    db.select({
      date: freezerAlertRunProjectionTable.date,
      runId: freezerAlertRunProjectionTable.runId,
      startedAt: freezerAlertRunProjectionTable.startedAt,
      endedAt: freezerAlertRunProjectionTable.endedAt,
      freezerTime: freezerAlertRunProjectionTable.freezerTime,
      dueAt: freezerAlertRunProjectionTable.dueAt,
      isActive: freezerAlertRunProjectionTable.isActive,
    })
      .from(freezerAlertRunProjectionTable)
      .where(and(
        eq(freezerAlertRunProjectionTable.scope, scope),
        inArray(freezerAlertRunProjectionTable.date, selectedDates),
      )),
  ]);

  const expectedByDate = new Map<string, Map<string, ProjectionFact>>();
  for (const date of selectedDates) expectedByDate.set(date, new Map());
  for (const row of canonicalRows) {
    const expected = expectedByDate.get(row.date)!;
    for (const fact of projectionRows(scope, row.date, row.data)) expected.set(fact.runId, fact);
  }

  const actualByDate = new Map<string, Map<string, ProjectionFact>>();
  for (const date of selectedDates) actualByDate.set(date, new Map());
  for (const row of projectionRowsForDates) {
    actualByDate.get(row.date)!.set(row.runId, { scope, ...row });
  }

  const counts = { missing: 0, extra: 0, mismatch: 0 };
  const findings: FreezerAlertProjectionAuditFinding[] = [];
  const addFinding = (finding: FreezerAlertProjectionAuditFinding) => {
    counts[finding.kind]++;
    if (findings.length < maxFindings) findings.push(finding);
  };

  for (const date of selectedDates) {
    const expected = expectedByDate.get(date)!;
    const actual = actualByDate.get(date)!;
    for (const [runId, expectedFact] of expected) {
      const actualFact = actual.get(runId);
      if (!actualFact) {
        addFinding({ kind: "missing", scope, date, runId, expected: expectedFact });
        continue;
      }
      const fields = (["startedAt", "endedAt", "freezerTime", "dueAt", "isActive"] as const)
        .filter((field) => !Object.is(expectedFact[field], actualFact[field]));
      if (fields.length) {
        addFinding({ kind: "mismatch", scope, date, runId, fields: [...fields], expected: expectedFact, actual: actualFact });
      }
    }
    for (const [runId, actualFact] of actual) {
      if (!expected.has(runId)) addFinding({ kind: "extra", scope, date, runId, actual: actualFact });
    }
  }

  return {
    scope,
    dates: selectedDates,
    examinedDays: selectedDates.length,
    counts,
    findings,
    truncated: findings.length < counts.missing + counts.extra + counts.mismatch,
  };
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

function sortedProjectionRows(
  rows: ReturnType<typeof projectionRows>,
): ReturnType<typeof projectionRows> {
  return [...rows].sort((left, right) => left.runId.localeCompare(right.runId));
}

async function verifyFreezerAlertProjectionParity(scope: string): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const days = await db.select({
      date: dailySyncTable.date,
      data: dailySyncTable.data,
    }).from(dailySyncTable)
      .where(cursor === undefined
        ? eq(dailySyncTable.scope, scope)
        : and(eq(dailySyncTable.scope, scope), gt(dailySyncTable.date, cursor)))
      .orderBy(asc(dailySyncTable.date))
      .limit(BACKFILL_PAGE_SIZE);
    if (!days.length) break;

    const dates = days.map((day) => day.date);
    const actualRows = await db.select({
      scope: freezerAlertRunProjectionTable.scope,
      date: freezerAlertRunProjectionTable.date,
      runId: freezerAlertRunProjectionTable.runId,
      startedAt: freezerAlertRunProjectionTable.startedAt,
      endedAt: freezerAlertRunProjectionTable.endedAt,
      freezerTime: freezerAlertRunProjectionTable.freezerTime,
      dueAt: freezerAlertRunProjectionTable.dueAt,
      isActive: freezerAlertRunProjectionTable.isActive,
    }).from(freezerAlertRunProjectionTable)
      .where(and(
        eq(freezerAlertRunProjectionTable.scope, scope),
        inArray(freezerAlertRunProjectionTable.date, dates),
      ))
      .orderBy(
        asc(freezerAlertRunProjectionTable.date),
        asc(freezerAlertRunProjectionTable.runId),
      );
    const actualByDate = new Map<string, typeof actualRows>();
    for (const row of actualRows) {
      const rows = actualByDate.get(row.date) ?? [];
      rows.push(row);
      actualByDate.set(row.date, rows);
    }

    for (const day of days) {
      const expected = sortedProjectionRows(projectionRows(scope, day.date, day.data));
      const actual = actualByDate.get(day.date) ?? [];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new Error(
          `Freezer alert projection parity check failed for scope ${scope} on ${day.date}.`,
        );
      }
    }

    cursor = days[days.length - 1]!.date;
  }

  const [orphanedProjection] = await db.select({
    date: freezerAlertRunProjectionTable.date,
  }).from(freezerAlertRunProjectionTable)
    .where(and(
      eq(freezerAlertRunProjectionTable.scope, scope),
      notExists(
        db.select({ one: sql`1` }).from(dailySyncTable)
          .where(and(
            eq(dailySyncTable.scope, scope),
            eq(dailySyncTable.date, freezerAlertRunProjectionTable.date),
          )),
      ),
    ))
    .limit(1);

  if (orphanedProjection) {
    throw new Error(
      `Freezer alert projection parity check found an orphaned date for scope ${scope}.`,
    );
  }
}

/**
 * Backfill existing scoped snapshots in bounded per-day transactions.
 * Completion is marked only after persisted rows match every canonical
 * snapshot and no projection rows exist without a corresponding snapshot.
 * This is intentionally explicit; it is not called at application startup.
 */
export async function backfillFreezerAlertProjection(scope: string): Promise<{
  examinedDays: number;
  projectedRuns: number;
}> {
  // Keep scheduled reads on the safe JSONB path if a rerun fails partway.
  await db.delete(freezerAlertProjectionStatusTable)
    .where(eq(freezerAlertProjectionStatusTable.scope, scope));

  let examinedDays = 0;
  let projectedRuns = 0;
  let cursor: string | undefined;

  while (true) {
    const days = await db.select({ date: dailySyncTable.date })
      .from(dailySyncTable)
      .where(cursor === undefined
        ? eq(dailySyncTable.scope, scope)
        : and(eq(dailySyncTable.scope, scope), gt(dailySyncTable.date, cursor)))
      .orderBy(asc(dailySyncTable.date))
      .limit(BACKFILL_PAGE_SIZE);
    if (!days.length) break;

    for (const { date } of days) {
      const count = await db.transaction(async (tx) => {
        const [row] = await tx.select({ data: dailySyncTable.data })
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, date)))
          .for("update");
        if (!row) return null;
        await replaceFreezerAlertProjection(tx, scope, date, row.data);
        return projectionRows(scope, date, row.data).length;
      });
      if (count === null) continue;
      examinedDays++;
      projectedRuns += count;
    }

    cursor = days[days.length - 1]!.date;
  }

  await verifyFreezerAlertProjectionParity(scope);
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
