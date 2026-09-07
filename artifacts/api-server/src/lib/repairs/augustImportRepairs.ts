import { and, eq, gte, sql } from "drizzle-orm";
import {
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
  specImportAliasesTable,
} from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

const automatic = (id: string, eligibility: string, execute: RepairDefinition<RepairTransaction>["execute"]): RepairDefinition<RepairTransaction> =>
  Object.freeze({
    id, owner: "workbook-import", dependencies: Object.freeze([]), eligibility, mode: "automatic",
    executionMode: "runner-transactional", resultOwnership: "runner-marker", managerAllowed: false,
    safety: Object.freeze({
      affectedScope: "The explicitly named live workbook-import rows only.",
      excludedScope: "All rows outside the released repair predicate.",
      rollback: "Restore the reviewed pre-repair values from the import audit if required.",
      evidence: "Released dataHeals.ts repair definition and audited August 2026 workbook import.",
    }),
    execute,
  });

export const AUG2026_IMPORT_FIX_CHEESE_RECIPES_REPAIR_ID = "aug2026-import-fix-cheese-recipes-v1";
export const aug2026ImportFixCheeseRecipesRepair = automatic(
  AUG2026_IMPORT_FIX_CHEESE_RECIPES_REPAIR_ID,
  "Live named cheese recipes carrying the audited August component-format defects.",
  async (tx) => {
    const rows = await tx.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, "live")).for("update");
    let updated = 0;
    for (const row of rows) {
      const components = (row.components ?? []) as Array<Record<string, unknown>>;
      let fixed: Array<Record<string, unknown>> | undefined;
      if (row.name === "Edwardo's Parmesan Oregano Mix") {
        fixed = components.filter((component) => component.ingredient !== "NO Cellulose");
        if (fixed.length === components.length) fixed = undefined;
      } else if (row.name === "Bobo's Deluxe Meat Mix" && components.some((component) => "ozPerPizza" in component)) {
        fixed = components.map((component) => ({ ingredient: component.ingredient, lbs: 121.6125 }));
      } else if ((row.name === "Lucia's Craft Pepperoni Cheese Mix" || row.name === "Lucia's Craft Pepperoni/Jalapeno Cheese Mix") && components.some((component) => "ozPerPizza" in component)) {
        fixed = components.map((component) => ({ ingredient: component.ingredient, lbs: Math.round((Number(component.ozPerPizza) * 745.2 / 16) * 10000) / 10000 }));
      }
      if (!fixed) continue;
      await tx.update(cheeseRecipesTable).set({ components: fixed as any, updatedAt: new Date() })
        .where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, row.scope)));
      updated++;
    }
    return { scanned: rows.length, updated };
  },
);

export const AUG2026_CHEESE_RECIPE_LBS_REPAIR_ID = "aug2026-cheese-recipe-lbs-v1";
const cheeseBatches = [
  ["Lowe's 7 Pepperoni/Romano Cheese Mix", 749.71428571], ["Aldo's Cheese Mix", 307],
  ["Bobo Alfredo Cheese Mix", 828], ["Bobo Breakfast Cheese", 828], ["Basha's Original Cheese Mix", 162],
  ["Basha's Pepperoni Cheese Mix", 162], ["Basha's Pepperoni/Romano Cheese Mix", 162],
  ["Brand Cheese Mix", 387], ["Deluxe Meat Mix", 828],
] as const;
export const aug2026CheeseRecipeLbsRepair = automatic(
  AUG2026_CHEESE_RECIPE_LBS_REPAIR_ID,
  "Live named cheese recipes with all lbs zero and positive imported ozPerPizza.",
  async (tx) => {
    let scanned = 0, updated = 0;
    for (const [name, batchPizzas] of cheeseBatches) {
      const rows = await tx.select().from(cheeseRecipesTable).where(and(eq(cheeseRecipesTable.scope, "live"), eq(cheeseRecipesTable.name, name)));
      for (const row of rows) {
        scanned++;
        const components = row.components as Array<{ ingredient: string; lbs: number; ozPerPizza?: number }>;
        if (!components.every((component) => !component.lbs || component.lbs === 0) || !components.some((component) => typeof component.ozPerPizza === "number" && component.ozPerPizza > 0)) continue;
        const healed = components.map(({ ozPerPizza, ...component }) => ({ ...component, lbs: ozPerPizza != null ? Math.round((ozPerPizza * batchPizzas / 16) * 10000) / 10000 : 0 }));
        await tx.update(cheeseRecipesTable).set({ components: healed }).where(and(eq(cheeseRecipesTable.scope, "live"), eq(cheeseRecipesTable.name, name)));
        updated++;
      }
    }
    return { scanned, updated };
  },
);

