import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Finalized reports are an audit record, not a working document.  There are no
// mutable columns: a period can be finalized once per scope and retries return
// that original record rather than replacing it.
export const finalizedOperationalReportsTable = pgTable(
  "finalized_operational_reports",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    reportScope: text("report_scope").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    generatedBy: text("generated_by").notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull(),
    finalizedBy: text("finalized_by").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("finalized_operational_reports_scope_period_idx").on(
      t.scope, t.reportScope, t.periodStart, t.periodEnd,
    ),
  ],
);

export type FinalizedOperationalReport = typeof finalizedOperationalReportsTable.$inferSelect;