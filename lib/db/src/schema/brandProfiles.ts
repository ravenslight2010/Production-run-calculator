import {
  pgTable,
  text,
  jsonb,
  bigint,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Factory-wide brand+flavor SETUP PROFILES (the saved run form for a product):
// applicator types, pep types, die type, recipes, packaging, crust settings.
// Moved out of the per-day sync payload (where they travelled as an unstamped
// map and last-push-won) into their own master-data table like the Cheese /
// Dough / Sauce recipe pools.
//
// `key` is the client's canonical profile key `${brandLc}__${flavorLc}` (the
// same key localStorage uses), so upserts are idempotent and web/mobile agree
// on identity. `brand`/`flavor` keep the display casing. The profile payload
// stays split exactly as the client stores it: `values` is the dough-blob
// (everything except crust fields) and `crustValues` the crust-blob.
//
// `updatedAtMs` is the CLIENT edit stamp (ms epoch) used for per-profile
// last-write-wins: the upsert only overwrites when the incoming stamp is
// strictly newer, so a stale device re-publishing an old form can no longer
// clobber a fresher edit (the failure mode of the old sync-map transport).
//
// `scope` isolates the sandbox account from live via a unique index
// (key, scope) rather than a composite PRIMARY KEY, keeping the change purely
// additive and push-force-safe (see mixes / sauce_recipes for the rationale).
export const brandProfilesTable = pgTable(
  "brand_profiles",
  {
    key: text("key").notNull(),
    scope: text("scope").notNull().default("live"),
    brand: text("brand").notNull().default(""),
    flavor: text("flavor").notNull().default(""),
    values: jsonb("values").notNull().default({}).$type<Record<string, unknown>>(),
    crustValues: jsonb("crust_values").notNull().default({}).$type<Record<string, unknown>>(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brand_profiles_key_scope_idx").on(t.key, t.scope)],
);

export type BrandProfileRow = typeof brandProfilesTable.$inferSelect;
