import { pgTable, serial, text, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// A persisted, structured record of a quality check a manager reviewed and
// confirmed. The /inventory/quality-photo endpoint is purely advisory and never
// writes; confirming an outcome records BOTH a free-text fact into shared
// facility memory (for AI grounding) AND a row here, which powers a browsable
// "Quality history" managers can audit and spot trends in over time.
//
// `scope` isolates live and sandbox records — sandbox test checks never appear
// in the live quality audit trail. `productType` is "pizza" | "crust" | "other";
// `status` is the reviewed verdict "pass" | "warn" | "fail"; `confidence` is the
// model's 0..1 confidence at check time; `issues` snapshots the specific concerns
// (array of {type, severity, detail}); `notes` is the optional user context
// attached to the check; and `thumbnail` is an optional small data URI of the
// analyzed photo (dropped when too large). The reviewer's id is a soft reference
// (ON DELETE SET NULL) and the name is snapshotted so the history survives the
// account being removed.
export const qualityChecksTable = pgTable(
  "quality_checks",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    productType: text("product_type").notNull(),
    status: text("status").notNull(),
    confidence: real("confidence").notNull().default(0),
    summary: text("summary").notNull().default(""),
    // Array of { type, severity, detail }; snapshotted from the assessment.
    issues: jsonb("issues").notNull().default([]),
    // Optional plain-language context the reviewer attached to the check.
    notes: text("notes"),
    // Optional small base64 data URI of the analyzed photo; null when absent or
    // too large to store.
    thumbnail: text("thumbnail"),
    // Soft FK to the reviewer; null once the account is removed.
    reviewerId: text("reviewer_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // Snapshotted identity so the history view survives reviewer deletion.
    reviewerName: text("reviewer_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("quality_checks_created_at_idx").on(table.createdAt)],
);

export type QualityCheckRow = typeof qualityChecksTable.$inferSelect;
