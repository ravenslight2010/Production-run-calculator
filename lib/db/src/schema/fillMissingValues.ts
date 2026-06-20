import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Learned "fill in missing data" values. When a user confirms a value for a
// blank run-setup field in the Fill Missing panel, that choice is persisted here
// keyed by the run's product (brand + flavor) and the field. FUTURE scans of the
// same product propose the remembered value as a new highest-priority "learned"
// source — no AI call needed, and shared factory-wide across all signed-in users
// (operators included), the same way learned import aliases work.
//
// Matching is case-insensitive on brand + flavor (done in the route/clients).
// `value` is always stored as a string (a plain number for number fields), the
// same shape the AI suggestion endpoint returns, so clients coerce identically.
export const fillMissingValuesTable = pgTable("fill_missing_values", {
  id: serial("id").primaryKey(),
  brand: text("brand").notNull(),
  flavor: text("flavor").notNull(),
  fieldKey: text("field_key").notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFillMissingValueSchema = createInsertSchema(fillMissingValuesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFillMissingValue = z.infer<typeof insertFillMissingValueSchema>;
export type FillMissingValue = typeof fillMissingValuesTable.$inferSelect;
