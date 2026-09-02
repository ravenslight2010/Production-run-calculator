import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Factory-wide ingredient catalog (Task #102). Ingredients used to be plain
// names carried in each device's synced list (`ingredientTypes`,
// `cheeseIngredients`, `doughIngredients`, `frontlineIngredients`,
// `mixIngredients`, `pepTypes`) with a fragile `mergedAway`/`deletedItems`
// tombstone dance to stop renamed/deleted names from resurrecting via the
// additive sync union. This table promotes that catalog to a single
// server-managed source of truth with stable ids: renaming/merging/deleting an
// ingredient is now a server operation instead of a per-device blob rewrite.
//
// `categories` records which recipe surfaces the ingredient applies to (any of
// "cheese" | "dough" | "frontline" | "mix" | "pep" | "general") so each app can
// still build the same category-scoped picker lists it used to build from the
// separate synced lists.
//
// `mergedInto` implements server-side merges: merging ingredient A into B sets
// A.mergedInto = B.id (and A.enabled = false) instead of deleting A, so any
// recipe row that still references A's id resolves to B by following the
// pointer (see @workspace/ingredient-catalog `resolveActiveIngredient`).
// Deletes are soft (`enabled: false`) for the same reason — a deleted
// ingredient's id may still be referenced by historical recipe rows and must
// keep resolving to a display name rather than silently vanishing.
//
// `id` is a client-generated stable id (upserts are idempotent), mirroring the
// mixes/cheese-recipes precedent. `scope` isolates the sandbox account,
// enforced by a unique index (id, scope) rather than a composite PRIMARY KEY so
// the change stays purely additive and push-force-safe.
export type IngredientCategory =
  | "cheese"
  | "dough"
  | "frontline"
  | "mix"
  | "pep"
  | "general";

export const ingredientsTable = pgTable(
  "ingredients",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    categories: jsonb("categories").notNull().default([]).$type<IngredientCategory[]>(),
    mergedInto: text("merged_into"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingredients_id_scope_idx").on(t.id, t.scope),
    // The active-name unique index is intentionally deferred for the first
    // stage of the duplicate-data rollout. Production schema changes run
    // before boot-time heals, so the existing duplicates must be soft-merged
    // and verified live before this protection can be restored.
  ],
);

export type IngredientRow = typeof ingredientsTable.$inferSelect;
