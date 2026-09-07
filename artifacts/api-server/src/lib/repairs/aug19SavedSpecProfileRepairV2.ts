import { and, eq, gte, sql } from "drizzle-orm";
import {
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  mergeAliasesTable,
  mixesTable,
  sauceRecipesTable,
  savedSpecSheetsTable,
} from "@workspace/db";
import {
  assignApplicatorSlots,
  resolveCheeseApplicatorSlots,
  resolveImportName,
  resolveMixApplicatorSlots,
  specImportNamedRecipeNamesEqual,
  type ImportMergeAliasMap,
} from "@workspace/spec-import";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const AUG19_SAVED_SPEC_PROFILE_REPAIR_V2_ID = "aug19-saved-spec-profile-repair-v2";
const AUG19_SAVED_SPEC_START = new Date("2026-08-19T00:00:00.000Z");
const AUG20_SAVED_SPEC_START = new Date("2026-08-20T00:00:00.000Z");
const AUG19_PROFILE_REPAIR_FROM_DATE = "2026-08-20";

type SavedParsedProfile = Record<string, unknown>;
type SavedParsedRecipe = { kind?: unknown; name?: unknown; rows?: unknown };
type SavedProfileSource = {
  profile: SavedParsedProfile;
  recipes: SavedParsedRecipe[];
  scope: string;
};
type RepairRecipePool = {
  name: string;
  components: unknown;
  doughballWeightOz?: unknown;
  doughballsPerTray?: unknown;
};

const ciName = (value: unknown): string => String(value ?? "").trim().toLowerCase();
const finiteNumber = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

function clonedRecipeRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({ ...row }));
}

function recordValueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function savedRecipeRows(
  recipes: SavedParsedRecipe[],
  kind: "dough" | "sauce",
  name: string,
): Array<Record<string, unknown>> {
  const match = recipes.find(
    (recipe) =>
      recipe.kind === kind &&
      typeof recipe.name === "string" &&
      specImportNamedRecipeNamesEqual(recipe.name, name),
  );
  return clonedRecipeRows(match?.rows);
}

function repairName(
  raw: unknown,
  kind: "dough" | "sauce",
  aliases: ImportMergeAliasMap,
  pool: RepairRecipePool[],
): { name: string; rows: Array<Record<string, unknown>> } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const resolved = resolveImportName(raw.trim(), kind, aliases).trim();
  if (!resolved) return null;
  const poolMatch = pool.find((item) => specImportNamedRecipeNamesEqual(item.name, resolved));
  return { name: poolMatch?.name ?? resolved, rows: poolMatch ? clonedRecipeRows(poolMatch.components) : [] };
}

