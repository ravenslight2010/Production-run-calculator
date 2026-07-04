import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Per-scope "data reset generation" counter. Bumping `epoch` (via the admin-only
// POST /api/sync/reset) is the single, reliable way to wipe the app back to a
// clean slate: the reset endpoint deletes every daily_sync row for the scope and
// increments this counter in one transaction, and every client stores the epoch
// it last honored. When a client sees the server epoch has advanced past its
// stored value it performs a one-shot local wipe and re-adopts the (now empty)
// server state — which is what makes a reset survive the additive live-sync union
// instead of a populated tab immediately re-uploading its old copy.
//
// `scope` is the primary key (one row per data scope: "live" / "sandbox"), so a
// live reset never touches sandbox and vice-versa. Additive and push-safe on an
// already-populated database.
export const dataResetTable = pgTable("data_reset", {
  scope: text("scope").primaryKey(),
  epoch: integer("epoch").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataReset = typeof dataResetTable.$inferSelect;
