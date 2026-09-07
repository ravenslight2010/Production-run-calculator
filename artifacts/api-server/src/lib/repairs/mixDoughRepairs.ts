import { and, eq, gte, sql } from "drizzle-orm";
import {
  aiCorrectionsTable,
  brandProfilesTable,
  dailySyncTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
  specImportAliasesTable,
} from "@workspace/db";
import {
  cleanSpecNamedRecipeName,
  isGenericSlotTypeName,
  specImportNamedRecipeNamesEqual,
  stripPurchasedCrustDie,
  type SpecImportAlias as SpecAliasEntry,
  sanitizeSpecAliases,
} from "@workspace/spec-import";
import {
  collapseDoughballVariantSuffixDuplicates,
  normalizeDoughballVariants,
} from "@workspace/named-recipes";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const CRB_DOUGH_FAMILY_CONSOLIDATION_REPAIR_ID = "crb-dough-family-consolidation-v1";
const CRB_FAMILY_CONSOLIDATION_FROM_DATE = "2026-08-22";

export function crbComponentsMatch(
  left: ReadonlyArray<{ ingredient?: string; lbs?: number }> | null | undefined,
  right: ReadonlyArray<{ ingredient?: string; lbs?: number }> | null | undefined,
): boolean {
  const normalize = (rows: ReadonlyArray<{ ingredient?: string; lbs?: number }> | null | undefined) =>
    (rows ?? []).map((row) => ({ ingredient: String(row.ingredient ?? "").trim().toLowerCase(), lbs: Number(row.lbs ?? 0) }))
      .filter((row) => row.ingredient && row.lbs > 0)
      .sort((a, b) => a.ingredient.localeCompare(b.ingredient) || a.lbs - b.lbs);
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
}

export const crbDoughFamilyConsolidationRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: CRB_DOUGH_FAMILY_CONSOLIDATION_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze(["crb-ingredient-conversion-v1"]),
  eligibility: "Only the proven live empty CRB Recipe duplicate with matching non-empty components is consolidated.", mode: "automatic",
  executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Live CRB Dough/CRB Recipe family rows and current/future references.", excludedScope: "Non-matching recipes and historical days.", rollback: "Marker retains counts; restoration requires reviewed source data.", evidence: "Matching components, populated canonical variants, and empty duplicate variants." }),
  async execute(tx) {
    const recipes = await tx.select().from(doughRecipesTable).where(and(eq(doughRecipesTable.scope, "live"), sql`lower(${doughRecipesTable.name}) in ('crb dough', 'crb recipe')`)).for("update");
    const canonical = recipes.find((row) => row.name.trim().toLowerCase() === "crb dough");
    const duplicate = recipes.find((row) => row.name.trim().toLowerCase() === "crb recipe");
    const provenDuplicate = canonical && duplicate && Array.isArray(canonical.doughballVariants) && canonical.doughballVariants.length > 0 && (!Array.isArray(duplicate.doughballVariants) || duplicate.doughballVariants.length === 0) && crbComponentsMatch(canonical.components, duplicate.components);
    let repointedProfiles = 0, repointedDays = 0, deleted = 0;
    if (provenDuplicate) {
      const profiles = await tx.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, "live")).for("update");
      for (const profile of profiles) {
        const values = { ...(profile.values ?? {}) } as Record<string, unknown>;
        if (String(values.doughRecipeName ?? "").trim().toLowerCase() !== "crb recipe") continue;
        values.doughRecipeName = canonical.name;
        await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, profile.scope)));
        repointedProfiles++;
      }
      const days = await tx.select().from(dailySyncTable).where(and(eq(dailySyncTable.scope, "live"), gte(dailySyncTable.date, CRB_FAMILY_CONSOLIDATION_FROM_DATE))).for("update");
      for (const day of days) {
        const data = { ...((day.data ?? {}) as Record<string, unknown>) };
        const runValues = data.runValues as Record<string, Record<string, unknown>> | undefined;
        if (!runValues || typeof runValues !== "object") continue;
        const stamps = data.runValuesUpdatedAt && typeof data.runValuesUpdatedAt === "object" ? { ...(data.runValuesUpdatedAt as Record<string, unknown>) } : {};
        let changed = false;
        for (const [runId, values] of Object.entries(runValues)) {
          if (!values || typeof values !== "object" || String(values.doughRecipeName ?? "").trim().toLowerCase() !== "crb recipe") continue;
          values.doughRecipeName = canonical.name;
          const stamp = Math.max(Number(stamps[runId] ?? values.valuesUpdatedAtMs ?? 0) + 1, Date.now());
          values.valuesUpdatedAtMs = stamp; stamps[runId] = stamp; changed = true;
        }
        if (!changed) continue;
        data.runValuesUpdatedAt = stamps;
        await tx.update(dailySyncTable).set({ data, updatedAt: new Date() }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope)));
        repointedDays++;
      }
      await tx.insert(specImportAliasesTable).values({ scope: "live", kind: "recipeName", externalName: duplicate.name, canonicalName: canonical.name, context: "dough" });
      await tx.delete(doughRecipesTable).where(and(eq(doughRecipesTable.id, duplicate.id), eq(doughRecipesTable.scope, duplicate.scope)));
      deleted = 1;
    }
    return { scanned: recipes.length, provenDuplicate: Boolean(provenDuplicate), repointedProfiles, repointedDays, deleted };
  },
});

