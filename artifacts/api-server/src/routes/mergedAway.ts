import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, mergedAwayTable } from "@workspace/db";
import { SaveMergedAwayBody, DeleteMergedAwayBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Durable, factory-wide tombstone of merged-away ingredient/die names. When the
// user merges duplicate names, the source names are persisted here so they stay
// merged away across days and across every device — even one that was offline
// during the merge and would otherwise reseed the old names into a new day's
// (initially empty) per-day sync blob. Clients fetch this on load, union it into
// their local tombstone, and strip the names from every master-data list.
//
// All routes sit behind the router-level requireAuth, so any signed-in user
// (operators included) can read and contribute — intentionally NOT manager-
// gated, matching the denied-merges / learned merge-alias precedent.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;

// Normalize a name to its canonical stored form: trimmed, lowercased, length-
// capped. Returns null for blank names (they carry no information).
function normalizeName(raw: unknown): string | null {
  const v = (typeof raw === "string" ? raw : "").trim().slice(0, MAX_NAME_LEN).toLowerCase();
  return v || null;
}

async function listAll(): Promise<string[]> {
  const rows = await db
    .select()
    .from(mergedAwayTable)
    .where(eq(mergedAwayTable.scope, currentScope()));
  return rows.map((r) => r.name);
}

router.get("/merged-away", async (req: Request, res: Response) => {
  try {
    const names = await listAll();
    res.json({ names });
  } catch (err) {
    req.log.error({ err }, "failed to list merged-away names");
    res.status(500).json({ error: "Failed to list merged-away names" });
  }
});

router.post("/merged-away", async (req: Request, res: Response) => {
  const parsed = SaveMergedAwayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize + dedupe the incoming batch by canonical name up front.
  const byName = new Set<string>();
  for (const raw of parsed.data.names.slice(0, MAX_BATCH)) {
    const norm = normalizeName(raw);
    if (norm) byName.add(norm);
  }

  try {
    if (byName.size > 0) {
      const existing = await db
        .select()
        .from(mergedAwayTable)
        .where(eq(mergedAwayTable.scope, currentScope()));
      const have = new Set(existing.map((r) => r.name));
      const inserts = [...byName].filter((n) => !have.has(n));
      if (inserts.length > 0) {
        await db
          .insert(mergedAwayTable)
          .values(inserts.map((name) => ({ name, scope: currentScope() })))
          .onConflictDoNothing();
      }
    }

    const names = await listAll();
    res.json({ names });
  } catch (err) {
    req.log.error({ err }, "failed to save merged-away names");
    res.status(500).json({ error: "Failed to save merged-away names" });
  }
});

router.delete("/merged-away", async (req: Request, res: Response) => {
  const parsed = DeleteMergedAwayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const toRemove: string[] = [];
  for (const raw of parsed.data.names.slice(0, MAX_BATCH)) {
    const norm = normalizeName(raw);
    if (norm) toRemove.push(norm);
  }

  try {
    for (const name of toRemove) {
      await db
        .delete(mergedAwayTable)
        .where(
          and(eq(mergedAwayTable.name, name), eq(mergedAwayTable.scope, currentScope())),
        );
    }
    const names = await listAll();
    res.json({ names });
  } catch (err) {
    req.log.error({ err }, "failed to delete merged-away names");
    res.status(500).json({ error: "Failed to delete merged-away names" });
  }
});

export default router;
