import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Factory-wide die-type master list. Die types used to live only in browser
// storage and ride the day-state sync payload, so a factory data reset (or a
// cleared browser) could lose custom dies — the profile self-heal only
// recovers dies still referenced by a profile. Like the other master-data
// pools (freezer-pull items, dough/sauce recipes), the list now lives in its
// own relational table and is NOT part of the per-day sync payload, so it
// survives resets and fresh devices. `id` is the case-folded canonical name
// (stable, so upserts are idempotent); `name` keeps the display spelling.
// `scope` isolates the sandbox account's dies from live, enforced by a unique
// index (id, scope) rather than a composite PRIMARY KEY so the change stays
// purely additive and push-force-safe (see productionRules for the rationale).
export const dieTypesTable = pgTable(
  "die_types",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("die_types_id_scope_idx").on(t.id, t.scope)],
);

export type DieTypeRow = typeof dieTypesTable.$inferSelect;