export const GENERIC_MIX_POISON_PURGE_REPAIR_ID = "generic-mix-poison-purge-v2";
export const genericMixPoisonPurgeRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: GENERIC_MIX_POISON_PURGE_REPAIR_ID, owner: "import-hygiene", dependencies: Object.freeze(["cheese-recipe-name-dedupe-v1"]),
  eligibility: "Only aliases rejected by sanitization, generic item corrections, and generic or empty junk mix rows are removed.", mode: "automatic",
  executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Sanitizer-rejected aliases, generic corrections, and garbage mix records.", excludedScope: "Non-generic corrections and populated named mixes.", rollback: "Deleted rows require reviewed source re-import.", evidence: "Shared alias sanitizer and generic slot-type predicate." }),
  async execute(tx) {
    const rows = await tx.select().from(specImportAliasesTable).for("update");
    const byScope = new Map<string, typeof rows>();
    for (const row of rows) { const list = byScope.get(row.scope); if (list) list.push(row); else byScope.set(row.scope, [row]); }
    const dropIds: number[] = [];
    for (const scopeRows of byScope.values()) {
      const entries: SpecAliasEntry[] = scopeRows.map((r) => ({ kind: r.kind as SpecAliasEntry["kind"], externalName: r.externalName, canonicalName: r.canonicalName, context: r.context }));
      const kept = new Set(sanitizeSpecAliases(entries));
      for (let i = 0; i < scopeRows.length; i++) if (!kept.has(entries[i])) dropIds.push(scopeRows[i].id);
    }
    let deletedAliases = 0;
    for (const id of dropIds) deletedAliases += (await tx.delete(specImportAliasesTable).where(eq(specImportAliasesTable.id, id)).returning({ id: specImportAliasesTable.id })).length;
    const corrections = await tx.select({ id: aiCorrectionsTable.id, fromText: aiCorrectionsTable.fromText, toText: aiCorrectionsTable.toText }).from(aiCorrectionsTable).where(eq(aiCorrectionsTable.domain, "item"));
    let deletedCorrections = 0;
    for (const c of corrections) {
      if (!isGenericSlotTypeName(c.fromText) && !isGenericSlotTypeName(c.toText)) continue;
      deletedCorrections += (await tx.delete(aiCorrectionsTable).where(eq(aiCorrectionsTable.id, c.id)).returning({ id: aiCorrectionsTable.id })).length;
    }
    const mixes = await tx.select().from(mixesTable).for("update");
    let deletedMixes = 0;
    for (const m of mixes) {
      if (!isGenericSlotTypeName(m.name) && !((m.brand ?? "").trim() === "" && (m.components ?? []).length === 0)) continue;
      deletedMixes += (await tx.delete(mixesTable).where(and(eq(mixesTable.id, m.id), eq(mixesTable.scope, m.scope))).returning({ id: mixesTable.id })).length;
    }
    return { deletedAliases, deletedCorrections, deletedMixes };
  },
});

