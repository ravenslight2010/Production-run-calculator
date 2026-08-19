import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Log of sync conflicts resolved during offline-first data reconciliation.
 * Used to track:
 * - How many conflicts per day/scope
 * - Which fields conflict most often
 * - Whether merges are converging or data is drifting
 * - Client vs. server state hashes for forensics
 */
export const syncConflictLogsTable = pgTable(
  "sync_conflict_logs",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    date: text("date").notNull(), // YYYY-MM-DD (the day the sync occurred)
    fieldsWithConflicts: jsonb("fields_with_conflicts")
      .notNull()
      .$type<string[]>(),
    conflictCount: integer("conflict_count").notNull(),
    resolution: text("resolution").notNull(), // 'additive-union', 'server-wins', 'client-wins'
    clientStateHash: text("client_state_hash"),
    serverStateHash: text("server_state_hash"),
    mergedStateHash: text("merged_state_hash"),
    clientIp: text("client_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeDateIdx: index("sync_conflict_logs_scope_date_idx").on(
      t.scope,
      t.date,
    ),
    scopeCreatedIdx: index("sync_conflict_logs_scope_created_idx").on(
      t.scope,
      t.createdAt,
    ),
  }),
);

export const insertSyncConflictLogSchema = createInsertSchema(
  syncConflictLogsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertSyncConflictLog = z.infer<typeof insertSyncConflictLogSchema>;
export type SyncConflictLog = typeof syncConflictLogsTable.$inferSelect;
