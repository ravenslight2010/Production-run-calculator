import { pgTable, serial, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Factory-wide key-value store for master data (name lists, presets, settings,
// tombstones, history) that needs a proper server home instead of living only in
// localStorage or riding the day-state sync blob.
//
// `scope` isolates live and sandbox data — the same key can exist independently
// in each scope without colliding. `key` is a plain text identifier (e.g.
// "mergeAliases", "deniedMerges"). `value` is arbitrary JSONB — each consumer
// is responsible for validating the shape it reads/writes. `updatedAt` is set
// server-side on every upsert so clients can detect changes.
export const factoryKvTable = pgTable(
  "factory_kv",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("factory_kv_scope_key_idx").on(t.scope, t.key)],
);

export type FactoryKvRow = typeof factoryKvTable.$inferSelect;
