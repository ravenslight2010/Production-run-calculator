import { pgTable, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Facility-wide supervisor PIN (single row per scope). The 4-digit PIN that
// gates supervisor actions (unlocking settings / reset) used to live in each
// device's local storage, so changing it on one device left every other device
// on the old PIN. It is now a server-side facility setting so it follows the
// facility, mirroring inventory_settings / proactive_alert_settings.
//
// Keep the singleton-style integer PK (matches the sibling settings tables) so
// adding scope stays a purely ADDITIVE, push-force-safe change. scope is the
// real key (one row per scope) via the unique index below; each scope gets a
// fixed distinct id (see settingsRowId) so the rows never clash.
export const supervisorPinSettingsTable = pgTable(
  "supervisor_pin_settings",
  {
    id: integer("id").primaryKey().default(1),
    scope: text("scope").notNull().default("live"),
    pin: text("pin").notNull().default("1234"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supervisor_pin_settings_scope_idx").on(t.scope)],
);

export type SupervisorPinSettings = typeof supervisorPinSettingsTable.$inferSelect;
