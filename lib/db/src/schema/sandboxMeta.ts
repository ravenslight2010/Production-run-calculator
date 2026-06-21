import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

// Singleton bookkeeping row for the isolated "sandbox" data scope. `copiedAt`
// records the wall-clock moment the sandbox was last re-copied from live (set by
// resetSandbox). Clients read it (via the StaffMember payload) to show the
// "Sandbox copied from live at …" banner timestamp, and the server uses it to
// decide when an automatic re-copy is due (see SANDBOX_STALE_MS in lib/sandbox).
// `id` is a fixed integer singleton (always 1), not a serial — additive and
// push-safe on an already-populated database.
export const sandboxMetaTable = pgTable("sandbox_meta", {
  id: integer("id").primaryKey(),
  copiedAt: timestamp("copied_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SandboxMeta = typeof sandboxMetaTable.$inferSelect;
