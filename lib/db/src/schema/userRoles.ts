import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Staff access-control roles, keyed by Clerk user id. A user's role gates the
// sensitive server routes (master-data writes, the paid AI photo intake, and
// settings). Rows are created on demand the first time a signed-in user is seen
// (see getOrCreateUserRole in the api-server). `email`/`name` are a best-effort
// snapshot from Clerk so the staff-roster UI can show a human-readable identity
// without a Clerk lookup per render.
export const userRolesTable = pgTable("user_roles", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  role: text("role").notNull().default("operator"), // "manager" | "operator"
  email: text("email"),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = typeof userRolesTable.$inferSelect;
