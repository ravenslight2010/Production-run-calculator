import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedCheeseSheetsTable, type SavedCheeseSheetRow } from "@workspace/db";
import { SaveCheeseSheetBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();
const MAX_SAVED = 2;
const MAX_LABEL_LEN = 200;
const MAX_SOURCE_KEY_LEN = 300;

type ApiCheeseSheet = {
  id: number;
  label: string;
  sourceKey: string | null;
  createdAt: number;
  data: unknown;
};

function toApi(row: SavedCheeseSheetRow): ApiCheeseSheet {
  return {
    id: row.id,
    label: row.label,
    sourceKey: row.sourceKey ?? null,
    createdAt: row.createdAt.getTime(),
    data: row.data,
  };
}

async function listAll(): Promise<ApiCheeseSheet[]> {
  const rows = await db
    .select()
    .from(savedCheeseSheetsTable)
    .where(eq(savedCheeseSheetsTable.scope, currentScope()))
    .orderBy(desc(savedCheeseSheetsTable.createdAt), desc(savedCheeseSheetsTable.id));
  return rows.map(toApi);
}

router.get("/cheese-sheets", async (req: Request, res: Response) => {
  try {
    res.json({ cheeseSheets: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to list saved cheese sheets");
    res.status(500).json({ error: "Failed to list saved cheese sheets" });
  }
});

router.post("/cheese-sheets", requireCapability("manage-inventory"), async (req: Request, res: Response) => {
  const parsed = SaveCheeseSheetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const label = (parsed.data.label ?? "").trim().slice(0, MAX_LABEL_LEN) || "Cheese recipe sheet";
  const sourceKey = (parsed.data.sourceKey ?? "").trim().slice(0, MAX_SOURCE_KEY_LEN) || null;

  try {
    const inserted = await db.insert(savedCheeseSheetsTable).values({
      scope: currentScope(),
      label,
      sourceKey,
      data: parsed.data.data,
    }).returning({ id: savedCheeseSheetsTable.id });
    const snapshotId = inserted[0]?.id;
    if (snapshotId == null) throw new Error("Cheese snapshot was not inserted");

    const rows = await db
      .select({ id: savedCheeseSheetsTable.id, sourceKey: savedCheeseSheetsTable.sourceKey })
      .from(savedCheeseSheetsTable)
      .where(eq(savedCheeseSheetsTable.scope, currentScope()))
      .orderBy(desc(savedCheeseSheetsTable.createdAt), desc(savedCheeseSheetsTable.id));
    const perKeyCount = new Map<string, number>();
    for (const row of rows) {
      const key = row.sourceKey ?? "";
      const count = (perKeyCount.get(key) ?? 0) + 1;
      perKeyCount.set(key, count);
      if (count > MAX_SAVED) {
        await db.delete(savedCheeseSheetsTable).where(and(
          eq(savedCheeseSheetsTable.scope, currentScope()),
          eq(savedCheeseSheetsTable.id, row.id),
        ));
      }
    }
    res.json({ snapshotId, cheeseSheets: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to save cheese sheet");
    res.status(500).json({ error: "Failed to save cheese sheet" });
  }
});

router.delete("/cheese-sheets/:id", requireCapability("manage-inventory"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(savedCheeseSheetsTable).where(and(
      eq(savedCheeseSheetsTable.scope, currentScope()),
      eq(savedCheeseSheetsTable.id, id),
    ));
    res.json({ cheeseSheets: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to delete cheese sheet");
    res.status(500).json({ error: "Failed to delete cheese sheet" });
  }
});

export default router;