import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Restricted metadata only. Never store workbooks, approval documents or private locations here. */
export const importGoldApprovalsTable = pgTable("import_gold_approvals", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  scope: text("scope").notNull().default("live"),
  recordRef: text("record_ref").notNull(),
  sourceDigest: text("source_digest").notNull(),
  importType: text("import_type").notNull(),
  purpose: text("purpose").notNull().default("local_spec_import_accuracy"),
  ownerRef: text("owner_ref").notNull(),
  ownerApprovedAt: timestamp("owner_approved_at", { withTimezone: true }).notNull(),
  privacyStatus: text("privacy_status").notNull(),
  privacyReviewerRef: text("privacy_reviewer_ref").notNull(),
  privacyReviewedAt: timestamp("privacy_reviewed_at", { withTimezone: true }).notNull(),
  conditionsRef: text("conditions_ref").notNull(),
  externalCopiesRef: text("external_copies_ref").notNull(),
  backupHandlingRef: text("backup_handling_ref").notNull(),
  manualDeletionAccepted: boolean("manual_deletion_accepted").notNull().default(false),
  retentionDays: integer("retention_days").notNull().default(30),
  conditionsSatisfied: boolean("conditions_satisfied").notNull().default(false),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  scopeRefUnique: uniqueIndex("import_gold_approvals_scope_source_ref_unique").on(t.scope, t.recordRef, t.sourceDigest, t.importType),
  scopeIdIdx: index("import_gold_approvals_scope_id_idx").on(t.scope, t.id),
}));
