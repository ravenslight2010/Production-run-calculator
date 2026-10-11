import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A cursor row is locked by each writer transaction before inserting an event.
// This makes cursor order match commit order (unlike a non-transactional
// sequence, which can expose a later commit before an earlier allocated ID).
export const syncOutboxCursorsTable = pgTable("sync_outbox_cursors", {
  scope: text("scope").primaryKey(),
  cursor: bigint("cursor", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Rows contain only bounded routing metadata. Canonical production and recipe
// data is reread from its source table when a day-state wake-up is delivered.
export const syncOutboxEventsTable = pgTable(
  "sync_outbox_events",
  {
    scope: text("scope").notNull(),
    cursor: bigint("cursor", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    date: text("date"),
    senderId: text("sender_id").notNull().default(""),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sync_outbox_events_scope_cursor_idx").on(table.scope, table.cursor),
    index("sync_outbox_events_created_at_idx").on(table.createdAt),
  ],
);
