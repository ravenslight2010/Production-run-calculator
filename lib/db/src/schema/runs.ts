import { pgTable, serial, text, numeric, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productionRunsTable = pgTable("production_runs", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().default(""),
  casesNeeded: integer("cases_needed").notNull(),
  casesLeft: integer("cases_left").notNull(),
  skidsCompleted: integer("skids_completed").notNull(),
  pizzasPerMin: numeric("pizzas_per_min", { precision: 8, scale: 2 }).notNull(),
  totalTimeSec: integer("total_time_sec").notNull(),
  batchesNeeded: numeric("batches_needed", { precision: 8, scale: 2 }).notNull(),
  inputs: jsonb("inputs").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionRunSchema = createInsertSchema(productionRunsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProductionRun = z.infer<typeof insertProductionRunSchema>;
export type ProductionRun = typeof productionRunsTable.$inferSelect;
