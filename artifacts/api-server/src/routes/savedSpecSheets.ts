import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedSpecSheetsTable, type SavedSpecSheetRow } from "@workspace/db";
import { SaveSpecSheetBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Saved spec sheets: snapshots of imported spec sheets so they can later be
// cross-referenced against the current recipe library (see /ai/spec-reconcile).
// Shared factory-wide across all signed-in users (the router-level requireAuth
// gates them) and scope-isolated like the learned spec-import aliases. Only the
// two most recent snapshots are kept; older ones are pruned on save.
const MAX_SAVED = 2;
const MAX_LABEL_LEN = 200;

type ApiSpecSheet = {
  id: number;
  label: string;
  createdAt: number;
  data: unknown;
};

function toApi(row: SavedSpecSheetRow): ApiSpecSheet {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.getTime(),
    data: row.data,
  };
}

async function listAll(): Promise<ApiSpecSheet[]> {
  const rows = await db
    .select()
    .from(savedSpecSheetsTable)
    .where(eq(savedSpecSheetsTable.scope, currentScope()))
    .orderBy(desc(savedSpecSheetsTable.createdAt), desc(savedSpecSheetsTable.id));
  return rows.map(toApi);
}

router.get("/spec-sheets", async (req: Request, res: Response) => {
  try {
    const specSheets = await listAll();
    res.json({ specSheets });
  } catch (err) {
    req.log.error({ err }, "failed to list saved spec sheets");
    res.status(500).json({ error: "Failed to list saved spec sheets" });
  }
});

router.post("/spec-sheets", async (req: Request, res: Response) => {
  const parsed = SaveSpecSheetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const label = (parsed.data.label ?? "").trim().slice(0, MAX_LABEL_LEN) || "Spec sheet";

  try {
    await db.insert(savedSpecSheetsTable).values({
      scope: currentScope(),
      label,
      data: parsed.data.data,
    });

    // Keep only the two most recent snapshots in this scope. Re-read ids newest
    // first and delete everything past the cap.
    const rows = await db
      .select({ id: savedSpecSheetsTable.id })
      .from(savedSpecSheetsTable)
      .where(eq(savedSpecSheetsTable.scope, currentScope()))
      .orderBy(desc(savedSpecSheetsTable.createdAt), desc(savedSpecSheetsTable.id));
    const stale = rows.slice(MAX_SAVED).map((r) => r.id);
    for (const id of stale) {
      await db
        .delete(savedSpecSheetsTable)
        .where(
          and(eq(savedSpecSheetsTable.scope, currentScope()), eq(savedSpecSheetsTable.id, id)),
        );
    }

    const specSheets = await listAll();
    res.json({ specSheets });
  } catch (err) {
    req.log.error({ err }, "failed to save spec sheet");
    res.status(500).json({ error: "Failed to save spec sheet" });
  }
});

router.delete("/spec-sheets/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db
      .delete(savedSpecSheetsTable)
      .where(
        and(eq(savedSpecSheetsTable.scope, currentScope()), eq(savedSpecSheetsTable.id, id)),
      );
    const specSheets = await listAll();
    res.json({ specSheets });
  } catch (err) {
    req.log.error({ err }, "failed to delete spec sheet");
    res.status(500).json({ error: "Failed to delete spec sheet" });
  }
});

export default router;
