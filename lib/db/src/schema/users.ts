import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Application user accounts for the self-contained username + password auth
// system (replaces Clerk). `id` is an opaque UUID we mint; `username` is the
// unique login handle; `passwordHash` is a scrypt hash (see api-server lib/auth).
// `onboardingSeen` tracks whether the user has dismissed the first-login "Get
// Started" overview; it is per-user (not device-local) so "first login" is well
// defined across the web and mobile clients.
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  onboardingSeen: boolean("onboarding_seen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
