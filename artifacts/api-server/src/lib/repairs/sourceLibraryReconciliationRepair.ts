import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
  specImportAliasesTable,
} from "@workspace/db";
import {
  loadSourceLibraryReconciliationPlan,
  SOURCE_LIBRARY_RECONCILIATION_FROM_DATE,
  SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
  SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID,
} from "../sourceLibraryReconciliationHeal";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

const SOURCE_LINK_FIELDS = [
  "doughRecipeName",
  "frontlineRecipeName",
  "app1CheeseRecipeName",
  "app2CheeseRecipeName",
  "app3CheeseRecipeName",
  "app4CheeseRecipeName",
] as const;

const reconciliationName = (value: unknown) => String(value ?? "").trim().toLowerCase();
const reconciliationZeroComponents = (components: unknown) =>
  Array.isArray(components) && components.every((component) => {
    if (!component || typeof component !== "object") return true;
    const row = component as Record<string, unknown>;
    return ["lbs", "ozPerPizza", "perPizza"].every((key) => {
      const value = Number(row[key] ?? 0);
      return !Number.isFinite(value) || value === 0;
    });
  });

const executeSourceLibraryReconciliation = async (tx: RepairTransaction) => {
    // Parsing is read-only and fails closed if the checked-in evidence was
    // accidentally altered. The plan itself contains no database data and no
    // full records are logged.
    const plan = loadSourceLibraryReconciliationPlan();

    // These locks make the reference scan + repoint + conditional deletes one
    // serialization point with ordinary profile/day writes.
    await tx.execute(sql`LOCK TABLE ${brandProfilesTable} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`LOCK TABLE ${dailySyncTable} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`LOCK TABLE ${specImportAliasesTable} IN SHARE ROW EXCLUSIVE MODE`);

    const byTable = <T extends { table: string }>(table: string) =>
      [...plan.replacements, ...plan.links].filter((proposal) => proposal.table === table);
    const doughTargets = byTable("dough_recipes");
    const sauceTargets = byTable("sauce_recipes");
    const cheeseTargets = [...byTable("cheese_recipes"), ...plan.allZeroStubs];
    const mixTargets = byTable("mixes");
    const selectLocked = async <T extends { id: any }>(
      table: any,
      targets: Array<{ before?: { id: string }; id?: string }>,
    ) =>
      targets.length === 0
        ? [] as T[]
        : await tx.select().from(table)
          .where(and(
            eq(table.scope, "live"),
            inArray(table.id, [...new Set(targets.map((target) => target.before?.id ?? target.id!))]),
          ))
          .for("update") as T[];
    const doughRows = await selectLocked<any>(doughRecipesTable, doughTargets);
    const sauceRows = await selectLocked<any>(sauceRecipesTable, sauceTargets);
    const cheeseRows = await selectLocked<any>(cheeseRecipesTable, cheeseTargets);
    const mixRows = await selectLocked<any>(mixesTable, mixTargets);
    const canonicalStubRows = await tx.select().from(cheeseRecipesTable).where(and(
      eq(cheeseRecipesTable.scope, "live"),
      inArray(cheeseRecipesTable.id, plan.allZeroStubs.map((stub) => stub.canonicalId)),
    )).for("update");

    const rowFor = (rows: any[], proposal: { before: { id: string; name: string } }) =>
      rows.find((row) => row.id === proposal.before.id && row.name === proposal.before.name);
    let replaced = 0;
    for (const proposal of plan.replacements) {
      const after = proposal.after;
      if (proposal.table === "dough_recipes") {
        const row = rowFor(doughRows, proposal); if (!row) continue;
        await tx.update(doughRecipesTable).set({
          components: after.components as any, doughballVariants: after.doughballVariants as any,
          doughballWeightOz: after.doughballWeightOz as number, doughballsPerTray: after.doughballsPerTray as number,
          updatedAt: new Date(),
        }).where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, "live"))); replaced++;
      } else if (proposal.table === "sauce_recipes") {
        const row = rowFor(sauceRows, proposal); if (!row) continue;
        await tx.update(sauceRecipesTable).set({
          components: after.components as any, updatedAt: new Date(),
        }).where(and(eq(sauceRecipesTable.id, row.id), eq(sauceRecipesTable.scope, "live"))); replaced++;
      } else if (proposal.table === "cheese_recipes") {
        const row = rowFor(cheeseRows, proposal); if (!row) continue;
        await tx.update(cheeseRecipesTable).set({
          components: after.components as any, brand: after.brand as string, flavors: after.flavors as string[],
          shredderSetting: after.shredderSetting as string, cellulose: after.cellulose as string,
          notes: after.notes as string, updatedAt: new Date(),
        }).where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, "live"))); replaced++;
      } else {
        const row = rowFor(mixRows, proposal); if (!row) continue;
        await tx.update(mixesTable).set({
          components: after.components as any, brand: after.brand as string, flavor: after.flavor as string,
          batchSize: after.batchSize as number, daysEarly: after.daysEarly as number,
          ...(typeof after.notes === "string" ? { notes: after.notes } : {}),
          updatedAt: new Date(),
        }).where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, "live"))); replaced++;
      }
    }

    const names = new Map<string, string>();
    const key = (table: string, name: unknown) => `${table}\u0000${reconciliationName(name)}`;
    let aliasesInserted = 0;
    const aliases = await tx.select().from(specImportAliasesTable)
      .where(eq(specImportAliasesTable.scope, "live")).for("update");
    for (const proposal of plan.links) {
      const rows = proposal.table === "cheese_recipes" ? cheeseRows : mixRows;
      const row = rowFor(rows, proposal);
      if (!row) continue;
      const sourceName = String(proposal.after.sourceName);
      names.set(key(proposal.table, sourceName), row.name);
      const existing = aliases.some((alias) =>
        alias.kind === "appType" && alias.context == null &&
        reconciliationName(alias.externalName) === reconciliationName(sourceName) &&
        reconciliationName(alias.canonicalName) === reconciliationName(row.name));
      if (!existing) {
        await tx.insert(specImportAliasesTable).values({
          scope: "live", kind: "appType", externalName: sourceName, canonicalName: row.name, context: null,
        });
        aliasesInserted++;
      }
    }
    for (const stub of plan.allZeroStubs) {
      const canonical = canonicalStubRows.find((row) =>
        row.id === stub.canonicalId && row.name === stub.canonicalName);
      if (!canonical) continue;
      names.set(key("cheese_recipes", stub.name), canonical.name);
      const existing = aliases.some((alias) =>
        alias.kind === "appType" && alias.context == null &&
        reconciliationName(alias.externalName) === reconciliationName(stub.name) &&
        reconciliationName(alias.canonicalName) === reconciliationName(canonical.name));
      if (!existing) {
        await tx.insert(specImportAliasesTable).values({
          scope: "live", kind: "appType", externalName: stub.name, canonicalName: canonical.name, context: null,
        });
        aliasesInserted++;
      }
    }
    const replacementRows: Array<[string, any[]]> = [
      ["dough_recipes", doughRows], ["sauce_recipes", sauceRows],
      ["cheese_recipes", cheeseRows], ["mixes", mixRows],
    ];
    for (const proposal of plan.replacements) {
      const row = rowFor(replacementRows.find(([table]) => table === proposal.table)![1], proposal);
      if (row) names.set(key(proposal.table, proposal.before.name), row.name);
    }
    const repoint = (values: Record<string, unknown>) => {
      let changed = false;
      for (const field of SOURCE_LINK_FIELDS) {
        const table = field === "doughRecipeName" ? "dough_recipes" :
          field === "frontlineRecipeName" ? "sauce_recipes" : undefined;
        const candidates = table ? [names.get(key(table, values[field]))] :
          [names.get(key("cheese_recipes", values[field])), names.get(key("mixes", values[field]))];
        const canonical = candidates.find(Boolean);
        if (canonical && values[field] !== canonical) { values[field] = canonical; changed = true; }
      }
      return changed;
    };
    const profiles = await tx.select().from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, "live")).for("update");
    let repointedProfiles = 0;
    for (const profile of profiles) {
      const values = { ...(profile.values ?? {}) } as Record<string, unknown>;
      const crustValues = { ...(profile.crustValues ?? {}) } as Record<string, unknown>;
      const valuesChanged = repoint(values);
      const crustValuesChanged = repoint(crustValues);
      if (!valuesChanged && !crustValuesChanged) continue;
      await tx.update(brandProfilesTable).set({
        values, crustValues, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()),
      }).where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, "live")));
      repointedProfiles++;
    }

    const days = await tx.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, "live"), gte(dailySyncTable.date, SOURCE_LIBRARY_RECONCILIATION_FROM_DATE),
    )).for("update");
    const allLiveDays = await tx.select().from(dailySyncTable)
      .where(eq(dailySyncTable.scope, "live")).for("update");
    let repointedRuns = 0;
    for (const day of days) {
      const data = { ...(day.data as Record<string, unknown>) };
      const runs = ((data.dayState as Record<string, unknown> | undefined)?.runs ?? data.runs) as unknown;
      const runValues = data.runValues as Record<string, Record<string, unknown>> | undefined;
      if (!Array.isArray(runs) || !runValues || typeof runValues !== "object") continue;
      const stamps = { ...((data.runValuesUpdatedAt as Record<string, unknown>) ?? {}) };
      let changed = false;
      for (const run of runs) {
        if (!run || typeof run !== "object") continue;
        const id = String((run as Record<string, unknown>).id ?? "");
        if (!id || (run as Record<string, unknown>).startedAt != null ||
          (run as Record<string, unknown>).endedAt != null || !runValues[id]) continue;
        const values = { ...runValues[id] };
        if (!repoint(values)) continue;
        const stamp = Math.max(Number(stamps[id] ?? values.valuesUpdatedAtMs ?? 0) + 1, Date.now());
        values.valuesUpdatedAtMs = stamp; runValues[id] = values; stamps[id] = stamp;
        changed = true; repointedRuns++;
      }
      if (changed) await tx.update(dailySyncTable).set({
        data: { ...data, runValues, runValuesUpdatedAt: stamps }, updatedAt: new Date(),
      }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, "live")));
    }

    const postProfiles = await tx.select().from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, "live")).for("update");
    const postDays = await tx.select().from(dailySyncTable)
      .where(eq(dailySyncTable.scope, "live")).for("update");
    const referenced = new Set<string>();
    for (const profile of postProfiles) for (const values of [profile.values, profile.crustValues]) {
      for (const field of SOURCE_LINK_FIELDS) referenced.add(reconciliationName((values as Record<string, unknown>)[field]));
    }
    for (const day of postDays) {
      const runValues = (day.data as Record<string, unknown>).runValues as Record<string, Record<string, unknown>> | undefined;
      for (const values of Object.values(runValues ?? {})) for (const field of SOURCE_LINK_FIELDS) referenced.add(reconciliationName(values[field]));
    }
    let deletedStubs = 0;
    for (const stub of plan.allZeroStubs) {
      const row = cheeseRows.find((candidate) => candidate.id === stub.id && candidate.name === stub.name);
      if (!row || !reconciliationZeroComponents(row.components) || referenced.has(reconciliationName(row.name))) continue;
      await tx.delete(cheeseRecipesTable).where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, "live")));
      deletedStubs++;
    }
    return { replacements: replaced, aliasesInserted, repointedProfiles, repointedRuns, deletedStubs };
};

