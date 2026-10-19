import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Bounded, payload-free failure events used to aggregate background-operation
// health across API instances. Retention is enforced by the API diagnostics
// layer on reads and writes.
export const backgroundOperationEventsTable = pgTable(
  "background_operation_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    operation: text("operation").notNull(),
    sourceInstance: text("source_instance").notNull().default("legacy"),
    errorCode: text("error_code").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("background_operation_events_operation_time_idx").on(
      table.operation,
      table.occurredAt,
    ),
  ],
);

export type BackgroundOperationEvent = typeof backgroundOperationEventsTable.$inferSelect;

// One aggregate per API process. Do not add date, run, or operational payload
// fields here: manager diagnostics need only a bounded count and next retry.
export const automaticTrackingDeferredDiagnosticsTable = pgTable(
  "automatic_tracking_deferred_diagnostics",
  {
    sourceInstance: text("source_instance").primaryKey(),
    deferredDateCount: integer("deferred_date_count").notNull().default(0),
    deferredDateCountCapped: boolean("deferred_date_count_capped").notNull().default(false),
    nextEligibleRetryAt: timestamp("next_eligible_retry_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("automatic_tracking_deferred_diagnostics_updated_at_idx").on(table.updatedAt),
  ],
);

export type AutomaticTrackingDeferredDiagnostic =
  typeof automaticTrackingDeferredDiagnosticsTable.$inferSelect;
