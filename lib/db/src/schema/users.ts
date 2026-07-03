import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Application user accounts for the self-contained username + password auth
// system (replaces Clerk). `id` is an opaque UUID we mint; `username` is the
// unique login handle; `passwordHash` is a scrypt hash (see api-server lib/auth).
// `onboardingSeen` tracks whether the user has dismissed the first-login "Get
// Started" overview; it is per-user (not device-local) so "first login" is well
// defined across the web and mobile clients. `tourCompleted` mirrors it for the
// opt-in guided tour: it flips true once the user reaches the tour's final step,
// so the app can tell a brand-new user from one who already finished the tour.
// `sandbox` marks the seeded test account: while signed in as it, every read and
// write is routed to the isolated "sandbox" data scope instead of live.
// `passwordChangedAt` is set the moment the password is first REPLACED (self
// change, manager reset, or forgotten-password relay code) — it is nullable
// with no default because account creation is not a "change" to fence on.
// Stateless session tokens carry an `iat`; requireAuth rejects any token
// issued strictly before this timestamp once it is set, so a stolen token
// can't outlive a password recovery. Leaving it null until an actual change
// means legacy/pre-existing tokens are never fenced by an account simply
// having existed since before the token was issued.
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  onboardingSeen: boolean("onboarding_seen").notNull().default(false),
  tourCompleted: boolean("tour_completed").notNull().default(false),
  sandbox: boolean("sandbox").notNull().default(false),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
