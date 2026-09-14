import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
// `floorModeEnabled` is the user's Floor Mode (idle big-numbers monitor)
// on/off preference; per-user (not device-local) so it follows them across
// devices. New accounts default to off; existing stored values are preserved
// when the schema default changes.
// `notificationPrefs` is the user's per-alert push-notification preferences —
// a map of alert kind (e.g. "batchDue") → boolean. A MISSING key means the
// alert is ON (default), so new alert kinds are automatically enabled for
// everyone; per-user (not device-local) so the choices follow them across
// devices, like `floorModeEnabled`.
//
// Username uniqueness is enforced CASE-INSENSITIVELY at the DB level via a
// functional unique index on lower(username). This MUST match the app-level
// lookup — findUserByUsername/isUsernameAvailable/sign-in all compare with
// `lower(username) = lower(handle)` — or two concurrent sign-ups ("Alice" /
// "alice") can both pass the app's pre-insert availability check and land as
// distinct rows, since a plain case-SENSITIVE `unique()` only rejects an
// exact-case collision. The functional index makes the database the actual
// source of truth for the invariant the app already assumes, so concurrent
// requests can't create case-variant duplicate accounts. Per
// additive-push-force-schema.md, this is a `uniqueIndex`, not `.unique()`.
export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    onboardingSeen: boolean("onboarding_seen").notNull().default(false),
    tourCompleted: boolean("tour_completed").notNull().default(false),
    floorModeEnabled: boolean("floor_mode_enabled").notNull().default(false),
    notificationPrefs: jsonb("notification_prefs")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    sandbox: boolean("sandbox").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usernameLowerIdx: uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
  }),
);

export type User = typeof usersTable.$inferSelect;
