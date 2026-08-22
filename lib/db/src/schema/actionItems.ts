import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Durable manager work state. Source records remain authoritative. */
export const actionItemsTable = pgTable(
  "action_items",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    dedupKey: text("dedup_key").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourcePath: text("source_path").notNull(),
    status: text("status").notNull().default("open"),
    assigneeId: text("assignee_id"),
    assigneeName: text("assignee_name"),
    deferReason: text("defer_reason"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("action_items_scope_dedup_idx").on(t.scope, t.dedupKey),
    index("action_items_scope_status_idx").on(t.scope, t.status),
    index("action_items_scope_updated_idx").on(t.scope, t.updatedAt),
  ],
);

export type ActionItem = typeof actionItemsTable.$inferSelect;