export const NAMED_RECIPE_NAME_CLEANUP_REPAIR_ID = "named-recipe-name-cleanup-v1";
const NAME_CLEANUP_FROM_DATE = "2026-07-15";
export const namedRecipeNameCleanupRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: NAMED_RECIPE_NAME_CLEANUP_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze(["cheese-oz-depoison-v1"]),
  eligibility: "Only clean-spec renames without a same-scope collision are applied.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Cleanable dough and sauce names plus current/future references.", excludedScope: "Collision rows and historical days.", rollback: "Aliases retain old-to-new evidence; reversal requires review.", evidence: "Shared cleanSpecNamedRecipeName derivation." }),
  async execute(tx) {
    const renames = new Map<string, { dough: Map<string, string>; sauce: Map<string, string> }>();
    const scopeRenames = (scope: string) => { let r = renames.get(scope); if (!r) { r = { dough: new Map(), sauce: new Map() }; renames.set(scope, r); } return r; };
    let renamedRows = 0;
    for (const kind of ["dough", "sauce"] as const) {
      const table = kind === "dough" ? doughRecipesTable : sauceRecipesTable;
      const rows = await tx.select().from(table).for("update");
      const namesByScope = new Map<string, Set<string>>();
      for (const row of rows) { let set = namesByScope.get(row.scope); if (!set) { set = new Set(); namesByScope.set(row.scope, set); } set.add(row.name.trim().toLowerCase()); }
      for (const row of rows) {
        const oldName = row.name.trim(), newName = cleanSpecNamedRecipeName(kind, oldName);
        if (!newName || newName === oldName) continue;
        const set = namesByScope.get(row.scope)!;
        if (newName.toLowerCase() !== oldName.toLowerCase() && set.has(newName.toLowerCase())) continue;
        await tx.update(table).set({ name: newName, updatedAt: new Date() }).where(and(eq(table.id, row.id), eq(table.scope, row.scope)));
        set.delete(oldName.toLowerCase()); set.add(newName.toLowerCase()); scopeRenames(row.scope)[kind].set(oldName.toLowerCase(), newName); renamedRows++;
        await tx.insert(specImportAliasesTable).values({ scope: row.scope, kind: "recipeName", externalName: oldName, canonicalName: newName, context: kind });
      }
    }
    let repointedProfiles = 0;
    if (renamedRows > 0) {
      const profiles = await tx.select().from(brandProfilesTable).for("update");
      for (const p of profiles) {
        const r = renames.get(p.scope); if (!r) continue;
        const values = { ...(p.values ?? {}) } as Record<string, unknown>; let changed = false;
        const dough = String(values.doughRecipeName ?? "").trim(), dTo = dough ? r.dough.get(dough.toLowerCase()) : undefined;
        if (dTo && dTo !== dough) { values.doughRecipeName = dTo; changed = true; }
        const sauce = String(values.frontlineRecipeName ?? "").trim(), sTo = sauce ? r.sauce.get(sauce.toLowerCase()) : undefined;
        if (sTo && sTo !== sauce) { values.frontlineRecipeName = sTo; changed = true; }
        if (!changed) continue;
        await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); repointedProfiles++;
      }
    }
    let repointedDays = 0;
    if (renamedRows > 0) {
      const days = await tx.select().from(dailySyncTable).where(gte(dailySyncTable.date, NAME_CLEANUP_FROM_DATE)).for("update");
      for (const day of days) {
        const r = renames.get(day.scope); if (!r) continue;
        const data = day.data as Record<string, unknown> | null, runValues = data?.runValues as Record<string, Record<string, unknown>> | undefined;
        if (!runValues || typeof runValues !== "object") continue;
        let changed = false;
        for (const vals of Object.values(runValues)) {
          if (!vals || typeof vals !== "object") continue;
          const dough = String(vals.doughRecipeName ?? "").trim(), dTo = dough ? r.dough.get(dough.toLowerCase()) : undefined;
          if (dTo && dTo !== dough) { vals.doughRecipeName = dTo; changed = true; }
          const sauce = String(vals.frontlineRecipeName ?? "").trim(), sTo = sauce ? r.sauce.get(sauce.toLowerCase()) : undefined;
          if (sTo && sTo !== sauce) { vals.frontlineRecipeName = sTo; changed = true; }
        }
        if (!changed) continue;
        await tx.update(dailySyncTable).set({ data: { ...data }, updatedAt: new Date() }).where(and(eq(dailySyncTable.date, day.date), eq(dailySyncTable.scope, day.scope))); repointedDays++;
      }
    }
    return { renamedRows, repointedProfiles, repointedDays };
  },
});

