import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Factory-wide key-value store for master data (name lists, presets, settings,
// tombstones, history) that needs a proper server home instead of living only in
// localStorage or riding the day-state sync blob.
//
// `key` is a plain text primary key (e.g. "mergeAliases", "deniedMerges").
// `value` is arbitrary JSONB — each consumer is responsible for validating the
// shape it reads/writes.
// `updatedAt` is set server-side on every upsert so clients can detect changes.
export const factoryKvTable = pgTable("factory_kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FactoryKvRow = typeof factoryKvTable.$inferSelect;
