import { pgTable, serial, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

// Learned per-ingredient batch weights. Mixes and cheese recipes carry their
// own batch weight (the sum of their recipe rows), but plain ingredients
// (applicator toppings, non-default pep types, ready-made sauces) only have a
// manually typed "Batch Weight (lbs)" field. When a user enters one, it is
// remembered here keyed by the ingredient name so the next time anyone picks
// that ingredient the weight auto-fills — "the weight follows the ingredient",
// factory-wide, the same way learned fill-missing values work.
//
// Matching is case-insensitive on name (done in the route/clients). `scope`
// isolates the sandbox account's learned weights from live.
export const ingredientBatchWeightsTable = pgTable("ingredient_batch_weights", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  name: text("name").notNull(),
  lbs: doublePrecision("lbs").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IngredientBatchWeight = typeof ingredientBatchWeightsTable.$inferSelect;
