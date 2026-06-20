import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Learned import aliases. When a user confirms a non-exact match of an imported
// brand/flavor name to a saved (canonical) one during an Excel import, that
// mapping is persisted here so FUTURE imports auto-apply it instantly — no AI
// call needed, and shared factory-wide across all signed-in users (operators
// included). Unlike the per-day `daily_sync` JSONB blob, aliases are a running
// lookup that spans days, so they live in their own relational table.
//
// `externalName` is the imported (raw) name and `canonicalName` is the saved
// name it resolves to. Matching is case-insensitive (done in the route/clients).
// For flavor aliases `brandContext` holds the canonical parent brand so the same
// imported flavor under different brands can resolve differently; it is null for
// brand aliases.
export const importAliasesTable = pgTable("import_aliases", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // "brand" | "flavor"
  externalName: text("external_name").notNull(),
  canonicalName: text("canonical_name").notNull(),
  brandContext: text("brand_context"), // null for brands; canonical parent brand for flavors
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportAliasSchema = createInsertSchema(importAliasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertImportAlias = z.infer<typeof insertImportAliasSchema>;
export type ImportAlias = typeof importAliasesTable.$inferSelect;
