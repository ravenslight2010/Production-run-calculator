import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Per-scope proactive-alert settings (one row per scope). Lets a manager tune
// how aggressive the proactive shift watcher is: turn it off entirely, change
// the poll cadence (how often the client checks for a nudge while a day runs),
// and change the per-key dismissal cooldown (how long a dismissed nudge stays
// suppressed). These are factory-wide but scope-isolated (live vs. sandbox),
// NOT part of the per-day sync payload, so they live in their own table.
export const proactiveAlertSettingsTable = pgTable("proactive_alert_settings", {
  scope: text("scope").primaryKey().default("live"),
  enabled: boolean("enabled").notNull().default(true),
  pollSeconds: integer("poll_seconds").notNull().default(240),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(1800),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProactiveAlertSettings = typeof proactiveAlertSettingsTable.$inferSelect;
