import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, deniedMergesTable, type DeniedMerge as DeniedMergeRow } from "@workspace/db";
import { SaveDeniedMergesBody, DeleteDeniedMergesBody } from "@workspace/api-zod";
import { deniedPairKey } from "@workspace/merge-suggest";
import { noStore } from "../lib/cacheControl";

const router: IRouter = Router();

// Denied (ignored) ingredient-merge pairs: persisted unordered name pairs the
// user explicitly told the app to never propose merging together. The AI merge-
// suggester and the local "previously merged" suggestions filter these out. All
// routes sit behind the router-level requireAuth, so any signed-in user
// (operators included) can read and contribute — intentionally NOT manager-gated,
// matching the learned merge-alias precedent.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;

type ApiPair = {
  nameA: string;
  nameB: string;
};

function toApiPair(row: DeniedMergeRow): ApiPair {
  return { nameA: row.nameA, nameB: row.nameB };
}

// Normalize a pair to its canonical stored form: trimmed, lowercased, and sorted
// so the same two names always produce one row regardless of order/case. Returns
// null for blank or self-referential pairs (they carry no information).
function normalizePair(a: unknown, b: unknown): { nameA: string; nameB: string } | null {
  const x = (typeof a === "string" ? a : "").trim().slice(0, MAX_NAME_LEN).toLowerCase();
  const y = (typeof b === "string" ? b : "").trim().slice(0, MAX_NAME_LEN).toLowerCase();
  if (!x || !y || x === y) return null;
  return x <= y ? { nameA: x, nameB: y } : { nameA: y, nameB: x };
}

async function listAll(): Promise<ApiPair[]> {
  const rows = await db.select().from(deniedMergesTable);
  return rows.map(toApiPair);
}

router.get("/denied-merges", async (req: Request, res: Response) => {
  try {
    noStore(res);
    const denied = await listAll();
    res.json({ denied });
  } catch (err) {
    req.log.error({ err }, "failed to list denied merges");
    res.status(500).json({ error: "Failed to list denied merges" });
  }
});

router.post("/denied-merges", async (req: Request, res: Response) => {
  const parsed = SaveDeniedMergesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize + dedupe the incoming batch by canonical key up front.
  const byKey = new Map<string, { nameA: string; nameB: string }>();
  for (const p of parsed.data.pairs.slice(0, MAX_BATCH)) {
    const norm = normalizePair(p.nameA, p.nameB);
    if (!norm) continue;
    byKey.set(deniedPairKey(norm.nameA, norm.nameB), norm);
  }

  try {
    if (byKey.size > 0) {
      const existing = await db.select().from(deniedMergesTable);
      const have = new Set<string>();
      for (const row of existing) {
        have.add(deniedPairKey(row.nameA, row.nameB));
      }
      const inserts: { nameA: string; nameB: string }[] = [];
      for (const [key, pair] of byKey) {
        if (!have.has(key)) inserts.push(pair);
      }
      if (inserts.length > 0) {
        await db.insert(deniedMergesTable).values(inserts).onConflictDoNothing();
      }
    }

    const denied = await listAll();
    res.json({ denied });
  } catch (err) {
    req.log.error({ err }, "failed to save denied merges");
    res.status(500).json({ error: "Failed to save denied merges" });
  }
});

router.delete("/denied-merges", async (req: Request, res: Response) => {
  const parsed = DeleteDeniedMergesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const toRemove: { nameA: string; nameB: string }[] = [];
  for (const p of parsed.data.pairs.slice(0, MAX_BATCH)) {
    const norm = normalizePair(p.nameA, p.nameB);
    if (norm) toRemove.push(norm);
  }

  try {
    for (const pair of toRemove) {
      await db
        .delete(deniedMergesTable)
        .where(
          and(
            eq(deniedMergesTable.nameA, pair.nameA),
            eq(deniedMergesTable.nameB, pair.nameB),
          ),
        );
    }
    const denied = await listAll();
    res.json({ denied });
  } catch (err) {
    req.log.error({ err }, "failed to delete denied merges");
    res.status(500).json({ error: "Failed to delete denied merges" });
  }
});

export default router;
