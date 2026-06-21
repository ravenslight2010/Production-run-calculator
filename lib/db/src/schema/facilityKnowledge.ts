import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Facility-wide AI knowledge memory: the shared "brain" every AI helper reads.
//
// Distinct from the `ai_corrections` pool (which only remembers name fixes).
// Each row here is a durable, plain-language OPERATIONAL fact the whole team and
// all AI features benefit from — a recurring downtime cause, a throughput/PPM
// trend, a recurring incident cluster, an ingredient quirk, etc. It is recorded
// by AI features (server-side or client-driven) and fed back into every AI
// prompt via a shared context builder, so a pattern learned in one feature is
// visible to all the others.
//
// `domain` is a coarse topic tag (e.g. "downtime", "throughput", "incident",
// "ingredient", "general"). `key` is a stable identity WITHIN a domain so a
// feature re-recording the same observation UPDATES it in place instead of
// piling up duplicates; matched case-insensitively on (domain, key) in the
// route. `fact` is the durable observation. `source` is an optional, advisory
// tag for which feature recorded it (never used for matching). `scope` isolates
// the sandbox account's learned facts from live.
export const facilityKnowledgeTable = pgTable(
  "facility_knowledge",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    domain: text("domain").notNull(),
    key: text("key").notNull(),
    fact: text("fact").notNull(),
    // Optional: which AI feature wrote this (e.g. "optimize", "incident"). Null
    // when not provided. Advisory only.
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("facility_knowledge_domain_key_idx").on(table.domain, table.key, table.scope),
  ],
);

export const insertFacilityKnowledgeSchema = createInsertSchema(facilityKnowledgeTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFacilityKnowledge = z.infer<typeof insertFacilityKnowledgeSchema>;
export type FacilityKnowledgeRow = typeof facilityKnowledgeTable.$inferSelect;
