import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedPremixSheetsTable, type SavedPremixSheetRow } from "@workspace/db";
import { SavePremixSheetBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Saved premix sheets: snapshots of imported premix workbooks (the Mix[] they
// declared) so the current mixes can later be reconciled against them (see
// /ai/mix-reconcile). Shared factory-wide across all signed-in users (the
// router-level requireAuth gates them) and scope-isolated like the learned
// spec-import aliases. Only the two most recent snapshots are kept; older ones
// are pruned on save. Mirrors savedSpecSheets.ts exactly.
const MAX_SAVED = 2;
const MAX_LABEL_LEN = 200;

const MAX_SOURCE_KEY_LEN = 300;

type ApiPremixSheet = {
  id: number;
  label: string;
  sourceKey: string | null;
  createdAt: number;
  data: unknown;
};

function toApi(row: SavedPremixSheetRow): ApiPremixSheet {
  return {
    id: row.id,
    label: row.label,
    sourceKey: row.sourceKey ?? null,
    createdAt: row.createdAt.getTime(),
    data: row.data,
  };
}

async function listAll(): Promise<ApiPremixSheet[]> {
  const rows = await db
    .select()
    .from(savedPremixSheetsTable)
    .where(eq(savedPremixSheetsTable.scope, currentScope()))
    .orderBy(desc(savedPremixSheetsTable.createdAt), desc(savedPremixSheetsTable.id));
  return rows.map(toApi);
}

router.get("/premix-sheets", async (req: Request, res: Response) => {
  try {
    const premixSheets = await listAll();
    res.json({ premixSheets });
  } catch (err) {
    req.log.error({ err }, "failed to list saved premix sheets");
    res.status(500).json({ error: "Failed to list saved premix sheets" });
  }
});

router.post("/premix-sheets", async (req: Request, res: Response) => {
  const parsed = SavePremixSheetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const label = (parsed.data.label ?? "").trim().slice(0, MAX_LABEL_LEN) || "Premix sheet";
  const sourceKey = (parsed.data.sourceKey ?? "").trim().slice(0, MAX_SOURCE_KEY_LEN) || null;

  try {
    await db.insert(savedPremixSheetsTable).values({
      scope: currentScope(),
      label,
      sourceKey,
      data: parsed.data.data,
    });

    // Keep only the two most recent snapshots PER distinct file (sourceKey), not
    // two overall — the factory has many distinct premix workbooks and wants the
    // last two versions of each. Rows without a sourceKey (older/mobile clients)
    // share a single legacy bucket. Newest first, delete past the per-key cap.
    const rows = await db
      .select({ id: savedPremixSheetsTable.id, sourceKey: savedPremixSheetsTable.sourceKey })
      .from(savedPremixSheetsTable)
      .where(eq(savedPremixSheetsTable.scope, currentScope()))
      .orderBy(desc(savedPremixSheetsTable.createdAt), desc(savedPremixSheetsTable.id));
    const perKeyCount = new Map<string, number>();
    const stale: number[] = [];
    for (const r of rows) {
      const key = r.sourceKey ?? "";
      const n = (perKeyCount.get(key) ?? 0) + 1;
      perKeyCount.set(key, n);
      if (n > MAX_SAVED) stale.push(r.id);
    }
    for (const id of stale) {
      await db
        .delete(savedPremixSheetsTable)
        .where(
          and(eq(savedPremixSheetsTable.scope, currentScope()), eq(savedPremixSheetsTable.id, id)),
        );
    }

    const premixSheets = await listAll();
    res.json({ premixSheets });
  } catch (err) {
    req.log.error({ err }, "failed to save premix sheet");
    res.status(500).json({ error: "Failed to save premix sheet" });
  }
});

router.delete("/premix-sheets/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db
      .delete(savedPremixSheetsTable)
      .where(
        and(eq(savedPremixSheetsTable.scope, currentScope()), eq(savedPremixSheetsTable.id, id)),
      );
    const premixSheets = await listAll();
    res.json({ premixSheets });
  } catch (err) {
    req.log.error({ err }, "failed to delete premix sheet");
    res.status(500).json({ error: "Failed to delete premix sheet" });
  }
});

export default router;
