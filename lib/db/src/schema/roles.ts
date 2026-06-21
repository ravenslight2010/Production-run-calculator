import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Data-driven access-control roles. Each role is a NAME plus a set of
// capability strings. A user's role (user_roles.role, free-text) links here by
// name; resolving a user's capabilities = look up their role here and read its
// `capabilities`. This replaces the old hardcoded role ladder
// (operator/supervisor/manager/qc-*/warehouse/inventory) with editable roles.
//
// `builtin` roles (manager, operator) are seeded and cannot be deleted — new
// users default to "operator", and "manager" is the all-capabilities admin
// role. Managers may still retune the capability sets of any role.
export const rolesTable = pgTable("roles", {
  name: text("name").primaryKey(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  builtin: boolean("builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoleRow = typeof rolesTable.$inferSelect;
