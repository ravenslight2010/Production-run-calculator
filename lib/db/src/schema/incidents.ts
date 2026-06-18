import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Reported problems and auto-captured crashes, surfaced to managers as an
// incident log with an attached AI diagnosis. There are two sources:
//
//   1. "user_report" — someone tapped "Report an issue" and described what went
//      wrong in their own words (stored in the context payload).
//   2. "auto_crash"  — a top-level error boundary caught an uncaught error and
//      auto-submitted it in the background (error message + stack in context).
//
// On creation the server asks the AI for a plain-language diagnosis + a
// suggested workaround, which are stored alongside the incident so a manager
// reviewing the list later sees the same explanation the reporter saw.
//
// The reporter's id is captured as a soft reference (ON DELETE SET NULL) so the
// incident log survives even if the staff member is later removed; the username
// and role are also snapshotted into dedicated columns so the manager view never
// loses the who/where even without the user row.
export const incidentsTable = pgTable("incidents", {
  id: text("id").primaryKey(),
  // "user_report" | "auto_crash"
  source: text("source").notNull(),
  // Soft FK to the reporter; null once the account is removed.
  reporterId: text("reporter_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  // Snapshotted identity so the manager view survives reporter deletion.
  reporterName: text("reporter_name"),
  // "manager" | "operator" at report time; snapshotted for the same reason.
  reporterRole: text("reporter_role"),
  // Screen/route the user was on (e.g. "Run", "Inventory", "/mobile/assistant").
  screen: text("screen").notNull(),
  // "web" | "mobile".
  appPlatform: text("app_platform").notNull(),
  // Free-form app/build version string; null when the client doesn't send one.
  appVersion: text("app_version"),
  // Captured context: { description?, errorMessage?, errorStack?, userAgent? }.
  context: jsonb("context").notNull(),
  // AI plain-language explanation + suggested workaround; null if the AI call
  // could not produce one (the incident is still recorded).
  diagnosis: text("diagnosis"),
  workaround: text("workaround"),
  // "new" (unreviewed) | "reviewed" (a manager has seen it) | "resolved" (the
  // underlying problem is considered fixed/handled). "resolved" implies the
  // incident has also been reviewed.
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // When a manager marked the incident resolved; null until then.
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type Incident = typeof incidentsTable.$inferSelect;
