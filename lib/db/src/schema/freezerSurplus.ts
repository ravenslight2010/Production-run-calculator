import {
  integer,
  serial,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Finished-case surplus is deliberately separate from ingredient inventory.
// Lots retain their production date and allocations retain the run they were
// explicitly assigned to. Remaining balance is maintained transactionally by
// the API route while the scope column prevents sandbox/live cross-talk.
export const freezerSurplusLotsTable = pgTable(
  "freezer_surplus_lots",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    brand: text("brand").notNull(),
    flavor: text("flavor").notNull().default(""),
    productKey: text("product_key").notNull(),
    // Stable inventory identity survives inventory-item merges, unlike the
    // display/product key used by freezer allocations.
    inventoryItemId: integer("inventory_item_id"),
    productionDate: text("production_date").notNull(),
    totalCases: integer("total_cases").notNull(),
    remainingCases: integer("remaining_cases").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("freezer_surplus_lots_id_scope_idx").on(t.id, t.scope)],
);

export const freezerSurplusAllocationsTable = pgTable(
  "freezer_surplus_allocations",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    lotId: text("lot_id").notNull(),
    runId: text("run_id").notNull(),
    runDate: text("run_date").notNull(),
    brand: text("brand").notNull(),
    flavor: text("flavor").notNull().default(""),
    productKey: text("product_key").notNull(),
    cases: integer("cases").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freezer_surplus_allocations_id_scope_idx").on(t.id, t.scope),
    uniqueIndex("freezer_surplus_allocations_lot_run_scope_idx").on(
      t.lotId,
      t.runId,
      t.scope,
    ),
  ],
);

// Append-only physical freezer events. Each caller-supplied eventId is unique
// within a scope so a network retry cannot apply the same stock movement twice.
// Corrections link to an earlier damage/return event rather than editing it.
export const freezerSurplusAdjustmentsTable = pgTable(
  "freezer_surplus_adjustments",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    eventId: text("event_id").notNull(),
    lotId: text("lot_id").notNull(),
    eventType: text("event_type").notNull(), // damage | return | correction
    cases: integer("cases").notNull(),
    reason: text("reason").notNull(),
    runId: text("run_id"),
    correctsEventId: text("corrects_event_id"),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freezer_surplus_adjustments_scope_event_idx").on(t.scope, t.eventId),
  ],
);

// A completed run gets exactly one immutable surplus outcome. Zero-case
// confirmations are receipts only; positive outcomes link to the dated lot
// created in the same transaction.
export const freezerSurplusConfirmationsTable = pgTable(
  "freezer_surplus_confirmations",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    runId: text("run_id").notNull(),
    runDate: text("run_date").notNull(),
    brand: text("brand").notNull(),
    flavor: text("flavor").notNull().default(""),
    cases: integer("cases").notNull(),
    productionDate: text("production_date"),
    lotId: text("lot_id"),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freezer_surplus_confirmations_scope_run_idx").on(t.scope, t.runId),
  ],
);

export type FreezerSurplusLotRow = typeof freezerSurplusLotsTable.$inferSelect;
export type FreezerSurplusAllocationRow =
  typeof freezerSurplusAllocationsTable.$inferSelect;
export type FreezerSurplusAdjustmentRow =
  typeof freezerSurplusAdjustmentsTable.$inferSelect;
export type FreezerSurplusConfirmationRow =
  typeof freezerSurplusConfirmationsTable.$inferSelect;