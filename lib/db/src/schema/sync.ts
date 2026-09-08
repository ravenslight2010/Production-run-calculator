import { pgTable, text, jsonb, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Per-day run state, one JSONB blob per date. `scope` isolates the live factory
// data from the seeded sandbox account's copy, so a date has at most one row per
// scope. We enforce this with a unique index (date, scope) rather than a
// composite PRIMARY KEY: drizzle-kit push mis-orders DDL when a freshly-added
// column is placed inside primaryKey({columns}) (it emits SET NOT NULL before the
// column exists), which breaks the non-interactive push-force path. A unique
// index keeps the change purely additive and push-force-safe.
export const dailySyncTable = pgTable(
  "daily_sync",
  {
    date: text("date").notNull(),
    scope: text("scope").notNull().default("live"),
    data: jsonb("data").notNull(),
    // Server-owned command revision for this scoped production day. This is
    // separate from client edit stamps in the JSON document and advances only
    // while the row is locked by a command writer.
    canonicalRevision: numeric("canonical_revision", { precision: 16, scale: 0, mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_sync_date_scope_idx").on(t.date, t.scope)],
);

export type DailySync = typeof dailySyncTable.$inferSelect;

// Completed runs are deliberately separate from the mutable daily_sync document.
// A completion is append-only: the operation key makes retries idempotent while
// the scoped date/run key prevents a second device from replacing history.
export const completedRunHistoryTable = pgTable(
  "completed_run_history",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    operationId: text("operation_id").notNull(),
    runId: text("run_id").notNull(),
    date: text("date").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("completed_run_history_scope_operation_idx").on(t.scope, t.operationId),
    uniqueIndex("completed_run_history_scope_date_run_idx").on(t.scope, t.date, t.runId),
  ],
);

export type CompletedRunHistory = typeof completedRunHistoryTable.$inferSelect;
