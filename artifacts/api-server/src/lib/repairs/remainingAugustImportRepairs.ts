import { and, eq, gte, sql } from "drizzle-orm";
import {
  brandProfilesTable, cheeseRecipesTable, dailySyncTable, doughRecipesTable, mixesTable,
  sauceRecipesTable, savedSpecSheetsTable, specImportAliasesTable,
} from "@workspace/db";
import type { RepairDefinition, RepairResultObject, RepairTransaction } from "../repairRegistry";

const definition = (
  id: string, eligibility: string, execute: (tx: RepairTransaction) => Promise<RepairResultObject>,
): RepairDefinition<RepairTransaction> => Object.freeze({
  id, owner: "workbook-import", dependencies: Object.freeze([]), eligibility, mode: "automatic",
  executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Only rows selected by the released August 2026 repair predicate.",
    excludedScope: "All rows that do not satisfy the reviewed row-level predicate.",
    rollback: "Restore audited pre-repair values when a rollback is approved.",
    evidence: "Released dataHeals.ts definition and its associated saved workbook audit.",
  }),
  execute,
});
const ci = (value: unknown) => String(value ?? "").trim().toLowerCase();

export const HANNAFORD_TIKKA_MASALA_FIX_REPAIR_ID = "hannaford-tikka-masala-fix-v1";
export const hannafordTikkaMasalaFixRepair = definition(
  HANNAFORD_TIKKA_MASALA_FIX_REPAIR_ID, "Live Tikka Masala aliases and Hannaford's explicitly named profile.",
  async (tx): Promise<RepairResultObject> => {
    const canonical = "Maria & Son's Tikka Masala", typo = "Tika Masala Sauce", key = "hannaford__chicken tikka masala";
    const sauces = await tx.select().from(sauceRecipesTable).where(and(eq(sauceRecipesTable.scope, "live"), sql`lower(${sauceRecipesTable.name}) in (${canonical.toLowerCase()}, ${typo.toLowerCase()})`)).for("update");
    const canon = sauces.filter((row) => row.name.toLowerCase() === canonical.toLowerCase()), typos = sauces.filter((row) => row.name.toLowerCase() === typo.toLowerCase());
    let components: unknown[] | null = null, mergedSauces = 0, renamedSauce = 0;
    if (canon.length) {
      components = Array.isArray(canon[0].components) ? canon[0].components : [];
      const withComponents = typos.find((row) => Array.isArray(row.components) && row.components.length);
      if (!components.length && withComponents) {
        components = withComponents.components;
        await tx.update(sauceRecipesTable).set({ components: components as typeof canon[0]["components"], updatedAt: new Date() }).where(and(eq(sauceRecipesTable.id, canon[0].id), eq(sauceRecipesTable.scope, "live")));
      }
      for (const row of typos) { await tx.delete(sauceRecipesTable).where(and(eq(sauceRecipesTable.id, row.id), eq(sauceRecipesTable.scope, "live"))); mergedSauces++; }
    } else if (typos.length) {
      const row = typos[0]; components = Array.isArray(row.components) ? row.components : [];
      await tx.update(sauceRecipesTable).set({ name: canonical, updatedAt: new Date() }).where(and(eq(sauceRecipesTable.id, row.id), eq(sauceRecipesTable.scope, "live")));
      renamedSauce = 1;
      for (const extra of typos.slice(1)) { await tx.delete(sauceRecipesTable).where(and(eq(sauceRecipesTable.id, extra.id), eq(sauceRecipesTable.scope, "live"))); mergedSauces++; }
    }
    const alias = await tx.select({ id: specImportAliasesTable.id }).from(specImportAliasesTable).where(and(eq(specImportAliasesTable.scope, "live"), eq(specImportAliasesTable.kind, "recipeName"), eq(sql`lower(${specImportAliasesTable.externalName})`, typo.toLowerCase()), eq(specImportAliasesTable.context, "sauce")));
    if (!alias.length) await tx.insert(specImportAliasesTable).values({ scope: "live", kind: "recipeName", externalName: typo, canonicalName: canonical, context: "sauce" });
    const profiles = await tx.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, "live")).for("update");
    let repointedProfiles = 0, fixedProfile = 0;
    for (const profile of profiles) {
      if (profile.key === key) continue;
      const values = { ...((profile.values ?? {}) as Record<string, unknown>) };
      if (ci(values.frontlineRecipeName) !== ci(typo)) continue;
      values.frontlineRecipeName = canonical; if (components) values.frontlineRecipe = components;
      await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, "live"))); repointedProfiles++;
    }
    const target = profiles.find((profile) => profile.key === key);
    if (target) {
      const values = { ...((target.values ?? {}) as Record<string, unknown>) };
      values.frontlineRecipeName = canonical; values.frontlineRecipe = components ?? []; values.sauceOzPerPizza = 3.5; values.doughRecipeName = "Naan Dough"; values.dieType = '11"';
      const naan = await tx.select().from(doughRecipesTable).where(and(eq(doughRecipesTable.scope, "live"), eq(sql`lower(${doughRecipesTable.name})`, "naan dough")));
      if (naan.length && Array.isArray(naan[0].components)) values.doughRecipe = naan[0].components;
      for (const [slot, type, name, oz] of [[1, "Mix", "Masala Chicken Mix", 2.07], [2, "Mix", "White Fajita Mix", 1.5], [3, "Whole Mozzarella", "", 4], [4, "", "", 0]] as const) {
        const old = ci(values[`app${slot}CheeseRecipeName`]); values[`app${slot}Type`] = type; values[`app${slot}CheeseRecipeName`] = name; values[`app${slot}OzPerPizza`] = oz;
        if (old !== ci(name)) values[`app${slot}CheeseRecipe`] = [];
      }
      await tx.update(brandProfilesTable).set({ values, updatedAtMs: Math.max((target.updatedAtMs ?? 0) + 1, 1787063966214, Date.now()) }).where(and(eq(brandProfilesTable.key, key), eq(brandProfilesTable.scope, "live"))); fixedProfile = 1;
    }
    return { mergedSauces, renamedSauce, repointedProfiles, fixedProfile };
  },
);

