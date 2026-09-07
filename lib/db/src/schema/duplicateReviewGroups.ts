import { jsonb, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A manager-visible ledger of duplicate groups discovered by an import or a
// later review scan. A scan may only add a group; it must never reopen a group
// that another manager already resolved or ignored. The scope column keeps the
// live facility and the sandbox facility completely separate.
export const duplicateReviewGroupsTable = pgTable(
  "duplicate_review_groups",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    groupKey: text("group_key").notNull(),
    category: text("category").notNull().default("ingredient"),
    brand: text("brand"),
    target: text("target").notNull(),
    sources: jsonb("sources").$type<string[]>().notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    scopeGroupKeyIdx: uniqueIndex("duplicate_review_groups_scope_group_key_idx").on(
      table.scope,
      table.groupKey,
    ),
    pendingIdx: index("duplicate_review_groups_scope_status_idx").on(
      table.scope,
      table.status,
    ),
  }),
);

export const insertDuplicateReviewGroupSchema = createInsertSchema(duplicateReviewGroupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type InsertDuplicateReviewGroup = z.infer<typeof insertDuplicateReviewGroupSchema>;
export type DuplicateReviewGroup = typeof duplicateReviewGroupsTable.$inferSelect;