export const AUG2026_LOWES_MIX_STRAY_COMPONENT_REPAIR_ID = "aug2026-lowes-mix-stray-component-v1";
export const aug2026LowesMixStrayComponentRepair = automatic(
  AUG2026_LOWES_MIX_STRAY_COMPONENT_REPAIR_ID,
  "Live Lowe's Red Hot Bacon Jalapeno Mix rows with a zero-perPizza component.",
  async (tx) => {
    const target = "Lowe's Red Hot Bacon Jalapeno Mix";
    const rows = await tx.select().from(mixesTable).where(and(eq(mixesTable.scope, "live"), eq(mixesTable.name, target)));
    let updated = 0;
    for (const row of rows) {
      const components = row.components as Array<{ ingredient: string; perPizza: number; perBatchLbs?: number }>;
      const cleaned = components.filter((component) => component.perPizza > 0);
      if (cleaned.length === components.length) continue;
      await tx.update(mixesTable).set({ components: cleaned }).where(and(eq(mixesTable.scope, "live"), eq(mixesTable.name, target)));
      updated++;
    }
    return { updated };
  },
);

export const AUG2026_IMPORT_FIX_SAUCE_RECIPES_REPAIR_ID = "aug2026-import-fix-sauce-recipes-v1";
const missingSauces = [
  ["bbq-sauce-legacy", "BBQ Sauce (Legacy)"], ["ranch-sauce-legacy", "Ranch Sauce (Legacy)"],
  ["cheeseburger-sauce-legacy", "Cheeseburger Sauce (Legacy)"], ["sweet-n-sour-sauce-legacy", "Sweet n Sour Sauce (Legacy)"],
  ["al-pastor-sauce-legacy", "Al Pastor Sauce (Legacy)"], ["buffalo-ranch-sauce-legacy", "Buffalo Ranch Sauce (Legacy)"],
  ["legacy-buffalo-ranch", "Legacy Buffalo Ranch"], ["sauce-legacy-cheeseburger-recipe", "Sauce (Legacy Cheeseburger Recipe)"],
] as const;
export const aug2026ImportFixSauceRecipesRepair = automatic(
  AUG2026_IMPORT_FIX_SAUCE_RECIPES_REPAIR_ID, "Missing audited live Legacy sauce stubs.",
  async (tx) => {
    let added = 0;
    for (const [id, name] of missingSauces) {
      const existing = await tx.select({ id: sauceRecipesTable.id }).from(sauceRecipesTable).where(and(eq(sauceRecipesTable.scope, "live"), eq(sql`lower(${sauceRecipesTable.name})`, name.toLowerCase())));
      if (existing.length) continue;
      await tx.insert(sauceRecipesTable).values({ id, scope: "live", name, notes: "", components: [], enabled: true, brand: "", flavors: [] }).onConflictDoNothing();
      added++;
    }
    return { attempted: missingSauces.length, added };
  },
);

export const AUG2026_IMPORT_FIX_PROFILES_REPAIR_ID = "aug2026-import-fix-profiles-v1";
export const aug2026ImportFixProfilesRepair = automatic(
  AUG2026_IMPORT_FIX_PROFILES_REPAIR_ID, "Live lowercase Nob Hill Craft profiles.",
  async (tx) => {
    const profiles = await tx.select().from(brandProfilesTable).where(and(eq(brandProfilesTable.scope, "live"), sql`LOWER(${brandProfilesTable.brand}) = 'nob hill craft'`)).for("update");
    let updated = 0;
    for (const profile of profiles) {
      const values = { ...(profile.values as Record<string, unknown>) }; let changed = profile.brand !== "Nob Hill Craft";
      if (profile.flavor === "south of the border" && values.app2CheeseRecipeName === "South of the Border Mix") { values.app2CheeseRecipeName = "Nob Hill Craft South of the Border Mix"; changed = true; }
      if (profile.flavor === "club" && values.app1CheeseRecipeName === "Nob Hill Craft Club Mix") { values.app1CheeseRecipeName = null; changed = true; }
      if (!changed) continue;
      await tx.update(brandProfilesTable).set({ brand: "Nob Hill Craft", values, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()) }).where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, profile.scope)));
      updated++;
    }
    return { scanned: profiles.length, updated };
  },
);