export const WORKBOOK_IMPORT_STUB_PURGE_REPAIR_ID = "workbook-import-stub-purge-v1";
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const num = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const zeroComponents = (components: unknown) => !Array.isArray(components) || components.every((component) => {
  if (!component || typeof component !== "object") return true;
  const row = component as Record<string, unknown>;
  return num(row.lbs) <= 0 && num(row.ozPerPizza) <= 0 && num(row.perPizza) <= 0;
});
export const workbookImportStubPurgeRepair = definition(
  WORKBOOK_IMPORT_STUB_PURGE_REPAIR_ID, "Unreferenced zero-value rows whose IDs exactly match workbook-generated IDs.",
  async (tx): Promise<RepairResultObject> => {
    await tx.execute(sql`LOCK TABLE ${brandProfilesTable} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`LOCK TABLE ${dailySyncTable} IN SHARE ROW EXCLUSIVE MODE`);
    const profiles = await tx.select().from(brandProfilesTable), days = await tx.select().from(dailySyncTable), refs = new Set<string>();
    const add = (scope: string, values: unknown) => {
      if (!values || typeof values !== "object" || Array.isArray(values)) return;
      for (const field of ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"]) { const name = ci((values as Record<string, unknown>)[field]); if (name) refs.add(`${scope}\0${name}`); }
    };
    for (const profile of profiles) { add(profile.scope, profile.values); add(profile.scope, profile.crustValues); }
    for (const day of days) for (const values of Object.values(((day.data as Record<string, unknown> | null)?.runValues ?? {}) as Record<string, unknown>)) add(day.scope, values);
    let removedCheese = 0, removedMix = 0;
    for (const row of await tx.select().from(cheeseRecipesTable).for("update")) {
      const expected = slug(row.brand) ? `cheese:${slug(row.brand)}:${slug(row.name)}` : `cheese:${slug(row.name)}`;
      if (row.id !== expected || !zeroComponents(row.components) || refs.has(`${row.scope}\0${ci(row.name)}`)) continue;
      await tx.delete(cheeseRecipesTable).where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, row.scope))); removedCheese++;
    }
    for (const row of await tx.select().from(mixesTable).for("update")) {
      const expected = `premix-${slug(row.brand)}-${slug(row.flavor)}-${slug(row.name)}`;
      if (row.id !== expected || !zeroComponents(row.components) || Number(row.batchSize) > 0 || Number(row.amountAlreadyMade) > 0 || refs.has(`${row.scope}\0${ci(row.name)}`)) continue;
      await tx.delete(mixesTable).where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope))); removedMix++;
    }
    return { scannedProfiles: profiles.length, removedStubs: { cheese: removedCheese, mix: removedMix } };
  },
);

export const remainingAugustImportRepairs = Object.freeze([hannafordTikkaMasalaFixRepair, workbookImportStubPurgeRepair]);