import { pgTable, serial, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Bounded, sanitized audit records for workbook imports. */
export const importHistoryTable = pgTable(
  "import_history",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    importType: text("import_type").notNull(),
    sourceKey: text("source_key"),
    sourceLabel: text("source_label").notNull(),
    customerScope: text("customer_scope"),
    status: text("status").notNull(),
    summary: jsonb("summary").notNull(),
    snapshotId: text("snapshot_id"),
    /** Client-generated idempotency key for safely retrying an audit write. */
    operationId: text("operation_id"),
    /** Server-authenticated author, never supplied by the browser. */
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("import_history_scope_created_idx").on(t.scope, t.createdAt),
    scopeActorOperationIdx: uniqueIndex("import_history_scope_actor_operation_idx").on(t.scope, t.actorId, t.operationId),
  }),
);

export type ImportHistoryRow = typeof importHistoryTable.$inferSelect;