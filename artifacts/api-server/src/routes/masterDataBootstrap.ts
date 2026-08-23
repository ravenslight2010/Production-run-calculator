import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  cheeseRecipesTable,
  doughRecipesTable,
  ingredientsTable,
  mixesTable,
  sauceRecipesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";

const router = Router();
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { expiresAt: number; body: Record<string, unknown> }>();

router.get("/master-data/bootstrap", async (req: Request, res: Response) => {
  const scope = currentScope();
  const now = Date.now();
  const cached = cache.get(scope);
  if (cached && cached.expiresAt > now) {
    res.setHeader("X-Master-Data-Cache", "hit");
    res.json(cached.body);
    return;
  }

  try {
    const [ingredients, doughRecipes, sauceRecipes, cheeseRecipes, mixes] =
      await Promise.all([
        db.select().from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
        db.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
        db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
        db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
        db.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
      ]);
    const body = {
      ingredients,
      doughRecipes,
      sauceRecipes,
      cheeseRecipes,
      mixes,
      loadedAt: new Date().toISOString(),
    };
    cache.set(scope, { expiresAt: now + CACHE_TTL_MS, body });
    res.setHeader("X-Master-Data-Cache", "miss");
    res.json(body);
  } catch (err) {
    req.log.error({ err }, "failed to load master-data bootstrap");
    res.status(500).json({ error: "Failed to load master data" });
  }
});

export default router;