export function applySavedSpecProfileFieldsV2(
  current: Record<string, unknown>,
  source: SavedProfileSource,
  pools: { dough: RepairRecipePool[]; sauce: RepairRecipePool[]; cheeseNames: string[]; mixNames: string[] },
  aliases: ImportMergeAliasMap,
): { values: Record<string, unknown>; changedFields: string[] } {
  const parsed = source.profile;
  const values = { ...current };
  const changed = new Set<string>();
  const set = (field: string, value: unknown) => {
    if (recordValueEquals(values[field], value)) return;
    values[field] = value;
    changed.add(field);
  };
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

  for (const field of ["dieType", "allergen"] as const) {
    const value = text(parsed[field]);
    if (value) set(field, value);
  }
  for (const [parsedField, storedField] of [
    ["sauceOzPerPizza", "sauceOzPerPizza"],
    ["pizzasPerCase", "pizzasPerCase"],
    ["sauceBarrelLbs", "sauceBarrelLbs"],
  ] as const) {
    const value = finiteNumber(parsed[parsedField]);
    if (value !== undefined && (parsedField === "sauceOzPerPizza" || value > 0)) set(storedField, value);
  }

  const sauce = repairName(parsed.sauceName, "sauce", aliases, pools.sauce);
  if (sauce) {
    set("frontlineRecipeName", sauce.name);
    const rows = sauce.rows.length ? sauce.rows : savedRecipeRows(source.recipes, "sauce", sauce.name);
    if (rows.length) set("frontlineRecipe", rows);
  }
  const dough = repairName(parsed.doughName, "dough", aliases, pools.dough);
  if (dough) {
    set("doughRecipeName", dough.name);
    const rows = dough.rows.length ? dough.rows : savedRecipeRows(source.recipes, "dough", dough.name);
    if (rows.length) set("doughRecipe", rows);
    const poolMatch = pools.dough.find((item) => specImportNamedRecipeNamesEqual(item.name, dough.name));
    const weight = finiteNumber(poolMatch?.doughballWeightOz);
    if (weight !== undefined && weight > 0) set("targetDoughballWeight", weight);
    const perTray = finiteNumber(poolMatch?.doughballsPerTray);
    if (perTray !== undefined && perTray > 0) set("doughballsPerTray", perTray);
  }

  const applicators = Array.isArray(parsed.applicators) ? parsed.applicators : [];
  if (applicators.length > 0) {
    const cheese = resolveCheeseApplicatorSlots(assignApplicatorSlots(
      applicators
        .filter((item): item is { type?: unknown; ozPerPizza?: unknown; batchLbs?: unknown; slot?: unknown } => !!item && typeof item === "object")
        .map((item) => ({
          type: text(item.type),
          ozPerPizza: finiteNumber(item.ozPerPizza) ?? 0,
          ...(finiteNumber(item.batchLbs) !== undefined ? { batchLbs: finiteNumber(item.batchLbs) } : {}),
          ...(finiteNumber(item.slot) !== undefined ? { slot: finiteNumber(item.slot) } : {}),
        })),
    ), pools.cheeseNames, text(parsed.brand));
    const mixed = resolveMixApplicatorSlots(cheese.applicators, pools.mixNames, text(parsed.brand));
    for (const [index, applicator] of mixed.applicators.entries()) {
      const slot = index + 1;
      if (!applicator.type.trim()) continue;
      set(`app${slot}Type`, applicator.type.trim());
      set(`app${slot}OzPerPizza`, applicator.ozPerPizza);
      if (applicator.batchLbs != null && applicator.batchLbs > 0) set(`app${slot}BatchLbs`, applicator.batchLbs);
    }
    for (const link of cheese.links) {
      const name = resolveImportName(link.recipeName, "cheese", aliases).trim();
      if (name) set(`app${link.slot}CheeseRecipeName`, name);
    }
    for (const link of mixed.links) {
      const name = resolveImportName(link.recipeName, "mixes", aliases).trim();
      if (name) set(`app${link.slot}CheeseRecipeName`, name);
    }
  }

  const namedPepperonis = (Array.isArray(parsed.pepperonis) ? parsed.pepperonis : [])
    .filter((item): item is { type?: unknown; sticks?: unknown; ozPerPizza?: unknown; batchLbs?: unknown } => !!item && typeof item === "object")
    .filter((item) => text(item.type))
    .slice(0, 2);
  for (const [index, pepperoni] of namedPepperonis.entries()) {
    const slot = index + 1;
    set(`pep${slot}Type`, text(pepperoni.type));
    const sticks = finiteNumber(pepperoni.sticks);
    if (sticks !== undefined) set(`pep${slot}Sticks`, sticks);
    const ounces = finiteNumber(pepperoni.ozPerPizza);
    if (ounces !== undefined) set(`pep${slot}OzPerPizza`, ounces);
    const batchLbs = finiteNumber(pepperoni.batchLbs);
    if (batchLbs !== undefined && batchLbs > 0) set(`pep${slot}BatchLbs`, batchLbs);
  }
  if (namedPepperonis.length > 0) set("pep1Combined", namedPepperonis.length < 2);
  return { values, changedFields: [...changed] };
}

