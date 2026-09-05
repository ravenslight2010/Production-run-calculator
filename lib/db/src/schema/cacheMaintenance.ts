import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Bounded, payload-free events used to aggregate cache maintenance failures
// across API instances. Retention and the per-scope event cap are enforced by
// the observability layer when events are written or read.
export const cacheMaintenanceEventsTable = pgTable(
  "cache_maintenance_events",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    operation: text("operation").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cache_maintenance_events_scope_operation_time_idx").on(
      table.scope,
      table.operation,
      table.occurredAt,
    ),
  ],
);

export type CacheMaintenanceEvent = typeof cacheMaintenanceEventsTable.$inferSelect;