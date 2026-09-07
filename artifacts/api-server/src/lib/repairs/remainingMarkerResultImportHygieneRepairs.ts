import { and, eq, gte, isNull, sql } from "drizzle-orm";
import {
  aiCorrectionsTable,
  brandProfilesTable,
  cheeseRecipesTable,
  dataHealsTable,
  dailySyncTable,
  doughRecipesTable,
  mergeAliasesTable,
  mixesTable,
  sauceRecipesTable,
  savedSpecSheetsTable,
  specImportAliasesTable,
} from "@workspace/db";
import { sanitizeSpecAliases, type SpecImportAlias as SpecAliasEntry } from "@workspace/spec-import";
import {
  BOGUS_CHEESE_MERGE_ALIAS_PAIRS,
  isBogusMergeAlias,
  toPoolNameSet,
} from "../mergeAliasPurge";
import {
  healSeaSaltComponents,
  SEA_SALT_DOUGH_TARGETS,
  SEA_SALT_MIX_TARGETS,
  SEA_SALT_SAUCE_TARGETS,
} from "../seaSaltHeal";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const DATA_HEAL_RESULT_BACKFILL_REPAIR_ID = "data-heal-result-backfill-v1";
export const SPEC_ALIAS_HYGIENE_PURGE_REPAIR_ID = "spec-alias-hygiene-purge-v1";
export const BOGUS_MERGE_ALIAS_PURGE_REPAIR_ID = "bogus-merge-alias-purge-v1";
export const SEA_SALT_ALIAS_UNDO_REPAIR_ID = "sea-salt-alias-undo-v1";
export const BASHA_HANNAFORD_CROSSLINK_PARSE_PURGE_REPAIR_ID =
  "basha-hannaford-crosslink-parse-purge-v1";

const HISTORICAL_RESULT_BUFFER_MS = 10 * 60 * 1000;
const INGREDIENT_ALIAS_KINDS = ["cheeseIngredient", "doughIngredient", "sauceIngredient"];

function automaticRepair(
  definition: Omit<RepairDefinition<RepairTransaction>, "mode" | "executionMode" | "resultOwnership" | "managerAllowed">,
): RepairDefinition<RepairTransaction> {
  return Object.freeze({
    ...definition,
    mode: "automatic" as const,
    executionMode: "runner-transactional" as const,
    resultOwnership: "runner-marker" as const,
    managerAllowed: false,
    dependencies: Object.freeze([...definition.dependencies]),
    safety: Object.freeze({ ...definition.safety }),
  });
}

export const dataHealResultBackfillRepair = automaticRepair({
  id: DATA_HEAL_RESULT_BACKFILL_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: [],
  eligibility: "Existing non-self data-heal markers whose released result is NULL.",
  safety: {
    affectedScope: "NULL legacy data_heals marker rows excluding this repair's own marker.",
    excludedScope: "Markers that already have a stored result and this repair's marker.",
    rollback: "Only marker annotations are added; an explicit reviewed repair can clear an annotation.",
    evidence: "Released marker id and approximate current-state counts around each marker's applied_at.",
  },
  async execute(tx) {
    const legacyRows = await tx
      .select({ id: dataHealsTable.id, appliedAt: dataHealsTable.appliedAt })
      .from(dataHealsTable)
      .where(and(
        isNull(dataHealsTable.result),
        sql`${dataHealsTable.id} <> ${DATA_HEAL_RESULT_BACKFILL_REPAIR_ID}`,
      ))
      .for("update");
    let annotated = 0;
    for (const heal of legacyRows) {
      const windowStart = new Date(heal.appliedAt.getTime() - HISTORICAL_RESULT_BUFFER_MS);
      const windowStartMs = windowStart.getTime();
      const profiles = await tx.select({ count: sql<number>`count(*)` }).from(brandProfilesTable)
        .where(gte(brandProfilesTable.updatedAtMs, windowStartMs));
      const cheese = await tx.select({ count: sql<number>`count(*)` }).from(cheeseRecipesTable)
        .where(gte(cheeseRecipesTable.updatedAt, windowStart));
      const mixes = await tx.select({ count: sql<number>`count(*)` }).from(mixesTable)
        .where(gte(mixesTable.updatedAt, windowStart));
      const dough = await tx.select({ count: sql<number>`count(*)` }).from(doughRecipesTable)
        .where(gte(doughRecipesTable.updatedAt, windowStart));
      const sauces = await tx.select({ count: sql<number>`count(*)` }).from(sauceRecipesTable)
        .where(gte(sauceRecipesTable.updatedAt, windowStart));
      const syncRows = await tx.select({ count: sql<number>`count(*)` }).from(dailySyncTable)
        .where(gte(dailySyncTable.updatedAt, windowStart));
      await tx.update(dataHealsTable).set({
        result: {
          backfilled: true,
          approximate: true,
          method: "current rows updated within 10 minutes before applied_at",
          note: "Exact historical counts were not stored when this heal ran; counts may include unrelated edits.",
          windowStart: windowStart.toISOString(),
          currentStateCounts: {
            brandProfiles: Number(profiles[0]?.count ?? 0),
            cheeseRecipes: Number(cheese[0]?.count ?? 0),
            mixes: Number(mixes[0]?.count ?? 0),
            doughRecipes: Number(dough[0]?.count ?? 0),
            sauceRecipes: Number(sauces[0]?.count ?? 0),
            dailySyncRows: Number(syncRows[0]?.count ?? 0),
          },
        },
      }).where(eq(dataHealsTable.id, heal.id));
      annotated++;
    }
    return {
      annotated,
      bufferMinutes: HISTORICAL_RESULT_BUFFER_MS / 60_000,
      note: "Backfilled NULL legacy results with approximate current-state counts; NULL means no result was recorded before this migration.",
    };
  },
});

