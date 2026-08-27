import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Parsed Cheese Mix Recipe Specs retained after a reviewed import. The source
// is intentionally parsed data only: original workbook bytes are never stored.
// `scope` keeps sandbox data separate from live factory data.
export const savedCheeseSheetsTable = pgTable("saved_cheese_sheets", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  label: text("label").notNull(),
  // Normalized filename identity. Retention keeps two versions per workbook.
  sourceKey: text("source_key"),
  // Normalized CheeseRecipe[] parsed from the workbook.
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedCheeseSheetRow = typeof savedCheeseSheetsTable.$inferSelect;