import { jsonb, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/** Non-expiring idempotency fence for offline production commands. */
export const operationalIntentLedgerTable = pgTable("operational_intent_ledger", {
  // This monotonically increasing cursor is the compacted-operation feed.  The
  // daily_sync document remains the materialized read model; clients do not
  // need to replay an unbounded command history to recover it.
  // Additive cursor only: this table already exists in populated deployments
  // with its idempotency unique key. Do not replace/add a primary key during a
  // rolling schema update. PostgreSQL's serial sequence supplies increasing
  // values for newly compacted receipts.
  sequence: serial("sequence").notNull(),
  scope: text("scope").notNull(),
  date: text("date").notNull(),
  intentId: text("intent_id").notNull(),
  outcome: text("outcome").notNull(),
  snapshot: jsonb("snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("operational_intent_ledger_scope_date_id_idx").on(t.scope, t.date, t.intentId),
  index("operational_intent_ledger_scope_sequence_idx").on(t.scope, t.sequence),
]);
