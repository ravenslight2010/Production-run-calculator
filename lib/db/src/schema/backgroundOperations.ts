import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Bounded, payload-free failure events used to aggregate background-operation
// health across API instances. Retention is enforced by the API diagnostics
// layer on reads and writes.
export const backgroundOperationEventsTable = pgTable(
  "background_operation_events",
  {
    id: serial("id").primaryKey(),
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