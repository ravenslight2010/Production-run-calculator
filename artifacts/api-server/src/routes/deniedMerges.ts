import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, deniedMergesTable, type DeniedMerge as DeniedMergeRow } from "@workspace/db";
import { SaveDeniedMergesBody, DeleteDeniedMergesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { deniedPairKey, type MergeSuggestCategory } from "@workspace/merge-suggest";

const router: IRouter = Router();

// Denied (ignored) merge pairs: persisted unordered name pairs the user
// explicitly told the app to never propose merging together. The AI merge-
// suggester and the local "previously merged" suggestions filter these out.
// All routes sit behind the router-level requireAuth, so any signed-in user
// (operators included) can read and contribute — intentionally NOT
// manager-gated, matching the learned merge-alias precedent.
//
// Every denial is scoped to a `category` (which merge tab it came from), so a
// denial on one tab never suppresses an unrelated suggestion on another.
// "flavor" pairs are additionally scoped to a single `brand` (a flavor pair
// denied for one brand must not suppress the same pair for a different
// brand). Rows written before categories existed default to category
// "ingredient" (see schema), matching every pre-existing caller that never
// sent one.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;
const CATEGORIES: MergeSuggestCategory[] = [
  "ingredient",
  "mixes",
  "dough",
  "sauce",
  "cheese",
  "brand",
  "flavor",
];

type ApiPair = {
  nameA: string;
  nameB: string;
};

function toApiPair(row: DeniedMergeRow): ApiPair {
  return { nameA: row.nameA, nameB: row.nameB };
}

function parseCategory(raw: unknown): MergeSuggestCategory {
  const c = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CATEGORIES as string[]).includes(c) ? (c as MergeSuggestCategory) : "ingredient";
}

// Strict variant for GET query params: an unrecognized category is a caller
// error (bad query string), not an implicit "ingredient" — unlike the POST/
// DELETE body paths, which go through the zod enum first and so can only
// ever see an already-valid value or `undefined`.
function parseCategoryStrict(raw: unknown): MergeSuggestCategory | null {
  if (raw === undefined) return "ingredient";
  const c = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CATEGORIES as string[]).includes(c) ? (c as MergeSuggestCategory) : null;
}

function parseBrand(category: MergeSuggestCategory, raw: unknown): string | null {
  if (category !== "flavor") return null;
  const b = typeof raw === "string" ? raw.trim().slice(0, MAX_NAME_LEN) : "";
  return b || null;
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

function scopeFilter(category: MergeSuggestCategory, brand: string | null) {
  return and(
    eq(deniedMergesTable.scope, currentScope()),
    eq(deniedMergesTable.category, category),
    brand ? eq(deniedMergesTable.brand, brand) : isNull(deniedMergesTable.brand),
  );
}

async function listAll(category: MergeSuggestCategory, brand: string | null): Promise<ApiPair[]> {
  const rows = await db.select().from(deniedMergesTable).where(scopeFilter(category, brand));
  return rows.map(toApiPair);
}

router.get("/denied-merges", async (req: Request, res: Response) => {
  const category = parseCategoryStrict(req.query.category);
  if (category === null) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  try {
    const brand = parseBrand(category, req.query.brand);
    const denied = await listAll(category, brand);
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

  const category = parseCategory(parsed.data.category);
  const brand = parseBrand(category, parsed.data.brand);

  // Normalize + dedupe the incoming batch by canonical key up front.
  const byKey = new Map<string, { nameA: string; nameB: string }>();
  for (const p of parsed.data.pairs.slice(0, MAX_BATCH)) {
    const norm = normalizePair(p.nameA, p.nameB);
    if (!norm) continue;
    byKey.set(deniedPairKey(norm.nameA, norm.nameB), norm);
  }

  try {
    if (byKey.size > 0) {
      const existing = await db.select().from(deniedMergesTable).where(scopeFilter(category, brand));
      const have = new Set<string>();
      for (const row of existing) {
        have.add(deniedPairKey(row.nameA, row.nameB));
      }
      const inserts: { nameA: string; nameB: string }[] = [];
      for (const [key, pair] of byKey) {
        if (!have.has(key)) inserts.push(pair);
      }
      if (inserts.length > 0) {
        await db
          .insert(deniedMergesTable)
          .values(inserts.map((p) => ({ ...p, scope: currentScope(), category, brand })))
          .onConflictDoNothing();
      }
    }

    const denied = await listAll(category, brand);
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

  const category = parseCategory(parsed.data.category);
  const brand = parseBrand(category, parsed.data.brand);

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
            scopeFilter(category, brand),
          ),
        );
    }
    const denied = await listAll(category, brand);
    res.json({ denied });
  } catch (err) {
    req.log.error({ err }, "failed to delete denied merges");
    res.status(500).json({ error: "Failed to delete denied merges" });
  }
});

export default router;
