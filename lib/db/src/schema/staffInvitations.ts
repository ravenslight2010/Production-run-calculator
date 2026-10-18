import { timestamp, text, uuid, pgTable, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const staffInvitationsTable = pgTable("staff_invitations", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").notNull().references(() => usersTable.id),
  role: text("role").notNull().default("operator"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index("staff_invitations_token_hash_idx").on(t.tokenHash),
  inviterIdx: index("staff_invitations_invited_by_idx").on(t.invitedBy),
}));

export type StaffInvitation = typeof staffInvitationsTable.$inferSelect;