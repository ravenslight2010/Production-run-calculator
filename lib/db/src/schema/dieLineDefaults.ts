import { pgTable, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Manager-editable per-die line-setting defaults. Picking a die on the run
// form / setup editor pre-fills line settings (crusts per cycle, cycle speed,
// speed adjustment, freezer time, extra case buffer). Those numbers used to be
// hard-coded in the web app; managers can now override them per die type from
// Manage Lists, so an equipment/timing change doesn't need a code change.
// Factory-wide master-data (NOT part of the per-day sync payload) so it
// survives factory data resets and fresh devices. `id` is the case-folded
// canonical die name (stable, idempotent upserts); `name` keeps the display
// spelling. `scope` isolates sandbox from live, enforced by a unique index
// (id, scope) rather than a composite PRIMARY KEY so the change stays purely
// additive and push-force-safe (see productionRules for the rationale).
export const dieLineDefaultsTable = pgTable(
  "die_line_defaults",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    name: text("name").notNull(),
    crustsPerCycle: doublePrecision("crusts_per_cycle").notNull().default(0),
    cycleSpeed: doublePrecision("cycle_speed").notNull().default(0),
    speedAdjustment: doublePrecision("speed_adjustment").notNull().default(1),
    freezerTime: doublePrecision("freezer_time").notNull().default(0),
    casesPerLayer: doublePrecision("cases_per_layer").notNull().default(0),
    preTunnelMin: doublePrecision("pre_tunnel_min"),
    postTunnelMin: doublePrecision("post_tunnel_min"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("die_line_defaults_id_scope_idx").on(t.id, t.scope)],
);

export type DieLineDefaultsRow = typeof dieLineDefaultsTable.$inferSelect;
