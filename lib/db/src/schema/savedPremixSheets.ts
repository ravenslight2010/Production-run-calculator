import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Saved premix sheets. When the premix workbook importer commits an import, a
// snapshot of the parsed premix sheet (the Mix[] it declared) is saved here so
// the Mixes section can later reconcile the CURRENT mixes against it ("does each
// mix still match the premix sheet, and does a product need a new mix?"). Only
// the most recent two are kept (the route prunes older rows on insert). Shared
// factory-wide across all signed-in users, exactly like saved spec sheets.
// `scope` isolates the sandbox account from live.
export const savedPremixSheetsTable = pgTable("saved_premix_sheets", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  label: text("label").notNull(),
  // The Mix[] snapshot captured at import time.
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedPremixSheetRow = typeof savedPremixSheetsTable.$inferSelect;