export const AUG2026_IMPORT_FIX_MIXES_REPAIR_ID = "aug2026-import-fix-mixes-v1";
const mixFixes: Record<string, { batchSize?: number; flavor?: string; brand?: string }> = {
  "Nob Hill Craft Red Hot Bacon Jalapeno Mix": { batchSize: 34.9312, flavor: "RED HOT BACON JALAPENO" },
  "Nob Hill Craft Caribbean Pinapples": { batchSize: 31.05, brand: "Nob Hill Craft" },
  "Nob Hill Craft Club Mix": { brand: "Nob Hill Craft" },
  "Corner Booth Spinach Mix": { batchSize: 72.45 }, "Corner Booth Hot Giardiniera Mix": { batchSize: 144.9 },
  "Basha's Ultra Thin Hawaiian": { batchSize: 82.8 }, "Lucia's Craft Red Hot Bacon Jalapeno Mix": { batchSize: 34.9312 },
  "Lucia's Craft Caribbean Pinapples": { batchSize: 31.05 }, "Lucia's Craft Alfredo Spinach": { batchSize: 49.6125 },
  "Lowe's Red Hot Bacon Jalapeno Mix": { batchSize: 31.05, flavor: "RED HOT BACON JALAPENO" },
};
export const aug2026ImportFixMixesRepair = automatic(
  AUG2026_IMPORT_FIX_MIXES_REPAIR_ID, "Live named mixes carrying the audited August import defects.",
  async (tx) => {
    const rows = await tx.select().from(mixesTable).where(eq(mixesTable.scope, "live")).for("update");
    let updated = 0;
    for (const row of rows) {
      const fix = mixFixes[row.name];
      if (fix) {
        await tx.update(mixesTable).set({ ...fix, updatedAt: new Date() } as any).where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope)));
        updated++; continue;
      }
      const components = (row.components ?? []) as Array<Record<string, unknown>>;
      if (row.name === "Bobo's Deluxe Meat Mix" && components.some((component) => Number(component.perPizza) === 0)) {
        await tx.update(mixesTable).set({ components: components.map((component) => ({ ...component, perPizza: 2.35, perBatchLbs: 121.6125 })) as any, batchSize: 121.6125, updatedAt: new Date() } as any).where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope)));
        updated++; continue;
      }
      const specification = row.name === "Lucia's Craft House Dlux Mix"
        ? [["FR Red Onion Strips", 1.325], ["Black Olives", .5]]
        : row.name === "Lucia's Craft Sweet Chili Veggie Mix"
          ? [["FR Red Onion Strips", .5], ["Blanched Red Pepper Strips", .5], ["Green Pepper Strips, Blanched", .5]] : undefined;
      if (!specification || !components.every((component) => Number(component.perPizza) === 0)) continue;
      const fixed = specification.map(([ingredient, perPizza]) => ({ ingredient, perPizza, perBatchLbs: Math.round(Number(perPizza) * 745.2 / 16 * 10000) / 10000 }));
      await tx.update(mixesTable).set({ components: fixed as any, batchSize: fixed.reduce((sum, component) => sum + component.perBatchLbs, 0), updatedAt: new Date() } as any).where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope)));
      updated++;
    }
    return { scanned: rows.length, updated };
  },
);

export const augustImportRepairs = Object.freeze([
  aug2026ImportFixCheeseRecipesRepair, aug2026ImportFixMixesRepair, aug2026ImportFixProfilesRepair, aug2026ImportFixSauceRecipesRepair,
  aug2026CheeseRecipeLbsRepair, aug2026LowesMixStrayComponentRepair,
]);