import { and, eq } from "drizzle-orm";
import { brandProfilesTable, doughRecipesTable, sauceRecipesTable } from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const LIVE_PROFILE_RECIPE_LINK_REPAIR_ID = "live-profile-recipe-link-repair-v1";

// This is deliberately a frozen, source-owned contract.  It is not derived
// from current health findings: these are the rows reviewed for this release.
const repairs = Object.freeze([
  { brand: "aldo's", flavor: "sausage", field: "frontlineRecipeName", from: "Aldo's Sauce (made in house)", to: "Aldo's Sauce" },
  { brand: "basha's ultra thin crust", flavor: "5 cheese", field: "doughRecipeName", from: "11\" CRB recipe", to: "CRB Dough" },
  { brand: "basha's ultra thin crust", flavor: "bbq chicken", field: "doughRecipeName", from: "11\" CRB recipe", to: "CRB Dough" },
  { brand: "basha's ultra thin crust", flavor: "hawaiian", field: "doughRecipeName", from: "11\" CRB recipe", to: "CRB Dough" },
  { brand: "basha's ultra thin crust", flavor: "ultimate pepperoni", field: "doughRecipeName", from: "11\" CRB recipe", to: "CRB Dough" },
].map((repair) => Object.freeze(repair)) as readonly Readonly<{
  brand: string; flavor: string; field: string; from: string; to: string;
}>[]);

export const liveProfileRecipeLinkRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: LIVE_PROFILE_RECIPE_LINK_REPAIR_ID,
  owner: "import-review",
  dependencies: Object.freeze([]),
  eligibility: "Only live profiles with one of the reviewed exact source links are changed.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "live brand_profiles; five reviewed brand/flavor/link predicates",
    excludedScope: "all other profiles and any link not exactly equal to the reviewed source value",
    rollback: "The marker records counts; restoring a prior protected link requires explicit manager review.",
    evidence: "Reviewed saved-spec and spec-alias mappings shipped with the repair.",
  }),
  async execute(tx) {
    const profiles = await tx.select().from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, "live")).for("update");
    const recipes = await tx.select().from(doughRecipesTable)
      .where(eq(doughRecipesTable.scope, "live"));
    const sauces = await tx.select().from(sauceRecipesTable)
      .where(eq(sauceRecipesTable.scope, "live"));
    let updated = 0;
    for (const profile of profiles) {
      const repair = repairs.find((candidate) =>
        candidate.brand === profile.brand.trim().toLowerCase() &&
        candidate.flavor === profile.flavor.trim().toLowerCase() &&
        String((profile.values ?? {})[candidate.field] ?? "").trim() === candidate.from,
      );
      if (!repair) continue;
      const target = (repair.field === "doughRecipeName" ? recipes : sauces)
        .find((row) => row.name.trim().toLowerCase() === repair.to.toLowerCase());
      if (!target) continue;
      const values = { ...(profile.values ?? {}) } as Record<string, unknown>;
      values[repair.field] = target.name;
      await tx.update(brandProfilesTable).set({
        values, updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, Date.now()),
      }).where(and(eq(brandProfilesTable.key, profile.key), eq(brandProfilesTable.scope, profile.scope)));
      updated++;
    }
    return { scanned: profiles.length, updated };
  },
  validateResult: (result) => Number.isInteger(result.scanned) && Number.isInteger(result.updated) &&
    Number(result.scanned) >= Number(result.updated),
});

export const liveProfileRecipeLinkRepairContract = Object.freeze({
  id: LIVE_PROFILE_RECIPE_LINK_REPAIR_ID,
  repairs,
});