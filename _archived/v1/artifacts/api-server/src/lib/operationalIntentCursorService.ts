import {
  dailySyncTable,
  db,
  operationalIntentLedgerTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Scope } from "./requestScope";
import { emptySyncData, syncSnapshotId } from "./syncContract";

export const OPERATIONAL_INTENT_CURSOR_PAGE_SIZE = 100;

export type OperationalIntentCursorReceipt = {
  cursor: number;
  date: string;
  outcome: string;
  commandType: string;
  actorId: string;
  deviceId: string;
  baseRevision: number;
  canonicalRevision: number;
  serverReceivedAt: Date;
  createdAt: Date;
};

export type OperationalIntentCursorMaterialization = {
  date: string;
  data: unknown;
};

export type OperationalIntentCursorReader = {
  readReceipts(
    scope: Scope,
    after: number,
    limit: number,
  ): Promise<OperationalIntentCursorReceipt[]>;
  readMaterializedSnapshots(
    scope: Scope,
    dates: string[],
  ): Promise<OperationalIntentCursorMaterialization[]>;
};

const databaseReader: OperationalIntentCursorReader = {
  readReceipts: async (scope, after, limit) => db.select({
    cursor: operationalIntentLedgerTable.sequence,
    date: operationalIntentLedgerTable.date,
    outcome: operationalIntentLedgerTable.outcome,
    commandType: operationalIntentLedgerTable.commandType,
    actorId: operationalIntentLedgerTable.actorId,
    deviceId: operationalIntentLedgerTable.deviceId,
    baseRevision: operationalIntentLedgerTable.baseRevision,
    canonicalRevision: operationalIntentLedgerTable.canonicalRevision,
    serverReceivedAt: operationalIntentLedgerTable.serverReceivedAt,
    createdAt: operationalIntentLedgerTable.createdAt,
  }).from(operationalIntentLedgerTable)
    .where(and(
      eq(operationalIntentLedgerTable.scope, scope),
      gt(operationalIntentLedgerTable.sequence, after),
    ))
    .orderBy(asc(operationalIntentLedgerTable.sequence))
    .limit(limit),
  readMaterializedSnapshots: async (scope, dates) => dates.length
    ? db.select({ date: dailySyncTable.date, data: dailySyncTable.data })
      .from(dailySyncTable)
      .where(and(
        eq(dailySyncTable.scope, scope),
        inArray(dailySyncTable.date, dates),
      ))
    : [],
};

export type OperationalIntentCursorPage = {
  cursor: number;
  hasMore: boolean;
  mutations: Array<OperationalIntentCursorReceipt & {
    snapshot: unknown | null;
    materializedSnapshotId: string | null;
  }>;
};

const ADOPTABLE_OUTCOMES = new Set(["accepted", "superseded", "rebased"]);

/**
 * Read a bounded, scope-fenced receipt page and project adoptable outcomes to
 * the latest materialized snapshot for each date. Include that identical
 * snapshot only once per date in the page; all receipt cursors still advance.
 * Historical receipt snapshots are never replayed as operations.
 */
export async function readOperationalIntentCursorPage(
  scope: Scope,
  after: number,
  reader: OperationalIntentCursorReader = databaseReader,
): Promise<OperationalIntentCursorPage> {
  const rows = await reader.readReceipts(scope, after, OPERATIONAL_INTENT_CURSOR_PAGE_SIZE);
  // Recovery is monotonic across pages: every adoptable receipt for a date in
  // this page points at its current materialization, not retained history.
  const dates = [...new Set(rows.map((row) => row.date))];
  const materialized = await reader.readMaterializedSnapshots(scope, dates);
  const byDate = new Map(materialized.map((row) => [row.date, row.data]));
  const lastAdoptableIndexByDate = new Map<string, number>();
  rows.forEach((row, index) => {
    if (ADOPTABLE_OUTCOMES.has(row.outcome)) lastAdoptableIndexByDate.set(row.date, index);
  });

  return {
    cursor: rows.length ? rows[rows.length - 1]!.cursor : after,
    hasMore: rows.length === OPERATIONAL_INTENT_CURSOR_PAGE_SIZE,
    mutations: rows.map((row, index) => {
      const includeSnapshot = lastAdoptableIndexByDate.get(row.date) === index;
      const snapshot = includeSnapshot ? byDate.get(row.date) ?? emptySyncData(row.date) : null;
      return {
        ...row,
        snapshot,
        materializedSnapshotId: snapshot ? syncSnapshotId(snapshot) : null,
      };
    }),
  };
}
