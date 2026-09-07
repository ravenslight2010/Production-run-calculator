import { and, eq, gte, sql } from "drizzle-orm";
import {
  aiCorrectionsTable,
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  importAliasesTable,
  mixesTable,
  savedSpecSheetsTable,
  specImportAliasesTable,
} from "@workspace/db";
import {
  backfillCheeseSharePcts,
  normalizeCheeseRecipe,
  type CheeseRecipe,
} from "@workspace/cheese-recipes";
import {
  POISONED_CHEESE_ALIAS_PAIRS,
  POISONED_FLAVOR_PAIR,
  POISONED_FLAVOR_BRAND_CONTEXT,
  healCheesePicksInPayload,
} from "../cheesePickHeal";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const CHEESE_IMPORT_POISON_CLEANUP_REPAIR_ID = "cheese-import-poison-cleanup-v1";
export const CHEESE_RECIPE_NAME_DEDUPE_REPAIR_ID = "cheese-recipe-name-dedupe-v1";
export const CHEESE_NAMED_MIX_CROSSOVER_PURGE_REPAIR_ID = "cheese-named-mix-crossover-purge-v1";
export const SMD_PEP_CHEESE_MIX_RESTORE_REPAIR_ID = "smd-pep-cheese-mix-restore-v1";
export const ALDO_CHEESE_TOLERANCE_OZ_REPAIR_ID = "aldo-cheese-tolerance-oz-v1";
export const CHEESE_COMPONENT_OZ_STRIP_REPAIR_ID = "cheese-component-oz-strip-v2";
export const CHEESE_COMPONENT_OZ_STRIP_V1_REPAIR_ID = "cheese-component-oz-strip-v1";

const HEAL_FROM_DATE = "2026-07-11";
const ALDO_CHEESE_MIX_NAME = "aldo's standard cheese mix";
const ALDO_OZ_HEAL_FROM_DATE = "2026-07-19";

function definition(
  id: string,
  dependencies: readonly string[],
  eligibility: string,
  safety: RepairDefinition<RepairTransaction>["safety"],
  execute: RepairDefinition<RepairTransaction>["execute"],
): RepairDefinition<RepairTransaction> {
  return Object.freeze({
    id,
    owner: "recipe-normalization",
    dependencies: Object.freeze([...dependencies]),
    eligibility,
    mode: "automatic" as const,
    executionMode: "runner-transactional" as const,
    resultOwnership: "runner-marker" as const,
    managerAllowed: false,
    safety: Object.freeze(safety),
    execute,
  });
}

