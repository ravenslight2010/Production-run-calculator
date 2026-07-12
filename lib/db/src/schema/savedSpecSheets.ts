import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Saved spec sheets. When the Excel spec-sheet importer commits an import, a
// snapshot of the parsed spec sheet (profiles + recipes, the canonicalized
// ParsedSpecImport) is saved here so the AI can later cross-reference it against
// the CURRENT recipe library and report discrepancies ("does the recipe still
// match the spec?"). Only the most recent two are kept (the route prunes older
// rows on insert). Shared factory-wide across all signed-in users, like the
// learned spec-import aliases. `scope` isolates the sandbox account from live.
export const savedSpecSheetsTable = pgTable("saved_spec_sheets", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  label: text("label").notNull(),
  // Stable per-file identity (normalized uploaded filename) so retention keeps the
  // two most recent versions of EACH distinct spec sheet, not just two overall.
  // Nullable: older/mobile clients that don't send one share a single legacy bucket.
  sourceKey: text("source_key"),
  // SHA-256 content fingerprint of the uploaded file bytes (per-file hashes
  // sorted + re-hashed for multi-file imports). Lets a re-import of the EXACT
  // same file reuse this snapshot's parse instead of re-running the AI (whose
  // read of the same sheet can drift between calls). Nullable: legacy rows.
  sourceHash: text("source_hash"),
  // The canonicalized ParsedSpecImport ({ profiles, recipes, note? }).
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedSpecSheetRow = typeof savedSpecSheetsTable.$inferSelect;
