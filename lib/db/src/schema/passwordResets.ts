import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Forgot-password recovery requests for the self-contained username + password
// auth system. There is no email/SMS channel, so recovery is manager-mediated:
//
//   1. A signed-out user requests a reset (status "pending"). At most one active
//      request exists per user — a new request replaces any earlier unused one.
//   2. A manager approves it, which mints a short-lived single-use code. Only the
//      code's hash is stored here; the plaintext is shown to the manager once so
//      they can relay it to the locked-out user in person.
//   3. The user enters that code with a new password. A successful reset marks the
//      request "used" so the code can never be replayed.
export const passwordResetRequestsTable = pgTable("password_reset_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // "pending" (awaiting a manager) | "approved" (code issued) | "used".
  status: text("status").notNull().default("pending"),
  // sha256 hex of the relay code; null until a manager approves the request.
  codeHash: text("code_hash"),
  // When the issued code stops being accepted; null until approved.
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type PasswordResetRequest =
  typeof passwordResetRequestsTable.$inferSelect;
