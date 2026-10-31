import { pgTable, text, jsonb, timestamp, bigserial, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";

export type MasterDataEntity =
  | "ingredients" | "doughRecipes" | "sauceRecipes" | "cheeseRecipes" | "mixes"
  | "profiles" | "templates" | "directories" | "dies" | "specAliases" | "mergeAliases"
  | "mergedAway" | "ingredientWeights";

/** Server-observed facts only; no browser keys, client snapshots, or run documents. */
export type MasterDataFact = {
  entity: MasterDataEntity;
  key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** Narrow pending-run reference edits, never live values/counters or a day snapshot. */
export type MasterDataReferenceFact = {
  date: string;
  runId: string;
  section: "meta" | "values";
  field: string;
  beforeExists: boolean;
  afterExists: boolean;
  before: unknown;
  after: unknown;
};

export const masterDataOperationsTable = pgTable("master_data_operations", {
  sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
  id: text("id").notNull(),
  scope: text("scope").notNull().default("live"),
  actorId: text("actor_id").notNull(),
  requestHash: text("request_hash").notNull(),
  command: jsonb("command").notNull().$type<Record<string, unknown>>(),
  description: text("description").notNull(),
  status: text("status").notNull().default("applied"),
  unavailableReason: text("unavailable_reason"),
  facts: jsonb("facts").notNull().$type<MasterDataFact[]>(),
  references: jsonb("references").notNull().$type<MasterDataReferenceFact[]>(),
  resultHash: text("result_hash").notNull(),
  guardHash: text("guard_hash").notNull(),
  conflictCount: bigint("conflict_count", { mode: "number" }).notNull().default(0),
  lastConflictAt: timestamp("last_conflict_at", { withTimezone: true }),
  lastConflictBy: text("last_conflict_by"),
  lastConflictReason: text("last_conflict_reason"),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  undoneBy: text("undone_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("master_data_operations_scope_id_idx").on(t.scope, t.id),
  index("master_data_operations_scope_sequence_idx").on(t.scope, t.sequence),
]);

/** No expiry or purge. Advancing this fence never resets a live production day. */
export const masterDataUndoEpochsTable = pgTable("master_data_undo_epochs", {
  scope: text("scope").primaryKey(),
  epoch: bigint("epoch", { mode: "number" }).notNull().default(0),
});