export const specAliasHygienePurgeRepair = automaticRepair({
  id: SPEC_ALIAS_HYGIENE_PURGE_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: ["cheese-import-poison-cleanup-v1"],
  eligibility: "Spec-import aliases rejected by sanitizeSpecAliases within their own scope.",
  safety: {
    affectedScope: "Invalid learned spec-import aliases in every scope.",
    excludedScope: "Aliases retained by sanitizeSpecAliases.",
    rollback: "Deleted learned aliases require a reviewed re-creation if later proven valid.",
    evidence: "The shared sanitizeSpecAliases implementation and released marker id.",
  },
  async execute(tx) {
    const rows = await tx.select().from(specImportAliasesTable).for("update");
    const byScope = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byScope.get(row.scope);
      if (list) list.push(row);
      else byScope.set(row.scope, [row]);
    }
    const dropIds: number[] = [];
    for (const scopeRows of byScope.values()) {
      const entries: SpecAliasEntry[] = scopeRows.map((row) => ({
        kind: row.kind as SpecAliasEntry["kind"], externalName: row.externalName,
        canonicalName: row.canonicalName, context: row.context,
      }));
      const kept = new Set(sanitizeSpecAliases(entries));
      for (let i = 0; i < scopeRows.length; i++) if (!kept.has(entries[i])) dropIds.push(scopeRows[i].id);
    }
    let deletedRows = 0;
    for (const id of dropIds) {
      const deleted = await tx.delete(specImportAliasesTable).where(eq(specImportAliasesTable.id, id))
        .returning({ id: specImportAliasesTable.id });
      deletedRows += deleted.length;
    }
    return { scanned: rows.length, deletedRows };
  },
});

export const bogusMergeAliasPurgeRepair = automaticRepair({
  id: BOGUS_MERGE_ALIAS_PURGE_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: ["dough-merge-vanish-restore-v1"],
  eligibility: "Bogus cheese merge aliases whose canonical target still lacks a same-scope cheese recipe.",
  safety: {
    affectedScope: "Released bogus cheese merge pairs and their mirrored corrections in every scope.",
    excludedScope: "Aliases whose canonical target has acquired a same-scope cheese recipe.",
    rollback: "Deleted learned mappings require a reviewed re-creation if later proven valid.",
    evidence: "The merge alias predicate, audited pair list, and released marker id.",
  },
  async execute(tx) {
    const pool = await tx.select({ scope: cheeseRecipesTable.scope, name: cheeseRecipesTable.name }).from(cheeseRecipesTable);
    const poolByScope = new Map<string, Set<string>>();
    for (const row of pool) {
      let names = poolByScope.get(row.scope);
      if (!names) poolByScope.set(row.scope, names = new Set<string>());
      toPoolNameSet([row.name]).forEach((name) => names!.add(name));
    }
    const aliases = await tx.select().from(mergeAliasesTable).where(eq(mergeAliasesTable.category, "cheese")).for("update");
    let deletedAliases = 0;
    for (const row of aliases) {
      if (!isBogusMergeAlias(row, poolByScope.get(row.scope) ?? new Set<string>())) continue;
      await tx.delete(mergeAliasesTable).where(eq(mergeAliasesTable.id, row.id));
      deletedAliases++;
    }
    let deletedCorrections = 0;
    for (const [external, canonical] of BOGUS_CHEESE_MERGE_ALIAS_PAIRS) {
      const deleted = await tx.delete(aiCorrectionsTable).where(and(
        eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, external),
        eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, canonical),
      )).returning({ id: aiCorrectionsTable.id });
      deletedCorrections += deleted.length;
    }
    return { scanned: aliases.length, deletedAliases, deletedCorrections };
  },
});

