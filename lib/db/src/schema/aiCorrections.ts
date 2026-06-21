import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Shared cross-feature corrections memory. Whenever staff confirm a name
// correction in ANY AI helper (an ingredient merge, a spreadsheet brand/flavor
// match, a spec-sheet import label, a photo-identified item), the
// source -> canonical mapping is ALSO recorded here in one flat, factory-wide
// pool, tagged by `domain` (e.g. "ingredient", "brand", "flavor", "die",
// "item"). Every name-resolving AI prompt is fed this whole pool, so a
// correction learned in one helper is honored by all the others.
//
// Additive by design: each helper keeps its own specialized alias table
// (merge_aliases, import_aliases, ...); this is shared context layered on top.
// Matched case-insensitively on (domain, fromText); fromText is the messy
// name that was corrected, toText is the canonical name that was kept. `scope`
// isolates the sandbox account's corrections from live.
export const aiCorrectionsTable = pgTable("ai_corrections", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  domain: text("domain").notNull(),
  fromText: text("from_text").notNull(),
  toText: text("to_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiCorrectionSchema = createInsertSchema(aiCorrectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCorrection = z.infer<typeof insertAiCorrectionSchema>;
export type AiCorrectionRow = typeof aiCorrectionsTable.$inferSelect;