export const DOUGH_BATCH_YIELD_DEPOISON_REPAIR_ID = "dough-batch-yield-depoison-v1";
export function doughRowsHaveLbs(rows: unknown): boolean {
  return Array.isArray(rows) && rows.some((r) => r && typeof r === "object" && Number((r as Record<string, unknown>).lbs ?? 0) > 0);
}
export const doughBatchYieldDepoisonRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: DOUGH_BATCH_YIELD_DEPOISON_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze([NAMED_RECIPE_NAME_CLEANUP_REPAIR_ID]), eligibility: "Only positive fallback yields with a real dough weight and pounds rows are cleared.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Profiles matching the derived-yield predicate.", excludedScope: "Profiles without both authoritative dough rows and doughball weight.", rollback: "Cleared fallback requires source review to restore.", evidence: "Shared run-form derived-yield rule." }),
  async execute(tx) {
    const profiles = await tx.select().from(brandProfilesTable).for("update"); let updated = 0;
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      if (!(Number(values.doughBatchYield ?? 0) > 0) || !(Number(values.targetDoughballWeight ?? 0) > 0) || !doughRowsHaveLbs(values.doughRecipe)) continue;
      values.doughBatchYield = 0;
      await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); updated++;
    }
    return { scanned: profiles.length, updated };
  },
});

export const DOUGH_FAMILY_WEIGHT_DEPOISON_REPAIR_ID = "dough-family-weight-depoison-v1";
export const doughFamilyWeightDepoisonRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: DOUGH_FAMILY_WEIGHT_DEPOISON_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze([DOUGH_BATCH_YIELD_DEPOISON_REPAIR_ID]), eligibility: "Only family-recipe values equal to an unrepresented recipe-level weight or tray count are cleared.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Profiles linked to multi-variant dough families matching the poison signature.", excludedScope: "Single-variant recipes and values represented by a variant.", rollback: "Cleared values require reviewed source restoration.", evidence: "Variant-aware family recipe comparison." }),
  async execute(tx) {
    const doughs = await tx.select().from(doughRecipesTable);
    const families = doughs.map((d) => ({ scope: d.scope, name: d.name, weightOz: Number(d.doughballWeightOz ?? 0), perTray: Number(d.doughballsPerTray ?? 0), variants: normalizeDoughballVariants(d.doughballVariants) })).filter((d) => d.variants.length > 1);
    if (families.length === 0) return { updated: 0, skipped: "no family dough recipes" };
    const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
    const profiles = await tx.select().from(brandProfilesTable).for("update"); let updated = 0;
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>, dName = String(values.doughRecipeName ?? "").trim();
      const fam = dName ? families.find((d) => d.scope === p.scope && specImportNamedRecipeNamesEqual(d.name, dName)) : undefined;
      if (!fam) continue;
      let changed = false; const wt = Number(values.targetDoughballWeight ?? 0);
      if (wt > 0 && near(wt, fam.weightOz) && !fam.variants.some((v) => near(Number(v.weightOz ?? 0), wt))) { values.targetDoughballWeight = 0; changed = true; }
      const pt = Number(values.doughballsPerTray ?? 0);
      if (pt > 0 && pt === fam.perTray && !fam.variants.some((v) => Number(v.perTray ?? 0) === pt)) { values.doughballsPerTray = 0; changed = true; }
      if (!changed) continue;
      await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); updated++;
    }
    return { scanned: profiles.length, updated };
  },
});