export const seaSaltAliasUndoRepair = automaticRepair({
  id: SEA_SALT_ALIAS_UNDO_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: ["smd-pep-cheese-mix-restore-v1"],
  eligibility: "Released Sea Salt to Salt aliases and source-grounded poisoned component rows.",
  safety: {
    affectedScope: "The exact Sea Salt alias pair and helper-approved dough, sauce, and mix components in every scope.",
    excludedScope: "Other aliases and components not approved by the source-grounded Sea Salt helper.",
    rollback: "Deleted learned aliases require reviewed re-creation; component changes require an explicit reviewed repair.",
    evidence: "Sea Salt target lists, grounding helper, and released marker id.",
  },
  async execute(tx) {
    let deletedRows = 0;
    for (const kind of INGREDIENT_ALIAS_KINDS) {
      const deleted = await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.kind, kind),
        eq(sql`lower(trim(${specImportAliasesTable.externalName}))`, "sea salt"),
        eq(sql`lower(trim(${specImportAliasesTable.canonicalName}))`, "salt"),
      )).returning({ id: specImportAliasesTable.id });
      deletedRows += deleted.length;
    }
    const corrections = await tx.delete(aiCorrectionsTable).where(and(
      eq(aiCorrectionsTable.domain, "ingredient"),
      eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, "sea salt"),
      eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, "salt"),
    )).returning({ id: aiCorrectionsTable.id });
    deletedRows += corrections.length;
    let renamedRecipes = 0;
    const doughRows = await tx.select().from(doughRecipesTable).for("update");
    for (const row of doughRows) {
      const healed = healSeaSaltComponents(
        row.name, Array.isArray(row.components) ? row.components : [], SEA_SALT_DOUGH_TARGETS,
        (component) => typeof component.lbs === "number" ? component.lbs : 0,
      );
      if (!healed) continue;
      await tx.update(doughRecipesTable).set({ components: healed, updatedAt: new Date() })
        .where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, row.scope)));
      renamedRecipes++;
    }
    const sauceRows = await tx.select().from(sauceRecipesTable).for("update");
    for (const row of sauceRows) {
      const healed = healSeaSaltComponents(
        row.name, Array.isArray(row.components) ? row.components : [], SEA_SALT_SAUCE_TARGETS,
        (component) => typeof component.lbs === "number" ? component.lbs : 0,
      );
      if (!healed) continue;
      await tx.update(sauceRecipesTable).set({ components: healed, updatedAt: new Date() })
        .where(and(eq(sauceRecipesTable.id, row.id), eq(sauceRecipesTable.scope, row.scope)));
      renamedRecipes++;
    }
    const mixRows = await tx.select().from(mixesTable).for("update");
    for (const row of mixRows) {
      const healed = healSeaSaltComponents(
        row.name, Array.isArray(row.components) ? row.components : [], SEA_SALT_MIX_TARGETS,
        (component) => typeof component.perPizza === "number" ? component.perPizza : 0,
      );
      if (!healed) continue;
      await tx.update(mixesTable).set({ components: healed, updatedAt: new Date() })
        .where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope)));
      renamedRecipes++;
    }
    return { deletedRows, renamedRecipes };
  },
});

export const bashaHannafordCrosslinkParsePurgeRepair = automaticRepair({
  id: BASHA_HANNAFORD_CROSSLINK_PARSE_PURGE_REPAIR_ID,
  owner: "historical-data-repair",
  dependencies: ["bogus-merge-alias-purge-v1"],
  eligibility: "Basha-sourced saved parses embedding the released Lowe's/Hannaford cross-link.",
  safety: {
    affectedScope: "Saved spec sheets with a Basha source key and the exact cross-linked text in every scope.",
    excludedScope: "All other saved parses, including corrected Basha parses.",
    rollback: "Deleted stale parse snapshots must be regenerated by re-import.",
    evidence: "Released text predicate, spec-import v15 parse-version bump, and marker id.",
  },
  async execute(tx) {
    const deleted = await tx.delete(savedSpecSheetsTable).where(and(
      sql`lower(coalesce(${savedSpecSheetsTable.sourceKey}, '')) like ${"basha%"}`,
      sql`${savedSpecSheetsTable.data}::text ilike ${"%lowe's/hannaford%"}`,
    )).returning({ id: savedSpecSheetsTable.id });
    return { deletedRows: deleted.length };
  },
});