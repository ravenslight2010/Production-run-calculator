import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** A manager-opted-in case whose expected values came from a successful human Apply. */
export const importGoldCasesTable = pgTable(
  "import_gold_cases",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    scope: text("scope").notNull().default("live"),
    operationId: text("operation_id").notNull(),
    importType: text("import_type").notNull(),
    sourceLabel: text("source_label").notNull(),
    evaluatedInput: jsonb("evaluated_input").notNull().$type<Record<string, unknown>>(),
    expectedResult: jsonb("expected_result").notNull().$type<Record<string, unknown>>(),
    excluded: boolean("excluded").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
  },
  (t) => ({
    scopeCreatedIdx: index("import_gold_cases_scope_created_idx").on(t.scope, t.createdAt),
    scopeOperationUnique: uniqueIndex("import_gold_cases_scope_operation_unique").on(t.scope, t.operationId),
  }),
);

/** Immutable provider attempt history; failures are retained as safe error codes. */
export const importGoldScoresTable = pgTable(
  "import_gold_scores",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    scope: text("scope").notNull().default("live"),
    caseId: integer("case_id").notNull().references(() => importGoldCasesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    accuracy: real("accuracy"),
    comparedFields: integer("compared_fields").notNull().default(0),
    equalFields: integer("equal_fields").notNull().default(0),
    fieldDiffs: jsonb("field_diffs").notNull().default([]).$type<Array<Record<string, unknown>>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCaseCreatedIdx: index("import_gold_scores_scope_case_created_idx").on(t.scope, t.caseId, t.createdAt),
  }),
);

/**
 * Payload-free retention metadata. Deliberately has no FK to the case so the
 * deadline and verification record survive deletion of case/score payloads.
 */
export const importGoldRetentionTable = pgTable(
  "import_gold_retention",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    scope: text("scope").notNull().default("live"),
    caseId: integer("case_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    deleteBy: timestamp("delete_by", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCaseUnique: uniqueIndex("import_gold_retention_scope_case_unique").on(t.scope, t.caseId),
    scopeDeadlineIdx: index("import_gold_retention_scope_deadline_idx").on(t.scope, t.deleteBy),
  }),
);

export type ImportGoldCaseRow = typeof importGoldCasesTable.$inferSelect;
export type ImportGoldScoreRow = typeof importGoldScoresTable.$inferSelect;
export type ImportGoldRetentionRow = typeof importGoldRetentionTable.$inferSelect;
