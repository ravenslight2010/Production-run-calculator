import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Durable owner attestations for explicit scheduled-job cleanup. The manifest
 * is immutable after creation; applying a plan revalidates it under locks.
 */
export const scheduledJobCleanupPlansTable = pgTable(
  "scheduled_job_cleanup_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    manifest: jsonb("manifest").notNull().$type<Record<string, unknown>>(),
    manifestDigest: text("manifest_digest").notNull(),
    proposedBy: text("proposed_by").notNull(),
    status: text("status").notNull().default("pending"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedBy: text("approved_by"),
    approvalReason: text("approval_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
  },
  (t) => [
    index("scheduled_job_cleanup_plans_scope_status_idx").on(t.scope, t.status, t.proposedAt),
    check(
      "scheduled_job_cleanup_plans_status_check",
      sql`${t.status} in ('pending', 'applied', 'stale')`,
    ),
    check(
      "scheduled_job_cleanup_plans_digest_check",
      sql`${t.manifestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "scheduled_job_cleanup_plans_manifest_size_check",
      sql`octet_length(${t.manifest}::text) <= 65536`,
    ),
    check(
      "scheduled_job_cleanup_plans_reason_size_check",
      sql`${t.approvalReason} is null or char_length(${t.approvalReason}) between 1 and 200`,
    ),
  ],
);

export type ScheduledJobCleanupPlanRow = typeof scheduledJobCleanupPlansTable.$inferSelect;
