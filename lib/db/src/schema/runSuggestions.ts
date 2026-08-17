import { pgTable, text, integer, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// AI run-coaching suggestions ("Run Insights"). After runs finalize the web
// client compares actual throughput / tunnel timing against the configured
// settings for that product+die; when the deviation is significant AND
// consistent across multiple recent runs it posts a suggestion candidate here.
// Managers review them in the Setup tab's Run Insights card and Accept
// (applies the setting change client-side) or Dismiss. NOTHING is ever
// auto-applied — the row is only a recommendation with a status.
//
// One row per pattern: `id` is the canonical `${type}::${brand}::${flavor}::${die}`
// key (case-folded), so re-observations upsert in place and a dismissed
// pattern stays remembered (it only reopens when the drift recurs/worsens).
// Factory-wide master-data (NOT part of the per-day sync payload). `scope`
// isolates sandbox from live via a unique (id, scope) index — additive and
// push-force-safe (see productionRules for the rationale).
export const runSuggestionsTable = pgTable(
  "run_suggestions",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull().default("live"),
    // "speed-target" (cycle speed vs. observed throughput) or "tunnel-time"
    // (configured freezer/tunnel minutes vs. observed drain time).
    type: text("type").notNull(),
    brand: text("brand").notNull().default(""),
    flavor: text("flavor").notNull().default(""),
    dieType: text("die_type").notNull().default(""),
    // Values are in the UNIT OF THE SETTING being recommended (cycles/min for
    // speed-target, minutes for tunnel-time) so Accept can apply them directly.
    observedValue: doublePrecision("observed_value").notNull().default(0),
    configuredValue: doublePrecision("configured_value").notNull().default(0),
    recommendedValue: doublePrecision("recommended_value").notNull().default(0),
    unit: text("unit").notNull().default(""),
    runCount: integer("run_count").notNull().default(0),
    // Deterministic client-built stats line (grounding + AI fallback).
    statsLine: text("stats_line").notNull().default(""),
    // Plain-English explanation. AI-narrated when the provider cooperates,
    // deterministic fallback otherwise. Advisory only — the math decides
    // whether the suggestion exists at all.
    narrative: text("narrative").notNull().default(""),
    status: text("status").notNull().default("pending"),
    // Observed value at dismissal time — a dismissed pattern only reopens when
    // the drift has moved meaningfully past this (or the setting changed).
    dismissedObservedValue: doublePrecision("dismissed_observed_value"),
    // Post-accept feedback: after the next finished run of the same scope the
    // client reports whether the adjusted setting tracked reality.
    followUpNote: text("follow_up_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_suggestions_id_scope_idx").on(t.id, t.scope)],
);

export type RunSuggestionRow = typeof runSuggestionsTable.$inferSelect;
