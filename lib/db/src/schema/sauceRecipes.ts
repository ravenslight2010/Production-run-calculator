import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Mirrors NamedRecipeComponent in @workspace/named-recipes; defined locally so
// the DB layer stays dependency-free (mixes / cheese-recipes follow the same
// convention).
type NamedRecipeComponentRow = { ingredient: string; lbs: number };

// Manager-defined, factory-wide SAUCE (frontline) recipes. Rebuilt to work like
// the Mixes / Cheese Recipes master-data: a sauce recipe is just a name plus a
// list of components — each an ingredient and its pounds. Like cheese/mixes it
// carries an optional display-only brand/flavor tag ("who it goes to"): `brand`
// is the customer, `flavors` the products it's used on (empty + brand set = all
// varieties; empty brand = shared/untagged). Both columns are ADDITIVE with
// defaults so the change is push-force-safe on the populated table.
//
// Like the other master-data tables, these are global (not per-day state), so
// they live in their own relational table and are NOT part of the per-day sync
// payload. `id` is a client-generated stable id so upserts are idempotent.
// `scope` isolates the sandbox account from live via a unique index (id, scope)
// rather than a composite PRIMARY KEY, keeping the change purely additive and
// push-force-safe (see mixes for the same rationale).
export const sauceRecipesTable = pgTable(
  "sauce_recipes",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    components: jsonb("components").notNull().default([]).$type<NamedRecipeComponentRow[]>(),
    enabled: boolean("enabled").notNull().default(true),
    brand: text("brand").notNull().default(""),
    flavors: jsonb("flavors").notNull().default([]).$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sauce_recipes_id_scope_idx").on(t.id, t.scope)],
);

export type SauceRecipeRow = typeof sauceRecipesTable.$inferSelect;
