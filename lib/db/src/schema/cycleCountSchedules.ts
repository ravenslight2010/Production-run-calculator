import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Manager-defined, factory-wide cycle-count schedules. Like production rules and
// freezer-pull items, these are global policy (which warehouse sections to count
// and how often), so they live in their own relational table and are NOT part of
// the per-day sync payload. The shape is flat and mirrors the
// CycleCountSchedule wire format in @workspace/cycle-count. `id` is a
// client-generated stable id so upserts are idempotent. `last_counted_at` is a
// YYYY-MM-DD string stamped when a section is marked counted (nullable = never
// counted). `scope` isolates the sandbox account's schedules from live, enforced
// by a unique index (id, scope) rather than a composite PRIMARY KEY so the
// change stays purely additive and push-force-safe (see productionRules /
// freezerPullItems for the same rationale).
export const cycleCountSchedulesTable = pgTable(
  "cycle_count_schedules",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    section: text("section").notNull(),
    cadenceDays: integer("cadence_days").notNull().default(7),
    lastCountedAt: text("last_counted_at"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cycle_count_schedules_id_scope_idx").on(t.id, t.scope)],
);

export type CycleCountScheduleRow = typeof cycleCountSchedulesTable.$inferSelect;
