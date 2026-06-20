import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Learned ingredient-merge aliases. When the user confirms a merge (folding one
// or more "source" ingredient names into a canonical "target"), each source ->
// target mapping is persisted here so the AI merge-suggester and the local
// "previously merged" suggestions can propose the same consolidation next time.
// Shared factory-wide across all signed-in users, exactly like learned
// spec-import aliases and photo aliases.
//
// Unlike spec-import aliases this table is FLAT (no kind/context): the mergeable
// universe is a single de-duplicated pool of ingredient + die names, matched
// case-insensitively on `externalName`. `externalName` is the merged-away name;
// `canonicalName` is the name that was kept.
export const mergeAliasesTable = pgTable("merge_aliases", {
  id: serial("id").primaryKey(),
  externalName: text("external_name").notNull(),
  canonicalName: text("canonical_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMergeAliasSchema = createInsertSchema(mergeAliasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMergeAlias = z.infer<typeof insertMergeAliasSchema>;
export type MergeAlias = typeof mergeAliasesTable.$inferSelect;
