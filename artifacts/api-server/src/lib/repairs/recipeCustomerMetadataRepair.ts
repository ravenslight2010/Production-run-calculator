import { and, eq } from "drizzle-orm";
import {
  cheeseRecipesTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
} from "@workspace/db";
import {
  normalizeDoughballVariantCustomers,
  normalizeNamedRecipeCustomerMetadata,
} from "@workspace/named-recipes";
import { normalizeCheeseRecipeCustomerMetadata } from "@workspace/cheese-recipes";
import { normalizeMixCustomerMetadata } from "@workspace/mixes";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const RECIPE_CUSTOMER_METADATA_CLEANUP_REPAIR_ID =
  "recipe-customer-metadata-cleanup-v1";

type CustomerMetadata = {
  brand: unknown;
  flavors: unknown;
};

function metadataChanged(before: CustomerMetadata, after: CustomerMetadata): boolean {
  return before.brand !== after.brand ||
    JSON.stringify(before.flavors) !== JSON.stringify(after.flavors);
}

/**
 * Normalize only the nested customer assignments on dough variants. Recipe
 * variants may carry other manager-edited fields, so this intentionally does
 * not run the full variant normalizer.
 */
function normalizeDoughVariantCustomers(input: unknown): {
  variants: unknown[];
  changed: boolean;
} {
  if (!Array.isArray(input)) return { variants: [], changed: input !== undefined && input !== null };
  let changed = false;
  const variants = input.map((raw) => {
    if (!raw || typeof raw !== "object" || !Object.prototype.hasOwnProperty.call(raw, "customers")) {
      return raw;
    }
    const record = raw as Record<string, unknown>;
    const customers = normalizeDoughballVariantCustomers(record.customers);
    if (JSON.stringify(customers) === JSON.stringify(record.customers)) return raw;
    changed = true;
    return { ...record, customers };
  });
  return { variants, changed };
}

export const recipeCustomerMetadataCleanupRepair: RepairDefinition<RepairTransaction> =
  Object.freeze({
    id: RECIPE_CUSTOMER_METADATA_CLEANUP_REPAIR_ID,
    owner: "recipe-normalization",
    dependencies: Object.freeze(["speed-adjustment-baseline-v1"]),
    eligibility:
      "Recipe pool customer tags that differ from the shared blank-safe normalizers.",
    mode: "automatic",
    executionMode: "runner-transactional",
    resultOwnership: "runner-marker",
    managerAllowed: false,
    safety: Object.freeze({
      affectedScope:
        "Brand/flavor metadata in dough, sauce, cheese, and mix recipe pools in every scope.",
      excludedScope:
        "Valid customer metadata and all non-customer recipe fields remain unchanged.",
      rollback:
        "The marker records per-pool counts; restoring a prior malformed value requires explicit source review.",
      evidence:
        "Shared manager normalizers define the blank-safe representation and rows are locked before update.",
    }),
    async execute(tx) {
      const doughRows = await tx.select().from(doughRecipesTable).for("update");
      const sauceRows = await tx.select().from(sauceRecipesTable).for("update");
      const cheeseRows = await tx.select().from(cheeseRecipesTable).for("update");
      const mixRows = await tx.select().from(mixesTable).for("update");

      let changedDoughRows = 0;
      for (const row of doughRows) {
        const before: CustomerMetadata = { brand: row.brand, flavors: row.flavors };
        const after = normalizeNamedRecipeCustomerMetadata(row);
        const variantResult = normalizeDoughVariantCustomers(row.doughballVariants);
        const changed = metadataChanged(before, after) || variantResult.changed;
        if (!changed) continue;
        await tx.update(doughRecipesTable).set({
          ...(metadataChanged(before, after) ? { brand: after.brand, flavors: after.flavors } : {}),
          ...(variantResult.changed
            ? { doughballVariants: variantResult.variants as typeof row.doughballVariants }
            : {}),
          updatedAt: new Date(),
        }).where(and(
          eq(doughRecipesTable.id, row.id),
          eq(doughRecipesTable.scope, row.scope),
        ));
        changedDoughRows++;
      }

      let changedSauceRows = 0;
      for (const row of sauceRows) {
        const before: CustomerMetadata = { brand: row.brand, flavors: row.flavors };
        const after = normalizeNamedRecipeCustomerMetadata(row);
        if (!metadataChanged(before, after)) continue;
        await tx.update(sauceRecipesTable).set({
          brand: after.brand,
          flavors: after.flavors,
          updatedAt: new Date(),
        }).where(and(
          eq(sauceRecipesTable.id, row.id),
          eq(sauceRecipesTable.scope, row.scope),
        ));
        changedSauceRows++;
      }

      let changedCheeseRows = 0;
      for (const row of cheeseRows) {
        const before: CustomerMetadata = { brand: row.brand, flavors: row.flavors };
        const after = normalizeCheeseRecipeCustomerMetadata(row);
        if (!metadataChanged(before, after)) continue;
        await tx.update(cheeseRecipesTable).set({
          brand: after.brand,
          flavors: after.flavors,
          updatedAt: new Date(),
        }).where(and(
          eq(cheeseRecipesTable.id, row.id),
          eq(cheeseRecipesTable.scope, row.scope),
        ));
        changedCheeseRows++;
      }

      let changedMixRows = 0;
      for (const row of mixRows) {
        const before = { brand: row.brand, flavor: row.flavor };
        const after = normalizeMixCustomerMetadata(row);
        if (before.brand === after.brand && before.flavor === after.flavor) continue;
        await tx.update(mixesTable).set({
          brand: after.brand,
          flavor: after.flavor,
          updatedAt: new Date(),
        }).where(and(
          eq(mixesTable.id, row.id),
          eq(mixesTable.scope, row.scope),
        ));
        changedMixRows++;
      }

      return {
        inspectedRows: doughRows.length + sauceRows.length + cheeseRows.length + mixRows.length,
        changedRows: changedDoughRows + changedSauceRows + changedCheeseRows + changedMixRows,
        byPool: {
          dough: { inspected: doughRows.length, changed: changedDoughRows },
          sauce: { inspected: sauceRows.length, changed: changedSauceRows },
          cheese: { inspected: cheeseRows.length, changed: changedCheeseRows },
          mix: { inspected: mixRows.length, changed: changedMixRows },
        },
      };
    },
    validateResult: (result) => {
      if (!Number.isInteger(result.inspectedRows) || !Number.isInteger(result.changedRows)) return false;
      const byPool = result.byPool;
      if (!byPool || typeof byPool !== "object" || Array.isArray(byPool)) return false;
      return ["dough", "sauce", "cheese", "mix"].every((pool) => {
        const counts = (byPool as Record<string, unknown>)[pool];
        return !!counts && typeof counts === "object" && !Array.isArray(counts) &&
          Number.isInteger((counts as Record<string, unknown>).inspected) &&
          Number.isInteger((counts as Record<string, unknown>).changed);
      });
    },
  });