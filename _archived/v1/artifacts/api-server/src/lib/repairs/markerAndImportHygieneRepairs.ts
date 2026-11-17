import { and, eq, inArray } from "drizzle-orm";
import { ingredientsTable } from "@workspace/db";
import { planIngredientDuplicateMerges } from "../ingredientDuplicateHeal";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const INGREDIENT_ACTIVE_NAME_DEDUPE_REPAIR_ID = "ingredient-active-name-dedupe-v1";

/** Consolidates only planner-approved active duplicate ingredient groups. */
export const ingredientActiveNameDedupeRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: INGREDIENT_ACTIVE_NAME_DEDUPE_REPAIR_ID,
  owner: "import-hygiene",
  dependencies: Object.freeze(["data-heal-result-backfill-v1"]),
  eligibility: "Only active duplicate ingredient groups selected by the shared merge planner are consolidated.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Planner-approved same-scope active ingredient duplicate groups.",
    excludedScope: "All ingredients outside the shared planner's exact duplicate predicate.",
    rollback: "Marker preserves merge counts; restoring merged rows requires reviewed source data.",
    evidence: "The existing ingredient duplicate merge planner and released marker id.",
  }),
  async execute(tx) {
    const rows = await tx.select().from(ingredientsTable).for("update");
    const plans = planIngredientDuplicateMerges(rows);
    const updatedAt = new Date();
    let duplicatesMerged = 0;
    for (const plan of plans) {
      await tx.update(ingredientsTable).set({ categories: plan.categories, updatedAt })
        .where(and(eq(ingredientsTable.id, plan.canonicalId), eq(ingredientsTable.scope, plan.scope)));
      await tx.update(ingredientsTable).set({
        mergedInto: plan.canonicalId,
        enabled: false,
        updatedAt,
      }).where(and(eq(ingredientsTable.scope, plan.scope), inArray(ingredientsTable.id, plan.duplicateIds)));
      duplicatesMerged += plan.duplicateIds.length;
    }
    return { groupsMerged: plans.length, duplicatesMerged };
  },
});