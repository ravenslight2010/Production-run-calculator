import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
export const signupAccessCodesTable = pgTable("signup_access_codes", {
  id: uuid("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  successfulUses: integer("successful_uses").notNull().default(0),
  failedUses: integer("failed_uses").notNull().default(0),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SignupAccessCode = typeof signupAccessCodesTable.$inferSelect;