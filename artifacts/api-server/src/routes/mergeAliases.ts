import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, mergeAliasesTable, type MergeAlias as MergeAliasRow } from "@workspace/db";
import { SaveMergeAliasesBody } from "@workspace/api-zod";
import { mergeAliasKey } from "@workspace/merge-suggest";
import { noStore } from "../lib/cacheControl";

const router: IRouter = Router();

// Learned ingredient-merge aliases: persisted mappings from a merged-away
// ingredient name to the canonical name it was folded into, contributed
// automatically whenever a merge is confirmed. The AI merge-suggester and the
// local "previously merged" suggestions reuse them. All routes sit behind the
// router-level requireAuth, so any signed-in user (operators included) can read
// and contribute — intentionally NOT manager-gated, matching the import/spec
// alias precedent.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;

type AliasRow = {
  externalName: string;
  canonicalName: string;
};

function toApiAlias(row: MergeAliasRow): AliasRow {
  return { externalName: row.externalName, canonicalName: row.canonicalName };
}

async function listAll(): Promise<AliasRow[]> {
  const rows = await db.select().from(mergeAliasesTable);
  return rows.map(toApiAlias);
}

router.get("/merge-aliases", async (req: Request, res: Response) => {
  try {
    noStore(res);
    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to list merge aliases");
    res.status(500).json({ error: "Failed to list merge aliases" });
  }
});

router.post("/merge-aliases", async (req: Request, res: Response) => {
  const parsed = SaveMergeAliasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate/self-referential entries up front.
  const incoming: AliasRow[] = [];
  for (const a of parsed.data.aliases.slice(0, MAX_BATCH)) {
    const externalName = (a.externalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const canonicalName = (a.canonicalName ?? "").trim().slice(0, MAX_NAME_LEN);
    if (!externalName || !canonicalName) continue;
    // A mapping that just restates the same name carries no information.
    if (externalName.toLowerCase() === canonicalName.toLowerCase()) continue;
    incoming.push({ externalName, canonicalName });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db.select().from(mergeAliasesTable);
      const byKey = new Map<string, MergeAliasRow>();
      for (const row of existing) {
        byKey.set(mergeAliasKey(row.externalName), row);
      }

      // Dedupe the incoming batch by identity key (last write wins) so a single
      // request can't fight itself with two values for the same key.
      const toApply = new Map<string, AliasRow>();
      for (const a of incoming) {
        toApply.set(mergeAliasKey(a.externalName), a);
      }

      const inserts: AliasRow[] = [];
      for (const [key, a] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(a);
        } else if (prior.canonicalName !== a.canonicalName) {
          await db
            .update(mergeAliasesTable)
            .set({ canonicalName: a.canonicalName, updatedAt: new Date() })
            .where(eq(mergeAliasesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db.insert(mergeAliasesTable).values(inserts);
      }
    }

    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to save merge aliases");
    res.status(500).json({ error: "Failed to save merge aliases" });
  }
});

export default router;