export const cheeseImportPoisonCleanupRepair = definition(
  CHEESE_IMPORT_POISON_CLEANUP_REPAIR_ID,
  ["crb-dough-family-consolidation-v1"],
  "Only audited poisoned cheese aliases and cheese picks on 2026-07-11 and later are removed.",
  {
    affectedScope: "Poisoned learned aliases in all scopes and today-and-future daily cheese picks.",
    excludedScope: "Unrelated aliases, other brand flavor mappings, and pre-boundary history remain untouched.",
    rollback: "Deleted aliases and cleared picks require explicit source-data restoration.",
    evidence: "Exact audited alias pairs and deterministic payload healer.",
  },
  async (tx) => {
    let deletedRows = 0;
    for (const [external, canonical] of POISONED_CHEESE_ALIAS_PAIRS) {
      const a = await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.kind, "appType"),
        eq(sql`lower(${specImportAliasesTable.externalName})`, external),
        eq(sql`lower(${specImportAliasesTable.canonicalName})`, canonical),
      )).returning({ id: specImportAliasesTable.id });
      const b = await tx.delete(aiCorrectionsTable).where(and(
        eq(aiCorrectionsTable.domain, "item"),
        eq(sql`lower(${aiCorrectionsTable.fromText})`, external),
        eq(sql`lower(${aiCorrectionsTable.toText})`, canonical),
      )).returning({ id: aiCorrectionsTable.id });
      deletedRows += a.length + b.length;
    }
    const [flavorFrom, flavorTo] = POISONED_FLAVOR_PAIR;
    const c = await tx.delete(importAliasesTable).where(and(
      eq(importAliasesTable.type, "flavor"),
      eq(sql`lower(${importAliasesTable.externalName})`, flavorFrom),
      eq(sql`lower(${importAliasesTable.canonicalName})`, flavorTo),
      eq(sql`lower(coalesce(${importAliasesTable.brandContext}, ''))`, POISONED_FLAVOR_BRAND_CONTEXT),
    )).returning({ id: importAliasesTable.id });
    const d = await tx.delete(aiCorrectionsTable).where(and(
      eq(aiCorrectionsTable.domain, "flavor"),
      eq(sql`lower(${aiCorrectionsTable.fromText})`, flavorFrom),
      eq(sql`lower(${aiCorrectionsTable.toText})`, flavorTo),
    )).returning({ id: aiCorrectionsTable.id });
    deletedRows += c.length + d.length;

    const rows = await tx.select({ date: dailySyncTable.date, scope: dailySyncTable.scope, data: dailySyncTable.data })
      .from(dailySyncTable).where(gte(dailySyncTable.date, HEAL_FROM_DATE)).for("update");
    let healedRows = 0;
    let clearedPicks = 0;
    const now = Date.now();
    for (const row of rows) {
      const result = healCheesePicksInPayload(row.data, now);
      if (!result.changed) continue;
      await tx.update(dailySyncTable).set({ data: result.data, updatedAt: new Date() })
        .where(and(eq(dailySyncTable.date, row.date), eq(dailySyncTable.scope, row.scope)));
      healedRows++;
      clearedPicks += result.clearedPicks;
    }
    return { deletedRows, healedRows, clearedPicks };
  },
);

export const cheeseRecipeNameDedupeRepair = definition(
  CHEESE_RECIPE_NAME_DEDUPE_REPAIR_ID,
  ["spec-alias-hygiene-purge-v1"],
  "Only same-scope, case-insensitive exact cheese-recipe name duplicates are removed.",
  {
    affectedScope: "Duplicate cheese recipe names within each scope.",
    excludedScope: "The highest-ranked recipe and unique names are preserved.",
    rollback: "Deleted duplicate rows require explicit source-data restoration.",
    evidence: "Released rank favors pounds, then component count, then oldest row.",
  },
  async (tx) => {
    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    type Row = (typeof rows)[number];
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = `${row.scope}\u0000${row.name.trim().toLowerCase()}`;
      const list = groups.get(key);
      if (list) list.push(row); else groups.set(key, [row]);
    }
    const rank = (row: Row): [number, number, number] => {
      const components = row.components ?? [];
      return [components.some((c) => (c.lbs ?? 0) > 0) ? 1 : 0, components.length, -row.createdAt.getTime()];
    };
    const dropRows: Row[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => {
        const ra = rank(a); const rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
        return a.id.localeCompare(b.id);
      });
      dropRows.push(...sorted.slice(1));
    }
    let deletedRows = 0;
    for (const loser of dropRows) {
      const deleted = await tx.delete(cheeseRecipesTable).where(and(
        eq(cheeseRecipesTable.id, loser.id), eq(cheeseRecipesTable.scope, loser.scope),
      )).returning({ id: cheeseRecipesTable.id });
      deletedRows += deleted.length;
    }
    return { scanned: rows.length, deletedRows };
  },
);

