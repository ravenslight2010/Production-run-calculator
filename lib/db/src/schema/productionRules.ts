import {
  pgTable,
  text,
  boolean,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

// Manager-defined, factory-wide production rules. Unlike per-day run data (the
// daily_sync JSONB blob), rules are global policy that applies across days, so
// they live in their own relational table and are NOT part of the sync payload.
// The shape is flat (one nullable column per type-specific setting) to mirror
// the flat ProductionRule wire format in @workspace/production-rules. `id` is a
// client-generated stable id so upserts are idempotent.
export const productionRulesTable = pgTable("production_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "required-field" | "numeric-range" | "sequence"
  enforcement: text("enforcement").notNull(), // "flexible" | "strict"
  enabled: boolean("enabled").notNull().default(true),
  // required-field / numeric-range
  field: text("field"),
  // numeric-range (null means "no bound on this side")
  min: doublePrecision("min"),
  max: doublePrecision("max"),
  // sequence
  attribute: text("attribute"),
  before: text("before"),
  after: text("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductionRuleRow = typeof productionRulesTable.$inferSelect;
