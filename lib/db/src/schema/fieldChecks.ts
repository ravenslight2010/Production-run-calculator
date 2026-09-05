import {
  index,
  jsonb,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Privacy-safe observations produced by naturally occurring browser lifecycle
 * events. The scope is applied server-side from the authenticated request;
 * observationId is a client-generated idempotency key, not a user identifier.
 */
export const fieldCheckObservationsTable = pgTable(
  "field_check_observations",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    observationId: text("observation_id").notNull(),
    checkName: text("check_name").notNull(),
    checkVersion: text("check_version").notNull(),
    outcome: text("outcome").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appBuild: text("app_build").notNull(),
    deviceCategory: text("device_category").notNull(),
    metrics: jsonb("metrics").notNull().default({}),
  },
  (table) => [
    uniqueIndex("field_check_observations_scope_observation_idx").on(
      table.scope,
      table.observationId,
    ),
    index("field_check_observations_scope_check_observed_idx").on(
      table.scope,
      table.checkName,
      table.observedAt,
    ),
  ],
);

/**
 * Compact rollup state for checks that have failed or repeatedly failed to
 * complete. Keeping this separate from observations preserves issue history
 * while allowing old raw samples to expire.
 */
export const fieldCheckIssuesTable = pgTable(
  "field_check_issues",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    checkName: text("check_name").notNull(),
    status: text("status").notNull().default("open"),
    failureCount: integer("failure_count").notNull().default(0),
    incompleteCount: integer("incomplete_count").notNull().default(0),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
    lastFailure: jsonb("last_failure"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("field_check_issues_scope_check_idx").on(table.scope, table.checkName),
    index("field_check_issues_scope_status_idx").on(table.scope, table.status),
  ],
);

export type FieldCheckObservation = typeof fieldCheckObservationsTable.$inferSelect;
export type FieldCheckIssue = typeof fieldCheckIssuesTable.$inferSelect;