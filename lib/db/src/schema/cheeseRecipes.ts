import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Mirrors CheeseComponent in @workspace/cheese-recipes; defined locally so the
// DB layer stays dependency-free (mixes / freezer-pull follow the same
// convention).
type CheeseComponentRow = { ingredient: string; lbs: number };

// Manager-defined, factory-wide cheese-mix recipes. Rebuilt to work like the
// Mixes master-data: a named cheese blend belongs to a customer (brand), carries
// the flavors it is assigned to (the "per-flavor assignment" lines on the Cheese
// Mix Recipe Specs sheet), the customer's cheese-shredder setting, an optional
// cellulose note, and a list of components — each an ingredient and its PER-BATCH
// pounds (cheese recipes are batch-ratio, unlike mixes which are per-pizza).
//
// Like production rules, freezer-pull items and mixes, these are global master
// data (not per-day state), so they live in their own relational table and are
// NOT part of the per-day sync payload. `id` is a client-generated stable id so
// upserts are idempotent. `scope` isolates the sandbox account from live via a
// unique index (id, scope) rather than a composite PRIMARY KEY, keeping the
// change purely additive and push-force-safe (see mixes for the same rationale).
export const cheeseRecipesTable = pgTable(
  "cheese_recipes",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    brand: text("brand").notNull().default(""),
    flavors: jsonb("flavors").notNull().default([]).$type<string[]>(),
    shredderSetting: text("shredder_setting").notNull().default(""),
    cellulose: text("cellulose").notNull().default(""),
    notes: text("notes").notNull().default(""),
    components: jsonb("components").notNull().default([]).$type<CheeseComponentRow[]>(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cheese_recipes_id_scope_idx").on(t.id, t.scope)],
);

export type CheeseRecipeRow = typeof cheeseRecipesTable.$inferSelect;
