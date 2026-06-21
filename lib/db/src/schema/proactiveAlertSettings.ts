import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Global proactive-alert settings (single row, id=1). Lets a manager tune how
// aggressive the proactive shift watcher is: turn it off entirely, change the
// poll cadence (how often the client checks for a nudge while a day runs), and
// change the per-key dismissal cooldown (how long a dismissed nudge stays
// suppressed). These are factory-wide, NOT part of the per-day sync payload, so
// they live in their own relational table like the other global settings.
export const proactiveAlertSettingsTable = pgTable("proactive_alert_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(true),
  pollSeconds: integer("poll_seconds").notNull().default(240),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(1800),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProactiveAlertSettings = typeof proactiveAlertSettingsTable.$inferSelect;