export const aug19SavedSpecProfileRepairV2: RepairDefinition<RepairTransaction> = Object.freeze({
  id: AUG19_SAVED_SPEC_PROFILE_REPAIR_V2_ID,
  owner: "saved-spec-import",
  dependencies: Object.freeze(["aug19-saved-spec-profile-repair-v1"]),
  eligibility: "Profiles represented by the newest saved parse created on 2026-08-19, plus their unstarted scheduled runs from 2026-08-20.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Profiles matched by scope, case-insensitive brand, and flavor from audited 2026-08-19 saved spec sheets; unstarted daily-sync runs dated 2026-08-20 or later.",
    excludedScope: "Profiles absent from those saved sheets, started runs, historical daily-sync rows, and unspecified parsed fields.",
    rollback: "The runner marker preserves result counts; reverting profile values requires an explicit reviewed repair.",
    evidence: "The saved-spec rows, current master-data recipe pools, and merge aliases are read in the repair transaction.",
  }),
  async execute(tx) {
    const sheets = await tx.select().from(savedSpecSheetsTable).where(and(
      gte(savedSpecSheetsTable.createdAt, AUG19_SAVED_SPEC_START),
      sql`${savedSpecSheetsTable.createdAt} < ${AUG20_SAVED_SPEC_START}`,
    )).orderBy(sql`${savedSpecSheetsTable.createdAt} DESC, ${savedSpecSheetsTable.id} DESC`);
    const sources = new Map<string, SavedProfileSource>();
    for (const sheet of sheets) {
      const data = sheet.data as { profiles?: unknown; recipes?: unknown } | null;
      if (!Array.isArray(data?.profiles)) continue;
      const recipes = Array.isArray(data?.recipes)
        ? data.recipes.filter((recipe): recipe is SavedParsedRecipe => !!recipe && typeof recipe === "object") : [];
      for (const candidate of data.profiles) {
        if (!candidate || typeof candidate !== "object") continue;
        const profile = candidate as SavedParsedProfile;
        const brand = ciName(profile.brand);
        const flavor = ciName(profile.flavor);
        if (!brand || !flavor) continue;
        const key = `${sheet.scope}\u0000${brand}\u0000${flavor}`;
        if (!sources.has(key)) sources.set(key, { profile, recipes, scope: sheet.scope });
      }
    }
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    const doughRows = await tx.select().from(doughRecipesTable);
    const sauceRows = await tx.select().from(sauceRecipesTable);
    const cheeseRows = await tx.select().from(cheeseRecipesTable);
    const mixRows = await tx.select().from(mixesTable);
    const aliases = await tx.select().from(mergeAliasesTable);
    const aliasesByScope = new Map<string, ImportMergeAliasMap>();
    for (const scope of new Set([...sources.values()].map((source) => source.scope))) {
      aliasesByScope.set(scope, {
        dough: aliases.filter((alias) => alias.scope === scope && alias.category === "dough"),
        sauce: aliases.filter((alias) => alias.scope === scope && alias.category === "sauce"),
        cheese: aliases.filter((alias) => alias.scope === scope && alias.category === "cheese"),
        mixes: aliases.filter((alias) => alias.scope === scope && alias.category === "mixes"),
        ingredient: aliases.filter((alias) => alias.scope === scope && alias.category === "ingredient"),
      });
    }
    const poolsFor = (scope: string) => ({
      dough: doughRows.filter((row) => row.scope === scope).map((row) => ({ name: row.name, components: row.components, doughballWeightOz: row.doughballWeightOz, doughballsPerTray: row.doughballsPerTray })),
      sauce: sauceRows.filter((row) => row.scope === scope).map((row) => ({ name: row.name, components: row.components })),
      cheeseNames: cheeseRows.filter((row) => row.scope === scope).map((row) => row.name),
      mixNames: mixRows.filter((row) => row.scope === scope).map((row) => row.name),
    });
    const profilesBySource = new Map(profiles.map((profile) => [`${profile.scope}\u0000${ciName(profile.brand)}\u0000${ciName(profile.flavor)}`, profile]));
    const repaired = new Map<string, { values: Record<string, unknown>; fields: string[] }>();
    let repairedProfiles = 0;
    const now = Date.now();
    for (const [sourceKey, source] of sources) {
      const existing = profilesBySource.get(sourceKey);
      const repair = applySavedSpecProfileFieldsV2({ ...((existing?.values ?? {}) as Record<string, unknown>) }, source, poolsFor(source.scope), aliasesByScope.get(source.scope) ?? {});
      if (repair.changedFields.length === 0 && existing) continue;
      const brand = typeof source.profile.brand === "string" ? source.profile.brand.trim() : "";
      const flavor = typeof source.profile.flavor === "string" ? source.profile.flavor.trim() : "";
      const stamp = Math.max(existing?.updatedAtMs ?? 0, now) + 1;
      if (existing) {
        await tx.update(brandProfilesTable).set({ values: repair.values, updatedAtMs: stamp })
          .where(and(eq(brandProfilesTable.key, existing.key), eq(brandProfilesTable.scope, existing.scope)));
      } else {
        await tx.insert(brandProfilesTable).values({ key: `${brand.toLowerCase()}__${flavor.toLowerCase()}`, scope: source.scope, brand, flavor, values: repair.values, crustValues: {}, updatedAtMs: stamp });
      }
      repaired.set(sourceKey, { values: repair.values, fields: repair.changedFields });
      repairedProfiles++;
    }
    let repairedRuns = 0;
    const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, AUG19_PROFILE_REPAIR_FROM_DATE)).for("update");
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      const dayState = data?.dayState as Record<string, unknown> | undefined;
      const runs = Array.isArray(dayState?.runs) ? dayState.runs : [];
      const runValues = data?.runValues;
      if (!runValues || typeof runValues !== "object" || Array.isArray(runValues)) continue;
      const nextValues = { ...(runValues as Record<string, unknown>) };
      const priorStamps = data?.runValuesUpdatedAt && typeof data.runValuesUpdatedAt === "object" ? (data.runValuesUpdatedAt as Record<string, unknown>) : {};
      const nextStamps = { ...priorStamps };
      let changed = false;
      for (const run of runs) {
        if (!run || typeof run !== "object") continue;
        const meta = run as Record<string, unknown>;
        if (meta.startedAt != null || typeof meta.id !== "string") continue;
        const repair = repaired.get(`${day.scope}\u0000${ciName(meta.brand)}\u0000${ciName(meta.flavor)}`);
        const current = nextValues[meta.id];
        if (!repair || !current || typeof current !== "object" || Array.isArray(current)) continue;
        nextValues[meta.id] = { ...(current as Record<string, unknown>), ...Object.fromEntries(repair.fields.map((field) => [field, repair.values[field]])) };
        nextStamps[meta.id] = Math.max(finiteNumber(nextStamps[meta.id]) ?? 0, now) + 1;
        changed = true;
        repairedRuns++;
      }
      if (!changed) continue;
      await tx.update(dailySyncTable).set({ data: { ...data, runValues: nextValues, runValuesUpdatedAt: nextStamps }, updatedAt: new Date() })
        .where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope)));
    }
    return { sheetsScanned: sheets.length, parsedProfiles: sources.size, repairedProfiles, repairedRuns };
  },
  validateResult: (result) =>
    ["sheetsScanned", "parsedProfiles", "repairedProfiles", "repairedRuns"]
      .every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0),
});