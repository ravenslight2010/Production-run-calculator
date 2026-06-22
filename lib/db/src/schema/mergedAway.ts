import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Durable, factory-wide tombstone for merged-away ingredient/die names. When a
// user merges duplicate names, the source names are recorded here so they stay
// merged away across days and across every device — even one that was offline
// during the merge.
//
// Why this exists separately from the per-day sync blob: the `mergedAway` array
// used to live ONLY inside the per-day, whole-blob, last-write-wins sync row.
// That row is replaced wholesale on every PUT and a new day's row starts empty,
// so whichever device seeded the new day could reseed the old duplicate names
// (with an empty tombstone) and resurrect them. Persisting the tombstone here —
// accumulated, never lost — lets every device fetch the authoritative set on
// load and strip the names regardless of who seeds the day.
//
// Names are stored normalized (trimmed, lowercased). A unique index dedupes a
// name within a scope; `scope` isolates the sandbox account's tombstones from
// live. Cleared (DELETE) only when the user explicitly re-adds a name, matching
// the existing "re-add resurrects" semantics.
export const mergedAwayTable = pgTable(
  "merged_away",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("merged_away_name_idx").on(t.name, t.scope),
  }),
);

export const insertMergedAwaySchema = createInsertSchema(mergedAwayTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMergedAway = z.infer<typeof insertMergedAwaySchema>;
export type MergedAway = typeof mergedAwayTable.$inferSelect;