const reconciliationSafety = {
  affectedScope: "Live approved dough, sauce, cheese, and mix rows; live profiles; and unstarted live runs dated 2026-08-26 or later.",
  excludedScope: "Rows whose audited id/name guard is stale, non-live rows, completed runs, historical run values, and still-referenced cheese stubs.",
  rollback: "The runner marker retains the bounded result; reversing a replacement, alias, repoint, or deletion requires an explicit reviewed repair.",
  evidence: "The checked-in audited plan is hash-validated before mutation, and each target is guarded by its reviewed id and name.",
} as const;

const reconciliationEligibility =
  "Live rows whose audited id and name still match the approved 2026-08-26 source-library reconciliation plan.";

export const sourceLibraryReconciliationRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
  owner: "source-library-reconciliation",
  dependencies: ["incident-resolved-workflow-reconciliation-v1"],
  eligibility: reconciliationEligibility,
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: reconciliationSafety,
  execute: executeSourceLibraryReconciliation,
  validateResult: (result) => ["replacements", "aliasesInserted", "repointedProfiles", "repointedRuns", "deletedStubs"]
    .every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0),
});

/**
 * Fresh, marker-distinct rerun of the same independently fingerprinted plan.
 * The registry places this after v1, so a normal startup first observes the
 * historical marker and then claims v2 atomically before touching rows.
 */
export const sourceLibraryReconciliationRerunRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID,
  owner: "source-library-reconciliation-rerun",
  dependencies: [SOURCE_LIBRARY_RECONCILIATION_HEAL_ID],
  eligibility: reconciliationEligibility,
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: reconciliationSafety,
  execute: executeSourceLibraryReconciliation,
  validateResult: (result) => ["replacements", "aliasesInserted", "repointedProfiles", "repointedRuns", "deletedStubs"]
    .every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0),
});