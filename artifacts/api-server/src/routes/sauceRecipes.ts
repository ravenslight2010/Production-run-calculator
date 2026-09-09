import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, sauceRecipesTable, type SauceRecipeRow } from "@workspace/db";
import { SaveSauceRecipesBody, DeleteSauceRecipesBody } from "@workspace/api-zod";
import { normalizeNamedRecipe, type NamedRecipe } from "@workspace/named-recipes";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import { invalidateMasterDataBootstrapCache } from "./masterDataBootstrap";
import { broadcastMasterDataChanged } from "./sync";

// Manager-defined, factory-wide SAUCE (frontline) recipes (a name plus a list of
// {ingredient, lbs} components). Rebuilt to work like Mixes / Cheese Recipes:
// reading is open to any signed-in user (both apps hydrate the run form's Sauce
// card from these), while creating, updating, and deleting are manager-only —
// matching the mixes / cheese-recipes precedent (open GET, manager-gated writes).
// Recipes are normalized + validated with the shared @workspace/named-recipes
// model so the server is the source of truth for what a well-formed recipe is.
// Gated on "manage-inventory" since this is warehouse/inventory master-data.

const MAX_BATCH = 500;

class RecipeRevisionConflict extends Error {
  constructor(readonly rejectedIds: string[]) {
    super("Recipe snapshot is stale");
  }
}

function comparable(item: NamedRecipe): string {
  return JSON.stringify({
    id: item.id,
    name: item.name,
    notes: item.notes,
    components: item.components,
    enabled: item.enabled,
    brand: item.brand,
    flavors: item.flavors,
  });
}

function toApiItem(row: SauceRecipeRow): NamedRecipe {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    notes: row.notes,
    components: row.components ?? [],
    enabled: row.enabled,
    brand: row.brand ?? "",
    flavors: row.flavors ?? [],
  };
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
    updatedAt: new Date(),
  };
}

function nextRevision(previous?: Date): Date {
  return new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1));
}

async function listAll(): Promise<NamedRecipe[]> {
  const rows = await db
    .select()
    .from(sauceRecipesTable)
    .where(eq(sauceRecipesTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/sauce-recipes", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list sauce recipes");
    res.status(500).json({ error: "Failed to list sauce recipes" });
  }
});

router.post(
  "/sauce-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveSauceRecipesBody.safeParse(req.body);
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
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"sauce-recipes:" + currentScope()}))`,
        );
        const existingRows = await tx
          .select()
          .from(sauceRecipesTable)
          .where(eq(sauceRecipesTable.scope, currentScope()))
          .for("update");
        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        const rejectedIds: string[] = [];
        for (const [id, recipe] of byId) {
          const existing = existingById.get(id);
          if (!existing) continue;
          const incomingRevision = recipe.updatedAt ? new Date(recipe.updatedAt) : null;
          const storedRevision = existing.updatedAt.getTime();
          if (
            !incomingRevision ||
            !Number.isFinite(incomingRevision.getTime()) ||
            incomingRevision.getTime() < storedRevision
          ) {
            rejectedIds.push(id);
          }
        }
        if (rejectedIds.length > 0) throw new RecipeRevisionConflict(rejectedIds);

        for (const recipe of byId.values()) {
          const existing = existingById.get(recipe.id);
          const values = toDbValues(recipe);
          values.updatedAt = nextRevision(existing?.updatedAt);
          if (
            existing &&
            recipe.updatedAt &&
            new Date(recipe.updatedAt).getTime() === existing.updatedAt.getTime() &&
            comparable(recipe) === comparable(toApiItem(existing))
          ) {
            continue;
          }
          await tx
            .insert(sauceRecipesTable)
            .values(values)
            .onConflictDoUpdate({
              target: [sauceRecipesTable.id, sauceRecipesTable.scope],
              set: {
                name: values.name,
                notes: values.notes,
                components: values.components,
                enabled: values.enabled,
                brand: values.brand,
                flavors: values.flavors,
                updatedAt: values.updatedAt,
              },
            });
        }
      });
      invalidateMasterDataBootstrapCache();
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      if (err instanceof RecipeRevisionConflict) {
        res.status(409).json({
          error: "STALE_RECIPE_SNAPSHOT",
          rejectedIds: err.rejectedIds,
          items: await listAll(),
        });
        return;
      }
      req.log.error({ err }, "failed to save sauce recipes");
      res.status(500).json({ error: "Failed to save sauce recipes" });
    }
  },
);

router.delete(
  "/sauce-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteSauceRecipesBody.safeParse(req.body);
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
          .delete(sauceRecipesTable)
          .where(
            and(
              inArray(sauceRecipesTable.id, ids),
              eq(sauceRecipesTable.scope, currentScope()),
            ),
          );
      }
      invalidateMasterDataBootstrapCache();
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete sauce recipes");
      res.status(500).json({ error: "Failed to delete sauce recipes" });
    }
  },
);

export default router;
