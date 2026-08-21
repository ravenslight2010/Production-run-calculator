import { pgTable, serial, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/** Bounded, sanitized audit records for workbook imports. */
export const importHistoryTable = pgTable(
  "import_history",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    importType: text("import_type").notNull(),
    sourceKey: text("source_key"),
    sourceLabel: text("source_label").notNull(),
    customerScope: text("customer_scope"),
    status: text("status").notNull(),
    summary: jsonb("summary").notNull(),
    snapshotId: text("snapshot_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("import_history_scope_created_idx").on(t.scope, t.createdAt),
  }),
);

export type ImportHistoryRow = typeof importHistoryTable.$inferSelect;