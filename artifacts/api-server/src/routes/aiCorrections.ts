import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, aiCorrectionsTable, type AiCorrectionRow } from "@workspace/db";
import { SaveAiCorrectionsBody } from "@workspace/api-zod";
import { correctionKey, MAX_CORRECTION_TEXT_LEN, type AiCorrection } from "@workspace/ai-memory";
import { noStore } from "../lib/cacheControl";

const router: IRouter = Router();

// Shared, factory-wide AI corrections pool: confirmed "read fromText as toText"
// mappings, domain-tagged (ingredient / brand / flavor / die / item). Recorded
// automatically whenever staff confirm a correction in ANY AI helper (a merge,
// a spreadsheet match, a spec-sheet label, a photo-identified item) and fed back
// into every name-resolving AI prompt so a fix learned once is honored
// everywhere. Additive: each helper keeps its own specialized alias table too.
// Sits behind the router-level requireAuth, so any signed-in user (operators
// included) can read and contribute — matching the import/spec/merge alias
// precedent.

const MAX_BATCH = 1000;

function toApi(row: AiCorrectionRow): AiCorrection {
  return { domain: row.domain, fromText: row.fromText, toText: row.toText };
}

async function listAll(): Promise<AiCorrection[]> {
  const rows = await db.select().from(aiCorrectionsTable);
  return rows.map(toApi);
}

router.get("/ai-corrections", async (req: Request, res: Response) => {
  try {
    noStore(res);
    const corrections = await listAll();
    res.json({ corrections });
  } catch (err) {
    req.log.error({ err }, "failed to list ai corrections");
    res.status(500).json({ error: "Failed to list ai corrections" });
  }
});

router.post("/ai-corrections", async (req: Request, res: Response) => {
  const parsed = SaveAiCorrectionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate/self-referential entries up front.
  const incoming: AiCorrection[] = [];
  for (const c of parsed.data.corrections.slice(0, MAX_BATCH)) {
    const domain = (c.domain ?? "").trim().slice(0, MAX_CORRECTION_TEXT_LEN);
    const fromText = (c.fromText ?? "").trim().slice(0, MAX_CORRECTION_TEXT_LEN);
    const toText = (c.toText ?? "").trim().slice(0, MAX_CORRECTION_TEXT_LEN);
    if (!domain || !fromText || !toText) continue;
    // A mapping that just restates the same name carries no information.
    if (fromText.toLowerCase() === toText.toLowerCase()) continue;
    incoming.push({ domain, fromText, toText });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db.select().from(aiCorrectionsTable);
      const byKey = new Map<string, AiCorrectionRow>();
      for (const row of existing) {
        byKey.set(correctionKey(row.domain, row.fromText), row);
      }

      // Dedupe the incoming batch by identity key (last write wins) so a single
      // request can't fight itself with two values for the same key.
      const toApply = new Map<string, AiCorrection>();
      for (const c of incoming) {
        toApply.set(correctionKey(c.domain, c.fromText), c);
      }

      const inserts: AiCorrection[] = [];
      for (const [key, c] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(c);
        } else if (prior.toText !== c.toText) {
          await db
            .update(aiCorrectionsTable)
            .set({ toText: c.toText, updatedAt: new Date() })
            .where(eq(aiCorrectionsTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db.insert(aiCorrectionsTable).values(inserts);
      }
    }

    const corrections = await listAll();
    res.json({ corrections });
  } catch (err) {
    req.log.error({ err }, "failed to save ai corrections");
    res.status(500).json({ error: "Failed to save ai corrections" });
  }
});

export default router;
