import {
  pgTable,
  serial,
  text,
  doublePrecision,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Persistent inventory (stock) tracking. Unlike daily_sync (a per-day JSONB
// blob), inventory is a running total across days, so it lives in its own
// relational tables. On-hand per item is the sum of its lots' remaining qty;
// the ledger is the immutable audit trail of every movement.
//
// `scope` ("live" | "sandbox") isolates the seeded test account's copy from the
// real factory data. Item ids stay globally unique (serial), so lots/ledger FKs
// remain single-column; the `key` identity is unique only WITHIN a scope.

// One tracked material. `key` is a stable identity that lines up with what the
// warehouse demand roll-up computes (e.g. "packaging:circles:12in",
// "ingredient:Mozzarella:batches") so auto-deduction can match consumption to
// the right item.
export const inventoryItemsTable = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    key: text("key").notNull(),
    category: text("category").notNull(), // "packaging" | "ingredient"
    name: text("name").notNull(),
    unit: text("unit").notNull(), // circles | shippers | cases | batches | lbs | …
    reorderThreshold: doublePrecision("reorder_threshold").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_items_key_scope_idx").on(t.key, t.scope)],
);

// A received batch of a material. lotNumber/received/expiration are optional; an
// unlotted delivery uses an empty lotNumber and null dates.
export const inventoryLotsTable = pgTable("inventory_lots", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  itemId: integer("item_id")
    .notNull()
    .references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  lotNumber: text("lot_number").notNull().default(""),
  qtyReceived: doublePrecision("qty_received").notNull(),
  qtyRemaining: doublePrecision("qty_remaining").notNull(),
  receivedDate: text("received_date"), // yyyy-mm-dd or null
  expirationDate: text("expiration_date"), // yyyy-mm-dd or null
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable movement log: restock (+), consume (−, from run completion), adjust
// (±, manual correction). `runId` makes auto-consumption idempotent.
export const inventoryLedgerTable = pgTable("inventory_ledger", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  itemId: integer("item_id")
    .notNull()
    .references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  lotId: integer("lot_id").references(() => inventoryLotsTable.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(), // "restock" | "consume" | "adjust"
  qtyDelta: doublePrecision("qty_delta").notNull(),
  runId: text("run_id"), // set for auto-consumption; idempotency key
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Run-level idempotency marker for auto-consumption. A row exists once a run has
// been consumed, regardless of whether any stock was actually drawn down (a run
// can legitimately consume 0 lines when no matching items exist yet). The unique
// (runId, scope) makes "consume once per run" atomic and race-safe even for
// zero-consume runs, which a ledger-row check alone cannot guarantee.
export const inventoryConsumedRunsTable = pgTable(
  "inventory_consumed_runs",
  {
    runId: text("run_id").notNull(),
    scope: text("scope").notNull().default("live"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_consumed_runs_run_scope_idx").on(t.runId, t.scope)],
);

// Global inventory settings, one row per scope. expirySoonDays is the
// user-configurable lead time for the "expiring soon" alert.
export const inventorySettingsTable = pgTable(
  "inventory_settings",
  {
    // Keep the original singleton-style integer PK (matches the sibling
    // proactive_alert_settings) so adding scope stays a purely ADDITIVE change —
    // a push-force-safe path that never prompts on a populated table. scope is
    // the real key (one row per scope) via the unique index below; each scope is
    // given a fixed distinct id (see settingsRowId) so the two rows never clash.
    id: integer("id").primaryKey().default(1),
    scope: text("scope").notNull().default("live"),
    expirySoonDays: integer("expiry_soon_days").notNull().default(7),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_settings_scope_idx").on(t.scope)],
);

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryLot = typeof inventoryLotsTable.$inferSelect;
export type InventoryLedgerEntry = typeof inventoryLedgerTable.$inferSelect;
export type InventoryConsumedRun = typeof inventoryConsumedRunsTable.$inferSelect;
export type InventorySettings = typeof inventorySettingsTable.$inferSelect;
