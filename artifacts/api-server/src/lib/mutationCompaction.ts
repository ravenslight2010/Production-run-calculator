import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, operationalIntentLedgerTable } from "@workspace/db";
import type { Scope } from "./requestScope";

// Keep a small recent window of exact receipts for fast retry recovery. Older
// entries retain their id/outcome/cursor as the idempotency fence, while their
// heavy snapshot is compacted into the authoritative daily_sync read model.
export const OPERATIONAL_RECEIPT_SNAPSHOT_WINDOW = 200;

export async function compactOperationalIntentSnapshots(
  scope: Scope,
  keep = OPERATIONAL_RECEIPT_SNAPSHOT_WINDOW,
): Promise<{ compacted: number; retained: number }> {
  const recent = await db.select({ sequence: operationalIntentLedgerTable.sequence })
    .from(operationalIntentLedgerTable)
    .where(eq(operationalIntentLedgerTable.scope, scope))
    .orderBy(desc(operationalIntentLedgerTable.sequence))
    .limit(keep);
  const boundary = recent[recent.length - 1]?.sequence;
  if (boundary === undefined || recent.length < keep) return { compacted: 0, retained: recent.length };
  const compacted = await db.update(operationalIntentLedgerTable)
    .set({ snapshot: null })
    .where(and(
      eq(operationalIntentLedgerTable.scope, scope),
      lt(operationalIntentLedgerTable.sequence, boundary),
      // These outcomes are represented by the daily materialized read model.
      // Review/conflict/rejection snapshots are audit evidence, not disposable
      // compaction input, and must remain available for operator review.
      inArray(operationalIntentLedgerTable.outcome, ["accepted", "superseded", "rebased"]),
    ))
    .returning({ sequence: operationalIntentLedgerTable.sequence });
  return { compacted: compacted.length, retained: recent.length };
}