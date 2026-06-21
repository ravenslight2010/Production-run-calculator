import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, photoAliasesTable, type PhotoAlias } from "@workspace/db";
import { SavePhotoAliasesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Learned photo-intake aliases: persisted guessName -> inventory itemKey
// mappings a user confirmed during photo intake, so future identifications
// auto-apply the remembered match even when the vision model returns no/low
// match. All routes sit behind the router-level requireAuth, so any signed-in
// user can read and contribute — intentionally NOT manager-gated.

const MAX_BATCH = 500;
const MAX_NAME_LEN = 200;

type AliasRow = {
  guessName: string;
  itemKey: string;
};

// Case-insensitive identity key: one guessed name resolves to exactly one item.
function aliasKey(guessName: string): string {
  return guessName.toLowerCase();
}

function toApiAlias(row: PhotoAlias): AliasRow {
  return { guessName: row.guessName, itemKey: row.itemKey };
}

async function listAll(): Promise<AliasRow[]> {
  const rows = await db
    .select()
    .from(photoAliasesTable)
    .where(eq(photoAliasesTable.scope, currentScope()));
  return rows.map(toApiAlias);
}

router.get("/photo-aliases", async (req: Request, res: Response) => {
  try {
    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to list photo aliases");
    res.status(500).json({ error: "Failed to list photo aliases" });
  }
});

router.post("/photo-aliases", async (req: Request, res: Response) => {
  const parsed = SavePhotoAliasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate entries up front.
  const incoming: AliasRow[] = [];
  for (const a of parsed.data.aliases.slice(0, MAX_BATCH)) {
    const guessName = (a.guessName ?? "").trim().slice(0, MAX_NAME_LEN);
    const itemKey = (a.itemKey ?? "").trim().slice(0, MAX_NAME_LEN);
    if (!guessName || !itemKey) continue;
    incoming.push({ guessName, itemKey });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db
        .select()
        .from(photoAliasesTable)
        .where(eq(photoAliasesTable.scope, currentScope()));
      const byKey = new Map<string, PhotoAlias>();
      for (const row of existing) {
        byKey.set(aliasKey(row.guessName), row);
      }

      // Dedupe the incoming batch by identity key (last write wins).
      const toApply = new Map<string, AliasRow>();
      for (const a of incoming) {
        toApply.set(aliasKey(a.guessName), a);
      }

      const inserts: AliasRow[] = [];
      for (const [key, a] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(a);
        } else if (prior.itemKey !== a.itemKey) {
          await db
            .update(photoAliasesTable)
            .set({ itemKey: a.itemKey, updatedAt: new Date() })
            .where(eq(photoAliasesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db
          .insert(photoAliasesTable)
          .values(inserts.map((a) => ({ ...a, scope: currentScope() })));
      }
    }

    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to save photo aliases");
    res.status(500).json({ error: "Failed to save photo aliases" });
  }
});

export default router;
