import { and, eq } from "drizzle-orm";
import { cheeseRecipesTable } from "@workspace/db";
import {
  backfillCheeseSharePcts,
  normalizeCheeseRecipe,
} from "@workspace/cheese-recipes";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

/** The released repair was intentionally a marker-only no-op: audited
 * production data had no poisoned component ounces. */
export const CHEESE_OZ_DEPOISON_REPAIR_ID = "cheese-oz-depoison-v1";

export const cheeseOzDepoisonRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: CHEESE_OZ_DEPOISON_REPAIR_ID,
  owner: "recipe-normalization",
  dependencies: Object.freeze(["cheese-share-backfill-v1"]),
  eligibility: "Audited cheese component ounce poison was absent; claim the released no-op marker only.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "No cheese recipe rows; marker-only historical no-op.",
    excludedScope: "Every manager and recipe value is preserved.",
    rollback: "No data mutation occurred; marker records the released audit outcome.",
    evidence: "Production audit confirmed zero components with poisoned ounces.",
  }),
  async execute() {
    return {};
  },
});

export const CHEESE_SHARE_BACKFILL_REPAIR_ID = "cheese-share-backfill-v1";

export const cheeseShareBackfillRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: CHEESE_SHARE_BACKFILL_REPAIR_ID,
  owner: "recipe-normalization",
  dependencies: Object.freeze(["cheese-named-mix-crossover-purge-v1"]),
  eligibility: "Only normalizable cheese recipes missing derived component share percentages are updated.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Cheese recipe components whose shares can be derived from their existing ounces or pounds.",
    excludedScope: "Existing sharePct, lbs, and ozPerPizza manager values are never changed.",
    rollback: "Marker preserves counts; reversal requires explicit reviewed source data.",
    evidence: "The cheese ratio model derives shares using the shared recipe normalizer.",
  }),
  async execute(tx) {
    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let updatedRows = 0;
    for (const row of rows) {
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe) continue;
      const [changed] = backfillCheeseSharePcts([recipe]);
      if (!changed) continue;
      await tx.update(cheeseRecipesTable).set({ components: changed.components, updatedAt: new Date() })
        .where(and(eq(cheeseRecipesTable.id, row.id), eq(cheeseRecipesTable.scope, row.scope)));
      updatedRows++;
    }
    return { scanned: rows.length, updatedRows };
  },
  validateResult: (result) => Number.isInteger(result.scanned) && Number.isInteger(result.updatedRows),
});