export const cheeseNamedMixCrossoverPurgeRepair = definition(
  CHEESE_NAMED_MIX_CROSSOVER_PURGE_REPAIR_ID,
  ["generic-mix-poison-purge-v2"],
  "Only cheese-named mixes with a same-scope, case-insensitive cheese recipe match are deleted.",
  {
    affectedScope: "Crossover mix rows duplicating cheese recipes.",
    excludedScope: "Mixes without a matching cheese recipe remain untouched.",
    rollback: "Deleted crossover rows require explicit source-data restoration.",
    evidence: "Same-scope normalized name match and cheese-name predicate.",
  },
  async (tx) => {
    const cheeseRows = await tx.select({ scope: cheeseRecipesTable.scope, name: cheeseRecipesTable.name })
      .from(cheeseRecipesTable);
    const cheeseKeys = new Set(cheeseRows.map((row) => `${row.scope}\u0000${row.name.trim().toLowerCase()}`));
    const mixes = await tx.select().from(mixesTable).for("update");
    let deletedMixes = 0;
    for (const mix of mixes) {
      const nameLower = (mix.name ?? "").trim().toLowerCase();
      if (!/cheese/.test(nameLower) || !cheeseKeys.has(`${mix.scope}\u0000${nameLower}`)) continue;
      const deleted = await tx.delete(mixesTable).where(and(eq(mixesTable.id, mix.id), eq(mixesTable.scope, mix.scope)))
        .returning({ id: mixesTable.id });
      deletedMixes += deleted.length;
    }
    return { scanned: mixes.length, deletedMixes };
  },
);

export function looseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const SMD_LOST_ROWS: ReadonlyArray<{ readonly match: (key: string) => boolean; readonly lbs: number }> = Object.freeze([
  { match: (key) => key.includes("mozz"), lbs: 20 },
  { match: (key) => key.includes("provolone"), lbs: 8 },
  { match: (key) => key.includes("pepperoni"), lbs: 8 },
  { match: (key) => key.includes("romano"), lbs: 2.5 },
]);

export const smdPepCheeseMixRestoreRepair = definition(
  SMD_PEP_CHEESE_MIX_RESTORE_REPAIR_ID,
  ["dough-family-weight-depoison-v1"],
  "Only all-zero-pound SMD Pep Cheese Mix rows are restored.",
  {
    affectedScope: "Damaged SMD Pep Cheese Mix rows whose component pounds are all zero.",
    excludedScope: "Manager-restored rows with any positive pounds are preserved.",
    rollback: "Restore values are known source values; reversal requires explicit review.",
    evidence: "Released ingredient matching and SMD batch constants.",
  },
  async (tx) => {
    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let updatedRows = 0;
    for (const row of rows) {
      if (row.name.trim().toLowerCase() !== "smd pep cheese mix") continue;
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe || recipe.components.some((component) => component.lbs > 0)) continue;
      let changed = false;
      const components = recipe.components.map((component) => ({ ...component }));
      const claimedIdx = new Set<number>();
      for (const lost of SMD_LOST_ROWS) {
        const index = components.findIndex((component, i) => !claimedIdx.has(i) && lost.match(looseKey(component.ingredient)));
        if (index === -1) continue;
        claimedIdx.add(index);
        if (!(components[index].lbs > 0)) { components[index].lbs = lost.lbs; changed = true; }
      }
      if (!components.some((component) => looseKey(component.ingredient).includes("cellulose"))) {
        components.push({ ingredient: "Cellulose", lbs: 0.3 }); changed = true;
      }
      const cellulose = recipe.cellulose.trim() ? recipe.cellulose : "0.83";
      const shredderSetting = recipe.shredderSetting.trim() ? recipe.shredderSetting : "#1";
      if (cellulose !== recipe.cellulose || shredderSetting !== recipe.shredderSetting) changed = true;
      if (!changed) continue;
      await tx.update(cheeseRecipesTable).set({ components, cellulose, shredderSetting, updatedAt: new Date() })
        .where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, row.scope)));
      updatedRows++;
    }
    return { scanned: rows.length, updatedRows };
  },
);

function isAldoCheeseMixName(name: unknown): boolean {
  return typeof name === "string" && name.trim().toLowerCase() === ALDO_CHEESE_MIX_NAME;
}

