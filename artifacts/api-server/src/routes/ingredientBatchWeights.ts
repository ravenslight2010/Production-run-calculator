import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, ingredientBatchWeightsTable, type IngredientBatchWeight } from "@workspace/db";
import { SaveIngredientBatchWeightsBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Learned per-ingredient batch weights: the "Batch Weight (lbs)" a user typed
// for a plain ingredient (applicator topping, non-default pep type, ready-made
// sauce barrel), keyed case-insensitively by ingredient name. Clients auto-fill
// the remembered weight when that ingredient is picked again — mirroring how
// mixes and cheese recipes carry their own batch weight from their recipe rows.
// All routes sit behind the router-level requireAuth, so any signed-in user
// (operators included) can read and contribute — intentionally NOT manager-gated,
// matching the fill-missing-values / import-alias precedent.

const MAX_BATCH = 200;
const MAX_NAME_LEN = 200;
const MAX_LBS = 100_000;

type WeightRow = {
  name: string;
  lbs: number;
};

function weightKey(name: string): string {
  return name.toLowerCase();
}

function toApiWeight(row: IngredientBatchWeight): WeightRow {
  return { name: row.name, lbs: row.lbs };
}

async function listAll(): Promise<WeightRow[]> {
  const rows = await db
    .select()
    .from(ingredientBatchWeightsTable)
    .where(eq(ingredientBatchWeightsTable.scope, currentScope()));
  return rows.map(toApiWeight);
}

router.get("/ingredient-batch-weights", async (req: Request, res: Response) => {
  try {
    const weights = await listAll();
    res.json({ weights });
  } catch (err) {
    req.log.error({ err }, "failed to list ingredient batch weights");
    res.status(500).json({ error: "Failed to list ingredient batch weights" });
  }
});

router.post("/ingredient-batch-weights", async (req: Request, res: Response) => {
  const parsed = SaveIngredientBatchWeightsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate entries up front. A zero/negative or
  // absurd weight is never worth remembering.
  const incoming: WeightRow[] = [];
  for (const w of parsed.data.weights.slice(0, MAX_BATCH)) {
    const name = (w.name ?? "").trim().slice(0, MAX_NAME_LEN);
    const lbs = Number(w.lbs);
    if (!name || !Number.isFinite(lbs) || lbs <= 0 || lbs > MAX_LBS) continue;
    incoming.push({ name, lbs });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db
        .select()
        .from(ingredientBatchWeightsTable)
        .where(eq(ingredientBatchWeightsTable.scope, currentScope()));
      const byKey = new Map<string, IngredientBatchWeight>();
      for (const row of existing) {
        byKey.set(weightKey(row.name), row);
      }

      // Dedupe the incoming batch by identity key (last write wins).
      const toApply = new Map<string, WeightRow>();
      for (const w of incoming) {
        toApply.set(weightKey(w.name), w);
      }

      const inserts: WeightRow[] = [];
      for (const [key, w] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(w);
        } else if (prior.lbs !== w.lbs) {
          await db
            .update(ingredientBatchWeightsTable)
            .set({ lbs: w.lbs, updatedAt: new Date() })
            .where(eq(ingredientBatchWeightsTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db
          .insert(ingredientBatchWeightsTable)
          .values(inserts.map((w) => ({ ...w, scope: currentScope() })));
      }
    }

    const weights = await listAll();
    res.json({ weights });
  } catch (err) {
    req.log.error({ err }, "failed to save ingredient batch weights");
    res.status(500).json({ error: "Failed to save ingredient batch weights" });
  }
});

export default router;
