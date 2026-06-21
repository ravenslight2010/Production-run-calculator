import { pgTable, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_sync_date_scope_idx").on(t.date, t.scope)],
);

export type DailySync = typeof dailySyncTable.$inferSelect;
