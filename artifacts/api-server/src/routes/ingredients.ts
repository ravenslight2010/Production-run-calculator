import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, ingredientsTable, type IngredientRow } from "@workspace/db";
import {
  SaveIngredientsBody,
  DeleteIngredientsBody,
  MergeIngredientsBody,
} from "@workspace/api-zod";
import {
  ingredientNameKey,
  normalizeIngredient,
  type Ingredient,
  unionIngredientCategories,
} from "@workspace/ingredient-catalog";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import {
  ingredientMergePath,
  resolveIngredientMergeTarget,
} from "../lib/ingredientMerge";

// Factory-wide ingredient catalog. Reading is open to any signed-in
// user (both apps resolve recipe rows and build category pickers from this),
// while creating/renaming/merging/deleting are manager-only — matching the
// mixes / cheese-recipes precedent (open GET, manager-gated writes). Gated on
// "manage-inventory" since this is warehouse/inventory master-data.
//
// GET /ingredients has no capability guard by design — every authenticated role
// needs access. A 403 on that route would indicate the request reached the
// server without a valid session (e.g. a race during sign-up before the cookie
// is fully applied), not a privilege problem.
//
// Renames are just an upsert of an existing id with a new name: since recipe
// rows reference the id, the new name is picked up everywhere with no
// client-side rewrite. Merges/deletes are soft (mergedInto pointer / enabled
// flag) rather than hard deletes so historical recipe rows referencing an id
// that's gone away can still resolve to a display name.

const MAX_BATCH = 1000;

function toApiItem(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    name: row.name,
    categories: row.categories ?? [],
    mergedInto: row.mergedInto ?? null,
    enabled: row.enabled,
  };
}

function toDbValues(item: Ingredient) {
  return {
    id: item.id,
    scope: currentScope(),
    name: item.name,
    categories: item.categories,
    mergedInto: item.mergedInto ?? null,
    enabled: item.enabled,
    updatedAt: new Date(),
  };
}

async function listAll(): Promise<Ingredient[]> {
  const rows = await db
    .select()
    .from(ingredientsTable)
    .where(eq(ingredientsTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/ingredients", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list ingredients");
    res.status(500).json({ error: "Failed to list ingredients" });
  }
});

router.post(
  "/ingredients",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveIngredientsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed ingredients, then dedupe by id (last write
    // wins) so a single request can't fight itself with two values for the
    // same id.
    const byId = new Map<string, Ingredient>();
    for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
      const ingredient = normalizeIngredient(raw);
      if (ingredient) byId.set(ingredient.id, ingredient);
    }

    try {
      const scope = currentScope();
      await db.transaction(async (tx) => {
        // Serialize catalog writes for this scope so concurrent repeat imports
        // cannot both observe a missing name and mint separate identities.
        const existing = await tx
          .select()
          .from(ingredientsTable)
          .where(eq(ingredientsTable.scope, scope))
          .for("update");
        for (const ingredient of byId.values()) {
          const sameId = existing.find((row) => row.id === ingredient.id);
          const sameName = existing.find(
            (row) =>
              row.enabled &&
              !row.mergedInto &&
              ingredientNameKey(row.name) === ingredientNameKey(ingredient.name),
          );
          // A fresh import commonly generates a fresh client id. Reuse the
          // active name owner instead of creating another selectable identity.
          const target = sameName ?? sameId;
          if (target) {
            const updatedAt = new Date();
            await tx
              .update(ingredientsTable)
              .set({
                ...(sameName && sameName.id !== ingredient.id
                  ? {}
                  : {
                      name: ingredient.name,
                      mergedInto: ingredient.mergedInto ?? null,
                      enabled: ingredient.enabled,
                    }),
                categories: unionIngredientCategories(
                  target.categories,
                  ingredient.categories,
                ),
                updatedAt,
              })
              .where(
                and(
                  eq(ingredientsTable.id, target.id),
                  eq(ingredientsTable.scope, scope),
                ),
              );
            Object.assign(target, {
              name: sameName && sameName.id !== ingredient.id ? target.name : ingredient.name,
              categories: unionIngredientCategories(target.categories, ingredient.categories),
              mergedInto: sameName && sameName.id !== ingredient.id ? target.mergedInto : ingredient.mergedInto ?? null,
              enabled: sameName && sameName.id !== ingredient.id ? target.enabled : ingredient.enabled,
            });
            continue;
          }

          const values = toDbValues(ingredient);
          await tx.insert(ingredientsTable).values(values);
          existing.push({
            ...values,
            createdAt: new Date(),
          });
        }
      });
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to save ingredients");
      res.status(500).json({ error: "Failed to save ingredients" });
    }
  },
);

