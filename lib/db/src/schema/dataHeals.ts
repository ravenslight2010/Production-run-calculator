import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One-time server-side data heals. Each heal is a targeted, code-shipped data
// correction that must run EXACTLY ONCE per database (dev and production each
// have their own copy of this table, so a heal applies to each environment the
// first time that environment boots with the code that defines it). The row's
// `id` is the heal's stable name; its presence means "already applied — skip".
//
// This exists because the production database is not hand-editable: bad rows
// created through the app (e.g. poisoned learned import matches) can only be
// corrected by shipping code, and that code must not re-run on every boot.
// Purely additive table — safe for `db push-force` on a populated database.
// A NULL result means the heal ran before result tracking was added (or was a
// deliberate no-op marker); historical rows may be annotated by the
// result-backfill heal with approximate current-state counts.
export const dataHealsTable = pgTable("data_heals", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  result: jsonb("result"),
});

export type DataHeal = typeof dataHealsTable.$inferSelect;

export const dataHealthRepairBatchesTable = pgTable("data_health_repair_batches", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  actor: text("actor").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  status: text("status").notNull().default("applied"),
  records: jsonb("records").notNull().default([]),
  summary: jsonb("summary").notNull().default({}),
}, (table) => ({
  scopeAppliedIdx: index("data_health_repair_batches_scope_applied_idx").on(table.scope, table.appliedAt),
}));

export type DataHealthRepairBatch = typeof dataHealthRepairBatchesTable.$inferSelect;
