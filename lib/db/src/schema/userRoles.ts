import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Staff access-control roles, keyed by our internal user id (FK -> users.id). A
// user's role gates the sensitive server routes (master-data writes, the paid AI
// photo intake, and settings). The row is created at sign-up (see lib/auth /
// lib/roles in the api-server). The displayable identity (username) lives on the
// users table and is joined in when building the staff roster.
export const userRolesTable = pgTable("user_roles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("operator"), // "manager" | "operator"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = typeof userRolesTable.$inferSelect;
