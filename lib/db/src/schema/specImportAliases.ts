import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Learned spec-sheet-import aliases. When the Excel spec-sheet importer (with AI
// help) resolves a messy label from an uploaded workbook to one of the app's
// canonical names, that mapping is persisted here so FUTURE imports auto-apply
// the remembered match — making the AI step cheaper and the results consistent.
// Shared factory-wide across all signed-in users, exactly like learned Excel
// import aliases and photo aliases.
//
// `kind` is which name-space the mapping lives in (brand, flavor, applicator
// type, pepperoni type, or a recipe ingredient list). `externalName` is the raw
// label from the spreadsheet (matched case-insensitively); `canonicalName` is
// the app's saved name it resolves to; `context` disambiguates within a kind
// (e.g. the canonical brand for a flavor alias), null when not needed. `scope`
// isolates the sandbox account's aliases from live.
export const specImportAliasesTable = pgTable("spec_import_aliases", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  kind: text("kind").notNull(),
  externalName: text("external_name").notNull(),
  canonicalName: text("canonical_name").notNull(),
  context: text("context"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSpecImportAliasSchema = createInsertSchema(specImportAliasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSpecImportAlias = z.infer<typeof insertSpecImportAliasSchema>;
export type SpecImportAlias = typeof specImportAliasesTable.$inferSelect;
