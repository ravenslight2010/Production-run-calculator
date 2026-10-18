import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Audit log for high-stakes operations:
 * - Manager data resets (POST /api/sync/reset)
 * - Role and capability changes
 * - Password reset approvals
 * - Production rule edits
 * - Sensitive data access (for compliance)
 *
 * Append-only; never delete. Compliance retention is indefinite: ordinary
 * reset/factory-purge collections must exclude this table. Redaction happens
 * before insert and legacy network columns are never selected or newly written.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    actor: text("actor").notNull(), // stable server-authenticated actor ID
    action: text("action").notNull(), // 'factory_reset', 'role_change', 'rule_edit', etc.
    resource: text("resource"), // what was changed (e.g., 'production_rules', 'user_role')
    // Retained compliance evidence is deliberately bounded and redacted at the
    // application boundary. These legacy columns remain nullable for rollout
    // compatibility, but are never populated by the hardened writer.
    changes: jsonb("changes").notNull().$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeActorIdx: index("audit_logs_scope_actor_idx").on(t.scope, t.actor),
    scopeActionIdx: index("audit_logs_scope_action_idx").on(t.scope, t.action),
    createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
    scopeCreatedAtIdIdx: index("audit_logs_scope_created_at_id_idx").on(t.scope, t.createdAt, t.id),
    boundedAction: check("audit_logs_action_bounded", sql`char_length(${t.action}) between 1 and 100`),
    boundedResource: check("audit_logs_resource_bounded", sql`${t.resource} is null or char_length(${t.resource}) <= 200`),
    boundedActor: check("audit_logs_actor_bounded", sql`char_length(${t.actor}) between 1 and 200`),
    boundedScope: check("audit_logs_scope_bounded", sql`char_length(${t.scope}) between 1 and 20`),
    boundedChanges: check("audit_logs_changes_bounded", sql`octet_length(${t.changes}::text) <= 8192`),
  }),
);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
