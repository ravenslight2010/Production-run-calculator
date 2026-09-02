import { pgTable, serial, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Sanitized, short-lived results for repeatable non-conversational AI operations.
// The request/prompt is never stored: `operationKey` is a one-way fingerprint of
// the normalized operation, model, prompt, and grounded context. `scope` keeps
// sandbox results separate from live facility results.
export const aiResultCacheTable = pgTable(
  "ai_result_cache",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    namespace: text("namespace").notNull(),
    operationKey: text("operation_key").notNull(),
    result: jsonb("result").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_result_cache_scope_namespace_key_idx").on(
      table.scope,
      table.namespace,
      table.operationKey,
    ),
    index("ai_result_cache_scope_expiry_idx").on(table.scope, table.expiresAt),
  ],
);

export type AiResultCacheRow = typeof aiResultCacheTable.$inferSelect;