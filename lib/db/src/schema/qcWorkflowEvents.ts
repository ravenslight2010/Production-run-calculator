import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";

export type QcWorkflowEventType =
  | "lot"
  | "weight"
  | "dimension"
  | "photo"
  | "checklist"
  | "note";

/**
 * Durable QC workflow event log. One row per recorded QC action (lot capture,
 * weight/dimension reading, photo evidence, checklist completion, or free-text
 * note). Rows are factory-scoped and keyed to the run/profile/ingredient they
 * describe so a later audit can replay the full QC trail for a production day.
 */
export const qcWorkflowEventsTable = pgTable(
  "qc_workflow_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    scope: text("scope").notNull().default("live"),
    eventType: text("eventType").notNull(),
    recordId: text("recordId"),
    runId: text("runId"),
    profileKey: text("profileKey"),
    ingredientId: text("ingredientId"),
    ingredientName: text("ingredientName"),
    lotNumber: text("lotNumber"),
    valueNumeric: text("valueNumeric"),
    valueUnit: text("valueUnit"),
    note: text("note"),
    actorId: text("actorId"),
    actorName: text("actorName"),
    payload: jsonb("payload"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("qc_workflow_events_scope_created_idx").on(table.scope, table.createdAt),
    index("qc_workflow_events_scope_run_idx").on(table.scope, table.runId),
    uniqueIndex("qc_workflow_events_scope_record_idx").on(
      table.scope,
      table.recordId,
    ),
  ],
);