router.delete(
  "/ingredients",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteIngredientsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const ids = parsed.data.ids
      .slice(0, MAX_BATCH)
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);

    try {
      if (ids.length > 0) {
        // Soft delete: keep the row (disabled) so historical recipe rows that
        // still reference this id can resolve to its last known name.
        await db
          .update(ingredientsTable)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              inArray(ingredientsTable.id, ids),
              eq(ingredientsTable.scope, currentScope()),
            ),
          );
      }
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete ingredients");
      res.status(500).json({ error: "Failed to delete ingredients" });
    }
  },
);

router.post(
  "/ingredients/merge",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = MergeIngredientsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const targetId = parsed.data.targetId.trim();
    const sourceIds = parsed.data.sourceIds
      .slice(0, MAX_BATCH)
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0 && id !== targetId);

    if (!targetId || sourceIds.length === 0) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    try {
      const scope = currentScope();
      const mergeResult = await db.transaction(async (tx) => {
        // Lock the scoped catalog while resolving chains and categories. This
        // prevents two manager merges from losing a category union through
        // interleaved read/update sequences.
        const existing = await tx
          .select()
          .from(ingredientsTable)
          .where(eq(ingredientsTable.scope, scope))
          .for("update");
        const target = existing.find((row) => row.id === targetId);
        if (!target) return { error: "Unknown target ingredient" as const };

        const knownIds = new Set(existing.map((row) => row.id));
        const unknownSource = sourceIds.find((id) => !knownIds.has(id));
        if (unknownSource) return { error: "Unknown source ingredient" as const };

        // A target may itself be a predecessor from an earlier merge. Always
        // continue at the final target so the catalog never develops a new
        // branch hanging off a disabled row.
        const canonicalTargetId = resolveIngredientMergeTarget(existing, targetId);
        const canonicalTarget = existing.find((row) => row.id === canonicalTargetId);
        if (!canonicalTarget) return { error: "Unknown target ingredient" as const };

        // Include every row whose path passes through a requested source or
        // target, including already-flattened predecessors. This both preserves
        // all categories and makes every predecessor point directly at the
        // final target.
        const requestedIds = new Set([targetId, ...sourceIds]);
        const allToRepoint = existing
          .filter((row) => {
            if (row.id === canonicalTargetId) return false;
            const path = ingredientMergePath(existing, row.id);
            return (
              path.some((id) => requestedIds.has(id)) ||
              resolveIngredientMergeTarget(existing, row.id) === canonicalTargetId
            );
          })
          .map((row) => row.id);
        const rowsToRepoint = existing.filter((row) => allToRepoint.includes(row.id));
        const categories = unionIngredientCategories(
          canonicalTarget.categories,
          ...rowsToRepoint.map((row) => row.categories),
        );
        const updatedAt = new Date();

        await tx
          .update(ingredientsTable)
          .set({ categories, updatedAt })
          .where(
            and(
              eq(ingredientsTable.id, canonicalTargetId),
              eq(ingredientsTable.scope, scope),
            ),
          );
        await tx
          .update(ingredientsTable)
          .set({ mergedInto: canonicalTargetId, enabled: false, updatedAt })
          .where(
            and(
              inArray(ingredientsTable.id, allToRepoint),
              eq(ingredientsTable.scope, scope),
            ),
          );
        return { error: null };
      });
      if (mergeResult.error) {
        res.status(400).json({ error: mergeResult.error });
        return;
      }

      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to merge ingredients");
      res.status(500).json({ error: "Failed to merge ingredients" });
    }
  },
);

export default router;
