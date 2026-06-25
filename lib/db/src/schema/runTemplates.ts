import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Facility-wide run templates (saved run-setup presets). These used to live in
// each device's local storage (`run-calc-templates`), which meant a template
// saved on one device never showed up on another. They are now server-side
// master-data so they follow the facility, like freezer-pull items / production
// rules, and are NOT part of the per-day sync payload.
//
// `values` holds the run configuration in the shared cross-platform wire shape
// (the same `WebFormValues` the sync payload uses for a run); each app maps it
// to/from its own local form shape. It is opaque to the server (stored as
// jsonb) — the server only owns the envelope (id/name/createdAt).
//
// `id` is a client-generated stable id so upserts are idempotent. `scope`
// isolates the sandbox account's templates from live, enforced by a unique index
// (id, scope) rather than a composite PRIMARY KEY so the change stays purely
// additive and push-force-safe (see freezerPullItems for the same rationale).
export const runTemplatesTable = pgTable(
  "run_templates",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    values: jsonb("values").notNull(),
    brand: text("brand"),
    flavor: text("flavor"),
    createdAt: text("created_at").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_templates_id_scope_idx").on(t.id, t.scope)],
);

export type RunTemplateRow = typeof runTemplatesTable.$inferSelect;
