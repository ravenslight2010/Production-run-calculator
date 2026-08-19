import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
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
 * Append-only; never delete.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    actor: text("actor").notNull(), // username of who performed the action
    action: text("action").notNull(), // 'factory_reset', 'role_change', 'rule_edit', etc.
    resource: text("resource"), // what was changed (e.g., 'production_rules', 'user_role')
    changes: jsonb("changes").notNull().$type<Record<string, any>>(),
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
  }),
);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