export function healAldoCheeseOzInValues(values: Record<string, unknown>): boolean {
  const slots = [1, 2, 3, 4] as const;
  let donor = 0;
  for (const n of slots) {
    if (isAldoCheeseMixName(values[`app${n}CheeseRecipeName`]) && typeof values[`app${n}OzPerPizza`] === "number" &&
      (values[`app${n}OzPerPizza`] as number) >= 2) donor = Math.max(donor, values[`app${n}OzPerPizza`] as number);
  }
  if (donor <= 0) return false;
  let changed = false;
  for (const n of slots) {
    if (isAldoCheeseMixName(values[`app${n}CheeseRecipeName`]) && values[`app${n}OzPerPizza`] === 0.2) {
      values[`app${n}OzPerPizza`] = donor; changed = true;
    }
  }
  return changed;
}

export const aldoCheeseToleranceOzRepair = definition(
  ALDO_CHEESE_TOLERANCE_OZ_REPAIR_ID, ["basha-hannaford-crosslink-parse-purge-v1"],
  "Only 0.2-ounce Aldo's Standard Cheese Mix slots with a same-record donor of at least 2 ounces are repaired.",
  {
    affectedScope: "Audited saved sheets, profiles, and day-state Aldo cheese slots.",
    excludedScope: "Different mixes, values other than 0.2, records without a donor, and past day history remain untouched.",
    rollback: "Marker counts identify changed record classes; reversal requires explicit review.",
    evidence: "Same-record donor rule mirrors the audited workbook stations.",
  },
  async (tx) => {
    let healedSheets = 0;
    const sheets = await tx.select().from(savedSpecSheetsTable)
      .where(sql`${savedSpecSheetsTable.data}::text ilike ${"%aldo's standard cheese mix%"}`).for("update");
    for (const sheet of sheets) {
      const data = sheet.data as { profiles?: Array<{ applicators?: Array<{ type?: unknown; ozPerPizza?: unknown }> }> } | null;
      if (!data?.profiles) continue;
      let changed = false;
      for (const profile of data.profiles) {
        const apps = profile?.applicators;
        if (!Array.isArray(apps)) continue;
        let donor = 0;
        for (const app of apps) if (isAldoCheeseMixName(app?.type) && typeof app?.ozPerPizza === "number" && app.ozPerPizza >= 2) donor = Math.max(donor, app.ozPerPizza);
        if (donor <= 0) continue;
        for (const app of apps) if (isAldoCheeseMixName(app?.type) && app?.ozPerPizza === 0.2) { app.ozPerPizza = donor; changed = true; }
      }
      if (!changed) continue;
      await tx.update(savedSpecSheetsTable).set({ data }).where(eq(savedSpecSheetsTable.id, sheet.id));
      healedSheets++;
    }
    let healedProfiles = 0;
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    for (const profile of profiles) {
      const values = { ...(profile.values ?? {}) } as Record<string, unknown>;
      if (!healAldoCheeseOzInValues(values)) continue;
      await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()) })
        .where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, profile.scope)));
      healedProfiles++;
    }
    let healedDays = 0;
    const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, ALDO_OZ_HEAL_FROM_DATE)).for("update");
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      const runValues = data?.runValues as Record<string, Record<string, unknown>> | undefined;
      if (!runValues || typeof runValues !== "object") continue;
      let changed = false;
      for (const values of Object.values(runValues)) {
        if (!values || typeof values !== "object") continue;
        if (healAldoCheeseOzInValues(values)) {
          values.valuesUpdatedAtMs = Math.max(Number(values.valuesUpdatedAtMs ?? 0) + 1, Date.now()); changed = true;
        }
      }
      if (!changed) continue;
      await tx.update(dailySyncTable).set({ data }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope)));
      healedDays++;
    }
    return { healedSheets, healedProfiles, healedDays };
  },
);

