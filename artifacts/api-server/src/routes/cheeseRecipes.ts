import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, cheeseRecipesTable, type CheeseRecipeRow } from "@workspace/db";
import { SaveCheeseRecipesBody, DeleteCheeseRecipesBody } from "@workspace/api-zod";
import { normalizeCheeseRecipe, type CheeseRecipe } from "@workspace/cheese-recipes";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import { invalidateMasterDataBootstrapCache } from "./masterDataBootstrap";
import { broadcastMasterDataChanged } from "./sync";

// Manager-defined, factory-wide cheese recipes (named cheese blends a customer
// uses on the line). Rebuilt to work like Mixes: reading is open to any signed-in
// user (both apps hydrate the run applicator "Cheese" cards from these), while
// creating, updating, and deleting are manager-only — matching the mixes /
// production-rules / freezer-pull precedent (open GET, manager-gated writes).
// Recipes are normalized + validated with the shared @workspace/cheese-recipes
// model so the server is the source of truth for what a well-formed recipe is.
// Gated on "manage-inventory" since this is warehouse/inventory master-data.

const MAX_BATCH = 500;

class RecipeRevisionConflict extends Error {
  constructor(readonly rejectedIds: string[]) {
    super("Recipe snapshot is stale");
  }
}

function comparable(item: CheeseRecipe): string {
  return JSON.stringify({
    id: item.id,
    name: item.name,
    brand: item.brand,
    flavors: item.flavors,
    shredderSetting: item.shredderSetting,
    cellulose: item.cellulose,
    notes: item.notes,
    components: item.components,
    enabled: item.enabled,
  });
}

function toApiItem(row: CheeseRecipeRow): CheeseRecipe {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    brand: row.brand,
    flavors: row.flavors ?? [],
    shredderSetting: row.shredderSetting,
    cellulose: row.cellulose,
    notes: row.notes,
    components: row.components ?? [],
    enabled: row.enabled,
  };
}

function toDbValues(item: CheeseRecipe) {
  return {
    id: item.id,
    scope: currentScope(),
    name: item.name,
    brand: item.brand,
    flavors: item.flavors,
    shredderSetting: item.shredderSetting ?? "",
    cellulose: item.cellulose ?? "",
    notes: item.notes ?? "",
    components: item.components,
    enabled: item.enabled,
    updatedAt: new Date(),
  };
}

function nextRevision(previous?: Date): Date {
  return new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1));
}

async function listAll(): Promise<CheeseRecipe[]> {
  const rows = await db
    .select()
    .from(cheeseRecipesTable)
    .where(eq(cheeseRecipesTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/cheese-recipes", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list cheese recipes");
    res.status(500).json({ error: "Failed to list cheese recipes" });
  }
});

router.post(
  "/cheese-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveCheeseRecipesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed recipes, then dedupe by id (last write wins) so
    // a single request can't fight itself with two values for the same id.
    const byId = new Map<string, CheeseRecipe>();
    for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
      const recipe = normalizeCheeseRecipe(raw);
      if (recipe) byId.set(recipe.id, recipe);
    }

    try {
      // Server-side name guard: a NEW id must not create a second recipe with a
      // name that already exists in this scope (trimmed, case-insensitive).
      // Clients dedupe against the pool snapshot they loaded, but multi-file
      // imports and concurrent devices race that snapshot — this is what left
      // exact same-name duplicate rows in the pool. Existing ids still update
      // freely (rename/edit by id is the intended flow). Within the batch, the
      // first NEW id for a name wins. The whole read-check-insert runs in one
      // transaction under a per-scope advisory lock so two CONCURRENT requests
      // can't both pass the pre-read and insert the same name — the second
      // waits for the first to commit and then sees its names as taken.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"cheese-recipes:" + currentScope()}))`,
        );
        const existingRows = await tx
          .select()
          .from(cheeseRecipesTable)
          .where(eq(cheeseRecipesTable.scope, currentScope()))
          .for("update");
        const existingIds = new Set(existingRows.map((r) => r.id));
        const takenNames = new Set(
          existingRows.map((r) => r.name.trim().toLowerCase()),
        );
        for (const [id, recipe] of [...byId]) {
          if (existingIds.has(id)) continue;
          const nameKey = recipe.name.trim().toLowerCase();
          if (takenNames.has(nameKey)) byId.delete(id);
          else takenNames.add(nameKey);
        }

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
          if (!existing) {
            await tx.insert(cheeseRecipesTable).values(values);
            continue;
          }
          if (
            recipe.updatedAt &&
            new Date(recipe.updatedAt).getTime() === existing.updatedAt.getTime() &&
            comparable({
              ...recipe,
              cellulose: recipe.cellulose || existing.cellulose,
            }) === comparable(toApiItem(existing))
          ) {
            continue;
          }
          await tx
            .update(cheeseRecipesTable)
            .set({
              name: values.name,
              brand: values.brand,
              flavors: values.flavors,
              shredderSetting: values.shredderSetting,
              // Cellulose is never wiped by a blank import value.
              cellulose:
                values.cellulose !== ""
                  ? values.cellulose
                  : existing.cellulose,
              notes: values.notes,
              components: values.components,
              enabled: values.enabled,
              updatedAt: values.updatedAt,
            })
            .where(
              and(
                eq(cheeseRecipesTable.id, recipe.id),
                eq(cheeseRecipesTable.scope, currentScope()),
              ),
            );
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
      req.log.error({ err }, "failed to save cheese recipes");
      res.status(500).json({ error: "Failed to save cheese recipes" });
    }
  },
);

router.delete(
  "/cheese-recipes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteCheeseRecipesBody.safeParse(req.body);
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
          .delete(cheeseRecipesTable)
          .where(
            and(
              inArray(cheeseRecipesTable.id, ids),
              eq(cheeseRecipesTable.scope, currentScope()),
            ),
          );
      }
      invalidateMasterDataBootstrapCache();
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete cheese recipes");
      res.status(500).json({ error: "Failed to delete cheese recipes" });
    }
  },
);

export default router;