type MixDupRow = { id: string; scope: string; name: string; brand: string; flavor: string; batchSize: number; components: { ingredient: string; perPizza?: number }[] | null; createdAt: Date };
export function pickMixDuplicateLosers<R extends MixDupRow>(rows: R[]): R[] {
  const groups = new Map<string, R[]>();
  for (const row of rows) { const key = [row.scope, row.name.trim().toLowerCase(), row.brand.trim().toLowerCase(), row.flavor.trim().toLowerCase()].join("\u0000"); const list = groups.get(key); if (list) list.push(row); else groups.set(key, [row]); }
  const rank = (r: R): [number, number, number] => { const components = r.components ?? []; return [components.some((c) => (c.perPizza ?? 0) > 0 || ((c as { perBatchLbs?: number }).perBatchLbs ?? 0) > 0) ? 1 : 0, r.batchSize > 0 ? 1 : 0, components.length]; };
  const losers: R[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]; const diff = a.createdAt.getTime() - b.createdAt.getTime(); return diff !== 0 ? diff : a.id.localeCompare(b.id); });
    losers.push(...sorted.slice(1));
  }
  return losers;
}
export const MIX_DUPLICATE_NAME_PURGE_REPAIR_ID = "mix-duplicate-name-purge-v1";
export const mixDuplicateNamePurgeRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: MIX_DUPLICATE_NAME_PURGE_REPAIR_ID, owner: "import-hygiene", dependencies: Object.freeze(["sea-salt-alias-undo-v1"]), eligibility: "Only lowercased same scope/name/brand/flavor duplicate mix groups lose non-keepers.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Exact duplicate mix identity groups.", excludedScope: "Unique mix rows and highest-ranked group keepers.", rollback: "Deleted duplicates require reviewed source re-import.", evidence: "Stable real-data, batch-size, component-count, age, and ID ranking." }),
  async execute(tx) { const rows = await tx.select().from(mixesTable).for("update"); const dropRows = pickMixDuplicateLosers(rows); let deletedRows = 0; for (const loser of dropRows) deletedRows += (await tx.delete(mixesTable).where(and(eq(mixesTable.id, loser.id), eq(mixesTable.scope, loser.scope))).returning({ id: mixesTable.id })).length; return { scanned: rows.length, deletedRows }; },
});

export const PURCHASED_CRUST_DIE_HEAL_REPAIR_ID = "purchased-crust-die-heal-v1";
export const purchasedCrustDieHealRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: PURCHASED_CRUST_DIE_HEAL_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze([MIX_DUPLICATE_NAME_PURGE_REPAIR_ID]), eligibility: "Only shared purchased-crust die cleanup changes profile values.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Profiles with a purchased-crust die or dough name.", excludedScope: "In-house dough names and dies.", rollback: "Cleared die values require reviewed source restoration.", evidence: "Shared stripPurchasedCrustDie rule." }),
  async execute(tx) { const profiles = await tx.select().from(brandProfilesTable).for("update"); let updated = 0; for (const p of profiles) { const values = { ...(p.values ?? {}) } as Record<string, unknown>; const before = { dieType: String(values.dieType ?? "").trim() || undefined, doughName: String(values.doughRecipeName ?? "").trim() || undefined }; const after = stripPurchasedCrustDie(before); if (after === before) continue; if (after.dieType !== before.dieType) values.dieType = ""; if (after.doughName !== before.doughName) values.doughRecipeName = after.doughName ?? ""; await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((p.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope))); updated++; } return { scanned: profiles.length, updated }; },
});

export const DOUGH_VARIANT_SUFFIX_DEDUPE_REPAIR_ID = "dough-variant-suffix-dedupe-v1";
export const doughVariantSuffixDedupeRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: DOUGH_VARIANT_SUFFIX_DEDUPE_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze([PURCHASED_CRUST_DIE_HEAL_REPAIR_ID]), eligibility: "Only suffix-equivalent, non-contradictory doughball variants are collapsed.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "Dough recipe suffix-equivalent variants.", excludedScope: "Contradictory variant values.", rollback: "Marker preserves counts; restoration requires reviewed variants.", evidence: "Shared suffix duplicate collapse helper." }),
  async execute(tx) { const rows = await tx.select().from(doughRecipesTable).for("update"); let updatedRows = 0, removedVariants = 0; for (const row of rows) { const before = normalizeDoughballVariants(row.doughballVariants), collapsed = collapseDoughballVariantSuffixDuplicates(before, row.name); if (!collapsed) continue; await tx.update(doughRecipesTable).set({ doughballVariants: collapsed, updatedAt: new Date() }).where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, row.scope))); updatedRows++; removedVariants += before.length - collapsed.length; } return { scanned: rows.length, updatedRows, removedVariants }; },
});

