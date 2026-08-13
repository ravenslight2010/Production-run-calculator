import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One-time server-side data heals. Each heal is a targeted, code-shipped data
// correction that must run EXACTLY ONCE per database (dev and production each
// have their own copy of this table, so a heal applies to each environment the
// first time that environment boots with the code that defines it). The row's
// `id` is the heal's stable name; its presence means "already applied — skip".
//
// This exists because the production database is not hand-editable: bad rows
// created through the app (e.g. poisoned learned import matches) can only be
// corrected by shipping code, and that code must not re-run on every boot.
// Purely additive table — safe for `db push-force` on a populated database.
export const dataHealsTable = pgTable("data_heals", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  result: jsonb("result"),
});

export type DataHeal = typeof dataHealsTable.$inferSelect;
