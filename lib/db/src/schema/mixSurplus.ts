import {
  boolean,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Dated, auditable mix surplus ledger. A lot records one over-production event
// (mix made in excess of the plan's fresh need) at its source — the day-start
// consumption moment — and/or a manager-confirmed manual record. Surplus mix is
// "freezer stock": spent ingredients were already deducted when the mix was
// made, so using a lot later only reduces the fresh make amount (via the mix
// row's amountAlreadyMade reducer) — it never re-deducts inventory.
//
// Deliberately a separate relational table (not part of the per-day sync
// payload), so lots survive the daily data wipe for QC/traceability, the same
// guarantee as freezer_surplus_lots. `scope` isolates the sandbox account's
// lots from live; `(id, scope)` mirrors freezerSurplus for idempotent upserts.
export const mixSurplusLotsTable = pgTable(
  "mix_surplus_lots",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    mixId: text("mix_id").notNull(),
    // Denormalized snapshot so history stays stable if the mix is renamed.
    name: text("name").notNull().default(""),
    brand: text("brand").notNull().default(""),
    flavor: text("flavor").notNull().default(""),
    isPrep: boolean("is_prep").notNull().default(false),
    productionDate: text("production_date").notNull(),
    // All amounts in pounds.
    amountMade: real("amount_made").notNull().default(0),
    amountUsed: real("amount_used").notNull().default(0),
    amountRemaining: real("amount_remaining").notNull().default(0),
    location: text("location").notNull().default("freezer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mix_surplus_lots_id_scope_idx").on(t.id, t.scope)],
);

// Explicit assignment of a surplus lot to a make-day ("Use on next run") —
// audit/reminder rows that match the plan's amountAlreadyMade reducer, NOT a
// second math reduction. `runId` records the day-state run when it is
// materialized; future runs are resolved from dailySyncTable by date, so the
// unique key is (lotId, runDate, scope). A zeroed/removed row is the
// "Release/void" override. Released amounts decrement the mix row's
// amountAlreadyMade so the scalar stays in sync with the ledger.
export const mixSurplusAllocationsTable = pgTable(
  "mix_surplus_allocations",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    lotId: text("lot_id").notNull(),
    mixId: text("mix_id").notNull(),
    runId: text("run_id").notNull().default(""),
    runDate: text("run_date").notNull(),
    brand: text("brand").notNull().default(""),
    flavor: text("flavor").notNull().default(""),
    isPrep: boolean("is_prep").notNull().default(false),
    amount: real("amount").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mix_surplus_allocations_id_scope_idx").on(t.id, t.scope),
    uniqueIndex("mix_surplus_allocations_lot_date_scope_idx").on(
      t.lotId,
      t.runDate,
      t.scope,
    ),
  ],
);

export type MixSurplusLotRow = typeof mixSurplusLotsTable.$inferSelect;
export type MixSurplusAllocationRow = typeof mixSurplusAllocationsTable.$inferSelect;
