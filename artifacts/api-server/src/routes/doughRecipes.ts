import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, doughRecipesTable, type DoughRecipeRow } from "@workspace/db";
import { SaveDoughRecipesBody, DeleteDoughRecipesBody } from "@workspace/api-zod";
import { normalizeNamedRecipe, type NamedRecipe } from "@workspace/named-recipes";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

// Manager-defined, factory-wide DOUGH recipes (a name plus a list of {ingredient,
// lbs} components). Rebuilt to work like Mixes / Cheese Recipes: reading is open
// to any signed-in user (both apps hydrate the run form's Dough card from these),
// while creating, updating, and deleting are manager-only — matching the mixes /
// cheese-recipes precedent (open GET, manager-gated writes). Recipes are
// normalized + validated with the shared @workspace/named-recipes model so the
// server is the source of truth for what a well-formed recipe is. Gated on
// "manage-inventory" since this is warehouse/inventory master-data.

const MAX_BATCH = 500;

function toApiItem(row: DoughRecipeRow): NamedRecipe {
  const item: NamedRecipe = {
    id: row.id,
    name: row.name,
    notes: row.notes,
    components: row.components ?? [],
    enabled: row.enabled,
    brand: row.brand ?? "",
    flavors: row.flavors ?? [],
  };
  if ((row.doughballWeightOz ?? 0) > 0) item.doughballWeightOz = row.doughballWeightOz;
  if ((row.doughballsPerTray ?? 0) > 0) item.doughballsPerTray = row.doughballsPerTray;
  return item;
}

function toDbValues(item: NamedRecipe) {
  return {
    id: item.id,
    scope: currentScope(),
    name: item.name,
    notes: item.notes ?? "",
    components: item.components,
    enabled: item.enabled,
    brand: item.brand ?? "",
    flavors: item.flavors ?? [],
    doughballWeightOz: item.doughballWeightOz ?? 0,
    doughballsPerTray: item.doughballsPerTray ?? 0,
    updatedAt: new Date(),
  };
}

async function listAll(): Promise<NamedRecipe[]> {
  const rows = await db
    .select()
    .from(doughRecipesTable)
    .where(eq(doughRecipesTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/dough-recipes", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list dough recipes");
    res.status(500).json({ error: "Failed to list dough recipes" });
  }
});

router.post(
  "/dough-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveDoughRecipesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed recipes, then dedupe by id (last write wins) so
    // a single request can't fight itself with two values for the same id.
    const byId = new Map<string, NamedRecipe>();
    for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
      const recipe = normalizeNamedRecipe(raw);
      if (recipe) byId.set(recipe.id, recipe);
    }

    try {
      // One transaction for the whole batch: a mid-loop failure must not
      // commit some rows and drop the rest (clients rename in batches and
      // re-point local references only after this endpoint succeeds — a
      // partial commit would strand references to half-renamed names).
      await db.transaction(async (tx) => {
        for (const recipe of byId.values()) {
          const values = toDbValues(recipe);
          await tx
            .insert(doughRecipesTable)
            .values(values)
            .onConflictDoUpdate({
              target: [doughRecipesTable.id, doughRecipesTable.scope],
              set: {
                name: values.name,
                notes: values.notes,
                components: values.components,
                enabled: values.enabled,
                brand: values.brand,
                flavors: values.flavors,
                doughballWeightOz: values.doughballWeightOz,
                doughballsPerTray: values.doughballsPerTray,
                updatedAt: values.updatedAt,
              },
            });
        }
      });
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to save dough recipes");
      res.status(500).json({ error: "Failed to save dough recipes" });
    }
  },
);

router.delete(
  "/dough-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteDoughRecipesBody.safeParse(req.body);
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
        await db
          .delete(doughRecipesTable)
          .where(
            and(
              inArray(doughRecipesTable.id, ids),
              eq(doughRecipesTable.scope, currentScope()),
            ),
          );
      }
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete dough recipes");
      res.status(500).json({ error: "Failed to delete dough recipes" });
    }
  },
);

export default router;
