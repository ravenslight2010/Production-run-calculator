import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type QcWorkflowEventType =
  | "lot"
  | "weight"
  | "allergen-review"
  | "cleaning"
  | "cleaning-verification"
  | "target-setting"
  | "run-signoff"
  | "correction"
  | "redaction";

// QC evidence is an append-only facility event stream. A single ordered
// sequence lets a run sign-off name the exact record high-water mark it
// reviewed, and keeps corrections/redactions as new evidence rather than
// editing the original event.
export const qcWorkflowEventsTable = pgTable(
  "qc_workflow_events",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    operationId: text("operation_id").notNull(),
    recordId: text("record_id").notNull(),
    eventType: text("event_type").notNull().$type<QcWorkflowEventType>(),
    runId: text("run_id"),
    profileKey: text("profile_key"),
    ingredientId: text("ingredient_id"),
    ingredientName: text("ingredient_name"),
    station: text("station"),
    relatedEventId: text("related_event_id"),
    actorId: text("actor_id").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("qc_workflow_events_scope_operation_idx").on(
      table.scope,
      table.operationId,
    ),
    index("qc_workflow_events_scope_run_id_id_idx").on(
      table.scope,
      table.runId,
      table.id,
    ),
    index("qc_workflow_events_scope_type_id_idx").on(
      table.scope,
      table.eventType,
      table.id,
    ),
    index("qc_workflow_events_scope_record_id_idx").on(
      table.scope,
      table.recordId,
      table.id,
    ),
    index("qc_workflow_events_scope_ingredient_id_idx").on(
      table.scope,
      table.ingredientId,
      table.id,
    ),
  ],
);

export type QcWorkflowEventRow = typeof qcWorkflowEventsTable.$inferSelect;
