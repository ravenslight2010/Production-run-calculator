import { and, eq, sql } from "drizzle-orm";
import { doughRecipesTable } from "@workspace/db";
import { CRB_INGREDIENT_HEAL_ROWS, isAffectedCrbIngredientRow } from "../crbIngredientHeal";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const CRB_INGREDIENT_REPAIR_ID = "crb-ingredient-conversion-v1";
export const crbIngredientRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: CRB_INGREDIENT_REPAIR_ID,
  owner: "master-data",
  dependencies: Object.freeze([]),
  eligibility: "Only the proven empty live CRB Recipe ingredient stub is replaced.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "live dough recipe named CRB Recipe matching the audited predicate",
    excludedScope: "all non-matching and manager-entered recipe rows",
    rollback: "The marker preserves count evidence; restoration requires explicit reviewed source data.",
    evidence: "CRB workbook's seven pounds-based rows.",
  }),
  async execute(tx) {
    const rows = await tx.select().from(doughRecipesTable)
      .where(and(eq(doughRecipesTable.scope, "live"), eq(sql`lower(${doughRecipesTable.name})`, "crb recipe")))
      .for("update");
    let updated = 0;
    for (const row of rows) {
      if (!isAffectedCrbIngredientRow(row)) continue;
      await tx.update(doughRecipesTable).set({ components: [...CRB_INGREDIENT_HEAL_ROWS], updatedAt: new Date() })
        .where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, row.scope)));
      updated++;
    }
    return { scanned: rows.length, updated, rowsAdded: CRB_INGREDIENT_HEAL_ROWS.length };
  },
  validateResult: (result) => Number.isInteger(result.scanned) && Number.isInteger(result.updated) &&
    Number.isInteger(result.rowsAdded) && Number(result.updated) <= Number(result.scanned),
});