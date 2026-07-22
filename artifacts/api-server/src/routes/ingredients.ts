import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, ingredientsTable, type IngredientRow } from "@workspace/db";
import {
  SaveIngredientsBody,
  DeleteIngredientsBody,
  MergeIngredientsBody,
} from "@workspace/api-zod";
import { normalizeIngredient, type Ingredient } from "@workspace/ingredient-catalog";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

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
      for (const ingredient of byId.values()) {
        const values = toDbValues(ingredient);
        await db
          .insert(ingredientsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [ingredientsTable.id, ingredientsTable.scope],
            set: {
              name: values.name,
              categories: values.categories,
              mergedInto: values.mergedInto,
              enabled: values.enabled,
              updatedAt: values.updatedAt,
            },
          });
      }
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
      const existing = await db
        .select()
        .from(ingredientsTable)
        .where(eq(ingredientsTable.scope, scope));
      const targetExists = existing.some((row) => row.id === targetId);
      if (!targetExists) {
        res.status(400).json({ error: "Unknown target ingredient" });
        return;
      }

      // Repoint anything that was previously merged into one of the sources
      // (chained merges) directly at the new target, then merge the sources
      // themselves — keeps resolution a single hop for every row.
      const repointIds = existing
        .filter((row) => row.mergedInto && sourceIds.includes(row.mergedInto))
        .map((row) => row.id);
      const allToRepoint = Array.from(new Set([...sourceIds, ...repointIds]));

      await db
        .update(ingredientsTable)
        .set({ mergedInto: targetId, enabled: false, updatedAt: new Date() })
        .where(
          and(
            inArray(ingredientsTable.id, allToRepoint),
            eq(ingredientsTable.scope, scope),
          ),
        );

      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to merge ingredients");
      res.status(500).json({ error: "Failed to merge ingredients" });
    }
  },
);

export default router;
