import {
  pgTable,
  serial,
  text,
  doublePrecision,
  integer,
  boolean,
  jsonb,
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

// A named place stock physically lives (e.g. "Onsite (Line)", "Cold Storage",
// "Warehouse B"). Exactly one location per scope is the `isOnsite` location:
// production auto-deduction only draws from it, and a transfer warning surfaces
// when onsite stock can't cover demand while another location holds stock that
// could be moved. `scope` isolates the seeded test account's copy from live.
// Lots with a null locationId are treated as onsite (pre-feature / backfilled).
export const inventoryLocationsTable = pgTable(
  "inventory_locations",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    isOnsite: boolean("is_onsite").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_locations_name_scope_idx").on(t.name, t.scope)],
);

// A received batch of a material. lotNumber/received/expiration are optional; an
// unlotted delivery uses an empty lotNumber and null dates. `locationId` is the
// place this lot lives; null means the onsite/line location (additive, nullable
// so adding it stays push-force-safe on a populated table).
export const inventoryLotsTable = pgTable("inventory_lots", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  itemId: integer("item_id")
    .notNull()
    .references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  locationId: integer("location_id").references(() => inventoryLocationsTable.id, {
    onDelete: "set null",
  }),
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

// A manager-reviewed photo count. Photos and AI output are retained only as
// bounded workflow provenance; no inventory is changed until Apply.
export const inventoryObservationsTable = pgTable("inventory_observations", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  status: text("status").notNull().default("draft"), // draft | applied | cancelled
  photos: jsonb("photos").notNull().default([]),
  draft: jsonb("draft").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

// Confirmed packaging/product facts are distinct from count events. A later
// weaker photo may suggest changes, but never overwrites these trusted facts.
export const inventoryProductReferencesTable = pgTable(
  "inventory_product_references",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    itemKey: text("item_key").notNull(),
    productName: text("product_name").notNull(),
    brand: text("brand"),
    variant: text("variant"),
    barcode: text("barcode"),
    packageSize: text("package_size"),
    printedWeight: doublePrecision("printed_weight"),
    unitType: text("unit_type"),
    casePack: integer("case_pack"),
    confidence: doublePrecision("confidence").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_product_refs_item_scope_idx").on(t.itemKey, t.scope)],
);

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryLocation = typeof inventoryLocationsTable.$inferSelect;
export type InventoryLot = typeof inventoryLotsTable.$inferSelect;
export type InventoryLedgerEntry = typeof inventoryLedgerTable.$inferSelect;
export type InventoryConsumedRun = typeof inventoryConsumedRunsTable.$inferSelect;
export type InventorySettings = typeof inventorySettingsTable.$inferSelect;
export type InventoryObservation = typeof inventoryObservationsTable.$inferSelect;
export type InventoryProductReference = typeof inventoryProductReferencesTable.$inferSelect;
