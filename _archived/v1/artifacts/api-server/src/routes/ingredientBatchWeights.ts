import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { and } from "drizzle-orm";
import { db, ingredientBatchWeightsTable, type IngredientBatchWeight } from "@workspace/db";
import { SaveIngredientBatchWeightsBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

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
  return name.trim().toLowerCase();
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

router.post("/ingredient-batch-weights", requireCapability("manage-inventory"), async (req: Request, res: Response) => {
  const parsed = SaveIngredientBatchWeightsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate entries up front. Zero is an
  // explicit clear; negative or absurd weights are malformed and ignored.
  const incoming: WeightRow[] = [];
  for (const w of parsed.data.weights.slice(0, MAX_BATCH)) {
    const name = (w.name ?? "").trim().slice(0, MAX_NAME_LEN);
    const lbs = Number(w.lbs);
    if (!name || !Number.isFinite(lbs) || lbs < 0 || lbs > MAX_LBS) continue;
    incoming.push({ name, lbs });
  }

  try {
    if (incoming.length > 0) {
      const scope = currentScope();
      await db.transaction(async (tx) => {
        // Serialize same-scope updates so an older request cannot select the
        // same row and overwrite a newer request after it commits.
        const existing = await tx
          .select()
          .from(ingredientBatchWeightsTable)
          .where(eq(ingredientBatchWeightsTable.scope, scope))
          .for("update");
        const byKey = new Map<string, IngredientBatchWeight[]>();
        for (const row of existing) {
          const rows = byKey.get(weightKey(row.name)) ?? [];
          rows.push(row);
          byKey.set(weightKey(row.name), rows);
        }

        // Dedupe the incoming batch by identity key (last write wins).
        const toApply = new Map<string, WeightRow>();
        for (const w of incoming) toApply.set(weightKey(w.name), w);

        for (const [key, w] of toApply) {
          const priorRows = byKey.get(key) ?? [];
          if (w.lbs === 0) {
            for (const row of priorRows) {
              await tx
                .delete(ingredientBatchWeightsTable)
                .where(and(
                  eq(ingredientBatchWeightsTable.id, row.id),
                  eq(ingredientBatchWeightsTable.scope, scope),
                ));
            }
            continue;
          }

          const prior = priorRows[0];
          if (!prior) {
            await tx
              .insert(ingredientBatchWeightsTable)
              .values({ ...w, scope });
          } else {
            await tx
              .update(ingredientBatchWeightsTable)
              .set({ lbs: w.lbs, updatedAt: new Date() })
              .where(and(
                eq(ingredientBatchWeightsTable.id, prior.id),
                eq(ingredientBatchWeightsTable.scope, scope),
              ));
            // Clean up any legacy case-variant duplicates while this key is
            // already locked, keeping the first row's original display name.
            for (const duplicate of priorRows.slice(1)) {
              await tx
                .delete(ingredientBatchWeightsTable)
                .where(and(
                  eq(ingredientBatchWeightsTable.id, duplicate.id),
                  eq(ingredientBatchWeightsTable.scope, scope),
                ));
            }
          }
        }
      });
    }

    const weights = await listAll();
    res.json({ weights });
  } catch (err) {
    req.log.error({ err }, "failed to save ingredient batch weights");
    res.status(500).json({ error: "Failed to save ingredient batch weights" });
  }
});

export default router;
