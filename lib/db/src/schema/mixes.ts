import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Mirrors MixComponent in @workspace/mixes; defined locally so the DB layer
// stays dependency-free (the freezer-pull schema follows the same convention).
type MixComponentRow = { ingredient: string; perPizza: number };

// Manager-defined, factory-wide pre-blended "mixes" (a veggie/topping mix, a
// cheese mix, a sauce mix, …) that the floor makes ahead of time for a given
// product. Like production rules and freezer-pull items, these are global policy
// (not per-day state), so they live in their own relational table and are NOT
// part of the per-day sync payload. The shape is flat (plus a components jsonb
// array) and mirrors the Mix wire format in @workspace/mixes. `id` is a
// client-generated stable id so upserts are idempotent. `scope` isolates the
// sandbox account's mixes from live, enforced by a unique index (id, scope)
// rather than a composite PRIMARY KEY so the change stays purely additive and
// push-force-safe (see productionRules / freezerPullItems for the same rationale).
export const mixesTable = pgTable(
  "mixes",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    brand: text("brand").notNull().default(""),
    flavor: text("flavor").notNull().default(""),
    batchSize: real("batch_size").notNull().default(0),
    daysEarly: integer("days_early").notNull().default(0),
    notes: text("notes").notNull().default(""),
    amountAlreadyMade: real("amount_already_made").notNull().default(0),
    components: jsonb("components").notNull().default([]).$type<MixComponentRow[]>(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mixes_id_scope_idx").on(t.id, t.scope)],
);

export type MixRow = typeof mixesTable.$inferSelect;
