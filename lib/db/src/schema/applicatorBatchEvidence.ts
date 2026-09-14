import { sql } from "drizzle-orm";
import { integer, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Append-only physical applicator evidence. Automatic rows are the server's
 * accepted progress observations; manager rows attest to the final physical
 * count. Corrections are new manager rows, never updates to an old row.
 */
export const applicatorBatchEvidenceTable = pgTable(
  "applicator_batch_evidence",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    operationId: text("operation_id").notNull(),
    date: text("date").notNull(),
    runId: text("run_id").notNull(),
    slot: integer("slot").notNull(),
    source: text("source").notNull(),
    observedTotal: integer("observed_total"),
    confirmedTotal: integer("confirmed_total"),
    correctionOf: text("correction_of"),
    evidenceHash: text("evidence_hash").notNull(),
    hashContract: text("hash_contract").notNull().default("canonical-json-v1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applicator_batch_evidence_scope_operation_idx").on(t.scope, t.operationId),
    index("applicator_batch_evidence_scope_run_slot_idx").on(t.scope, t.date, t.runId, t.slot),
    // Exactly one initial manager attestation may win a concurrent first
    // finalization. Corrections deliberately use a different source and remain
    // append-only rows, so they do not collide with this chain head.
    uniqueIndex("applicator_batch_evidence_scope_final_head_idx")
      .on(t.scope, t.date, t.runId, t.slot)
      .where(sql`${t.source} = 'manager-finalization'`),
    // A correction may have only one successor. This prevents two concurrent
    // requests from branching the immutable manager-confirmation chain.
    uniqueIndex("applicator_batch_evidence_scope_correction_edge_idx")
      .on(t.scope, t.correctionOf)
      .where(sql`${t.correctionOf} is not null`),
  ],
);

export type ApplicatorBatchEvidence = typeof applicatorBatchEvidenceTable.$inferSelect;