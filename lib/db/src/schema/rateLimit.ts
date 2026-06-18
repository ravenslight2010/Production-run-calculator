import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// Shared, cross-instance counters for the fixed-window rate limiter. The
// in-process Map in rateLimit.ts is fine for a single instance, but if the API
// is scaled horizontally (or restarts often) each instance counts on its own,
// so a user could exceed the intended cap by spreading requests across them.
// Backing the counters with this table makes the cap hold regardless of how
// many instances are running.
//
// One row per limiter bucket key (e.g. a userId). `count` is the number of hits
// in the current window and `resetAt` is when that window ends; both are driven
// by the application clock (not the DB clock) so the window is anchored to the
// first request, identical to the in-memory behavior. Expired rows are swept
// opportunistically — see PostgresRateLimitStore.
export const rateLimitCountersTable = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export type RateLimitCounter = typeof rateLimitCountersTable.$inferSelect;
