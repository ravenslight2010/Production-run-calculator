import { timestamp, text, uuid, pgTable, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// A server-side record makes otherwise stateless bearer/cookie sessions
// revocable and gives the shared-tablet idle policy one source of truth.
export const authSessionsTable = pgTable("auth_sessions", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  tokenIdx: index("auth_sessions_token_hash_idx").on(t.tokenHash),
  userIdx: index("auth_sessions_user_id_idx").on(t.userId),
}));

export type AuthSession = typeof authSessionsTable.$inferSelect;