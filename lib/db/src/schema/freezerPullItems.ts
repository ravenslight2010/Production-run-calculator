import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Manager-defined, factory-wide freezer-pull items. Like production rules, these
// are global policy (which ingredients must be pulled from the freezer ahead of
// the run that uses them, and how many days early), so they live in their own
// relational table and are NOT part of the per-day sync payload. The shape is
// flat and mirrors the FreezerPullItem wire format in @workspace/freezer-pull.
// `id` is a client-generated stable id so upserts are idempotent. `scope`
// isolates the sandbox account's items from live, enforced by a unique index
// (id, scope) rather than a composite PRIMARY KEY so the change stays purely
// additive and push-force-safe (see productionRules for the same rationale).
export const freezerPullItemsTable = pgTable(
  "freezer_pull_items",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    ingredient: text("ingredient").notNull(),
    daysEarly: integer("days_early").notNull().default(3),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("freezer_pull_items_id_scope_idx").on(t.id, t.scope)],
);

export type FreezerPullItemRow = typeof freezerPullItemsTable.$inferSelect;