export const CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID = "crb-dough-lucia-variant-customers-v2";
export const CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_CONTRACT = Object.freeze({
  recipeName: "CRB Dough",
  customerBrand: "Lucia's Craft",
  weightToleranceOz: 0.15,
  variants: Object.freeze([
    Object.freeze({
      weightOz: 7.8,
      labelPatterns: Object.freeze([
        Object.freeze({ source: "basha", flags: "i" }),
        Object.freeze({ source: "ultra[\\s_-]*thin", flags: "i" }),
      ]),
      labelMatch: "any" as const,
      flavors: Object.freeze(["Backyard BBQ Chicken", "Sweet Chili Garden"]),
    }),
    Object.freeze({
      weightOz: 12,
      labelPatterns: Object.freeze([
        Object.freeze({ source: "lucia", flags: "i" }),
        Object.freeze({ source: "heavy", flags: "i" }),
      ]),
      labelMatch: "all" as const,
      flavors: Object.freeze(["Four Cheese Meltdown"]),
    }),
    Object.freeze({
      weightOz: 13.8,
      labelPatterns: Object.freeze([
        Object.freeze({ source: "lucia", flags: "i" }),
        Object.freeze({ source: "thick", flags: "i" }),
      ]),
      labelMatch: "all" as const,
      flavors: Object.freeze([]),
    }),
  ]),
});

type CrbLuciaVariant = ReturnType<typeof normalizeDoughballVariants>[number];

export function healCrbLuciaVariantCustomers(
  variants: CrbLuciaVariant[],
): { variants: CrbLuciaVariant[]; changed: boolean } {
  const contract = CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_CONTRACT;
  const brandKey = contract.customerBrand.toLowerCase();
  let changed = false;
  const healed = variants.map((variant) => {
    const source = contract.variants.find((candidate) => {
      if (Math.abs(Number(variant.weightOz ?? 0) - candidate.weightOz) >= contract.weightToleranceOz) {
        return false;
      }
      const matches = candidate.labelPatterns.map((pattern) =>
        new RegExp(pattern.source, pattern.flags).test(variant.label));
      return candidate.labelMatch === "all" ? matches.every(Boolean) : matches.some(Boolean);
    });
    if (!source) return variant;
    const existing = variant.customers ?? [];
    const withoutBrand = existing.filter(
      (customer) => customer.brand.trim().toLowerCase() !== brandKey,
    );
    const additions = source.flavors.map((flavor) => ({
      brand: contract.customerBrand,
      flavor,
    }));
    const currentBrandCustomers = existing.filter(
      (customer) => customer.brand.trim().toLowerCase() === brandKey,
    );
    const alreadyCorrect =
      currentBrandCustomers.length === additions.length &&
      additions.every((addition) =>
        currentBrandCustomers.some(
          (customer) => customer.flavor.trim().toLowerCase() === addition.flavor.toLowerCase(),
        ));
    if (alreadyCorrect) return variant;
    changed = true;
    return { ...variant, customers: [...withoutBrand, ...additions] };
  });
  return { variants: healed, changed };
}

export const crbDoughLuciaVariantCustomersV2Repair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID, owner: "recipe-normalization", dependencies: Object.freeze(["brand-drift-rename-v1"]), eligibility: "Only CRB Dough variants matching the audited Lucia label and weight predicates change.", mode: "automatic", executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({ affectedScope: "CRB Dough Lucia ultra-thin, heavy-plus, and thick variants.", excludedScope: "All non-CRB dough and unmatched variants.", rollback: "Variant customer changes require reviewed source restoration.", evidence: "CRB Mixing Procedure Rev. 39 and Lucia's Craft Spec Sheet Rev. 03." }),
  async execute(tx) {
    const contract = CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_CONTRACT;
    const doughs = await tx.select().from(doughRecipesTable).for("update"), crbRows = doughs.filter((d) => specImportNamedRecipeNamesEqual(d.name, contract.recipeName));
    if (crbRows.length === 0) return { updated: 0, skipped: "no CRB Dough found" };
    let updated = 0;
    for (const row of crbRows) {
      const { variants: next, changed } =
        healCrbLuciaVariantCustomers(normalizeDoughballVariants(row.doughballVariants));
      if (!changed) continue;
      await tx.update(doughRecipesTable).set({ doughballVariants: next }).where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, row.scope))); updated++;
    }
    return { updated };
  },
});