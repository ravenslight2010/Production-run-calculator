import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Denied (ignored) ingredient-merge pairs. When the user explicitly denies a
// merge suggestion, the unordered name pair is persisted here so the AI merge-
// suggester and the local "previously merged" suggestions never re-propose
// merging those two names together (in either direction). Shared factory-wide
// across all signed-in users, exactly like learned merge aliases — but with the
// opposite intent (suppress, not re-propose).
//
// The pair is stored normalized: `nameA` and `nameB` are lowercased+trimmed and
// sorted (nameA <= nameB) so a pair has one canonical row regardless of which
// name was the suggestion's target. A unique index dedupes the pair.
export const deniedMergesTable = pgTable(
  "denied_merges",
  {
    id: serial("id").primaryKey(),
    nameA: text("name_a").notNull(),
    nameB: text("name_b").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("denied_merges_pair_idx").on(t.nameA, t.nameB),
  }),
);

export const insertDeniedMergeSchema = createInsertSchema(deniedMergesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDeniedMerge = z.infer<typeof insertDeniedMergeSchema>;
export type DeniedMerge = typeof deniedMergesTable.$inferSelect;
