import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Per-user AI conversation memory: a rolling, capped log of one person's recent
// AI turns so their follow-up questions keep context for them only.
//
// Unlike the two factory-wide pools (`ai_corrections`, `facility_knowledge`),
// this is scoped to a single user via `userId`. Each row is one message turn,
// either from the user or the assistant (`role`). Turns are ordered by
// `createdAt`; the server keeps only the most recent N per user (the window) so
// the table never grows without bound. Rows cascade-delete with the user.
export const aiConversationTurnsTable = pgTable(
  "ai_conversation_turns",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // "user" | "assistant" — validated/normalized in the shared ai-memory lib.
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_conversation_turns_user_idx").on(table.userId, table.createdAt)],
);

export const insertAiConversationTurnSchema = createInsertSchema(aiConversationTurnsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiConversationTurn = z.infer<typeof insertAiConversationTurnSchema>;
export type AiConversationTurnRow = typeof aiConversationTurnsTable.$inferSelect;
