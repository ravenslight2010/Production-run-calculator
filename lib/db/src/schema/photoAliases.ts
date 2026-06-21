import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Learned photo-intake aliases. When a user confirms that a photo-identified
// item (the AI's guessed name) maps to a specific existing inventory item, that
// mapping is persisted here so FUTURE photo identifications auto-apply the
// remembered match instantly — even when the vision model returns no/low match.
// Shared factory-wide across all signed-in users, the same way learned import
// aliases work.
//
// `guessName` is the raw name the vision model returned (matched
// case-insensitively) and `itemKey` is the inventory item key it resolves to.
// `scope` isolates the sandbox account's aliases from live.
export const photoAliasesTable = pgTable("photo_aliases", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  guessName: text("guess_name").notNull(),
  itemKey: text("item_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPhotoAliasSchema = createInsertSchema(photoAliasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPhotoAlias = z.infer<typeof insertPhotoAliasSchema>;
export type PhotoAlias = typeof photoAliasesTable.$inferSelect;