export function recomputeCheeseSharesFromLbs(recipe: CheeseRecipe): CheeseRecipe | null {
  const comps = recipe.components;
  const hasOzProp = comps.some((component) => "ozPerPizza" in component);
  const totalLbs = comps.reduce((sum, component) => sum + Math.max(0, Number(component.lbs ?? 0)), 0);
  if (!(totalLbs > 0)) {
    if (!hasOzProp) return null;
    return { ...recipe, components: comps.map((component): typeof comps[number] => {
      if (!("ozPerPizza" in component)) return component;
      const { ozPerPizza: _ignored, ...stripped } = component as typeof component & { ozPerPizza?: unknown };
      return stripped;
    }) };
  }
  const stripped = comps.map((component): typeof comps[number] => {
    const { ozPerPizza: _ignored, sharePct: _sharePct, ...clean } = component as typeof component & { ozPerPizza?: unknown };
    return clean;
  });
  const [backfilled] = backfillCheeseSharePcts([{ ...recipe, components: stripped }]);
  const newComps = backfilled ? backfilled.components : stripped;
  if (!comps.some((component, index) => "ozPerPizza" in component || (component.sharePct ?? 0) !== (newComps[index].sharePct ?? 0))) return null;
  return { ...recipe, components: newComps };
}

// The released v1 implementation was intentionally a no-op, but it still
// claimed a durable marker before v2 ran. Keep that marker under the same
// shared transaction standard rather than writing it as a side effect of v2.
export const cheeseComponentOzStripV1Repair = definition(
  CHEESE_COMPONENT_OZ_STRIP_V1_REPAIR_ID, ["aug2026-lowes-mix-stray-component-v1"],
  "Claims the released no-op v1 marker before the corrected v2 repair.",
  {
    affectedScope: "No business rows; marker evidence only.",
    excludedScope: "All recipe and profile values remain unchanged.",
    rollback: "The marker rolls back with the shared transaction on failure.",
    evidence: "The released v2 repair historically claimed the retired v1 marker first.",
  },
  async () => ({}),
);

export const cheeseComponentOzStripRepair = definition(
  CHEESE_COMPONENT_OZ_STRIP_REPAIR_ID, [CHEESE_COMPONENT_OZ_STRIP_V1_REPAIR_ID],
  "All cheese recipes with stored component ounces or non-pound-derived shares are normalized.",
  {
    affectedScope: "Cheese component ounces and shares in every scope.",
    excludedScope: "Recipes without component ounces and already pound-derived shares are unchanged.",
    rollback: "Removed component ounces require explicit source-data restoration.",
    evidence: "Released pound-authoritative share recomputation helper.",
  },
  async (tx) => {
    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let scanned = 0; let updatedRows = 0; let strippedComponents = 0;
    for (const row of rows) {
      scanned++;
      const rawComps: unknown[] = Array.isArray(row.components) ? row.components : [];
      const rawOzCount = rawComps.filter((component): boolean => typeof component === "object" && component !== null && "ozPerPizza" in (component as object)).length;
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe) continue;
      const changed = recomputeCheeseSharesFromLbs(recipe);
      if (rawOzCount === 0 && !changed) continue;
      await tx.update(cheeseRecipesTable).set({ components: changed ? changed.components : recipe.components, updatedAt: new Date() })
        .where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, row.scope)));
      updatedRows++; strippedComponents += rawOzCount;
    }
    return { scanned, updatedRows, strippedComponents };
  },
);

export const remainingCheeseRecipeNormalizationRepairs = Object.freeze([
  cheeseImportPoisonCleanupRepair,
  cheeseRecipeNameDedupeRepair,
  cheeseNamedMixCrossoverPurgeRepair,
  smdPepCheeseMixRestoreRepair,
  aldoCheeseToleranceOzRepair,
  cheeseComponentOzStripV1Repair,
  cheeseComponentOzStripRepair,
] as const);