import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Non-expiring idempotency fence for offline production commands. */
export const operationalIntentLedgerTable = pgTable("operational_intent_ledger", {
  scope: text("scope").notNull(),
  date: text("date").notNull(),
  intentId: text("intent_id").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("operational_intent_ledger_scope_date_id_idx").on(t.scope, t.date, t.intentId)]);