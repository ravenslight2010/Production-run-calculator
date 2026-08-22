import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Persisted snapshots of the recurring master-data audit. The report is a
// snapshot (not a source of truth), so a failed or partial scan never changes
// any master-data row.
export const masterDataHealthScansTable = pgTable("master_data_health_scans", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  environment: text("environment").notNull().default("live"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull().default("completed"),
  report: jsonb("report").notNull().default({}),
}, (table) => ({
  scopeCompletedIdx: index("master_data_health_scans_scope_completed_idx").on(table.scope, table.completedAt),
}));

export type MasterDataHealthScan = typeof masterDataHealthScansTable.$inferSelect;