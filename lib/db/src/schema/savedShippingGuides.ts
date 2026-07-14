import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Saved shipping & palletizing guides. When the deterministic Shipping &
// Palletizing Guide importer commits, a snapshot of the REVIEWED rows (each a
// matched brand + optional flavor targeting + the packaging patch the guide
// stated) is saved here so the Setup Profiles "Auto-Fill From Imports" panel can
// later reach back to what the palletizing guide said and cross-reference it
// against the spec sheet (the guide's numbers otherwise only ever merged into
// brand profiles at import time and were then unrecoverable). Only the most
// recent two per distinct file are kept (the route prunes older rows on insert).
// Shared factory-wide across all signed-in users, like saved spec sheets.
// `scope` isolates the sandbox account from live.
export const savedShippingGuidesTable = pgTable("saved_shipping_guides", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("live"),
  label: text("label").notNull(),
  // Stable per-file identity (normalized uploaded filename) so retention keeps
  // the two most recent versions of EACH distinct guide, not just two overall.
  // Nullable: clients that don't send one share a single legacy bucket.
  sourceKey: text("source_key"),
  // SHA-256 content fingerprint of the uploaded file bytes. Nullable: legacy rows.
  sourceHash: text("source_hash"),
  // The reviewed guide snapshot: { rows: [{ brand, flavors, patch }] }.
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedShippingGuideRow = typeof savedShippingGuidesTable.$inferSelect;
