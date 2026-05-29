import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const dailySyncTable = pgTable("daily_sync", {
  date: text("date").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DailySync = typeof dailySyncTable.$inferSelect;
