import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const IMPORT_SOURCE_RETENTION_DAYS = 90;
export const IMPORT_SOURCE_RETENTION_MS = IMPORT_SOURCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Durable idempotency and guarded-recovery record for a reviewed import apply. */
export const importOperationsTable = pgTable(
  "import_operations",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    importType: text("import_type").notNull(),
    sourceKey: text("source_key"),
    sourceLabel: text("source_label").notNull(),
    actorId: text("actor_id"),
    requestHash: text("request_hash").notNull(),
    expectedStateHash: text("expected_state_hash"),
    resultHash: text("result_hash"),
    status: text("status").notNull().default("applying"),
    beforeSnapshot: jsonb("before_snapshot").notNull().default({}),
    afterSnapshot: jsonb("after_snapshot").notNull().default({}),
    distillEvidence: jsonb("distill_evidence").notNull().default({}).$type<Record<string, unknown>>(),
    affectedEntities: jsonb("affected_entities").notNull().default({}),
    result: jsonb("result").notNull().default({}),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("import_operations_scope_created_idx").on(t.scope, t.createdAt),
  }),
);

export type ImportOperationRow = typeof importOperationsTable.$inferSelect;