import { Router, type IRouter, type Request, type Response } from "express";
import { db, factoryKvTable } from "@workspace/db";
import { requireCapability } from "../middlewares/requireCapability";

// Factory-wide key-value store. Any authenticated user can read all keys (GET),
// while only managers may write (PUT). The value shape is opaque — each
// consumer is responsible for validating what it reads/writes.
//
// GET /factory-data  — returns { data: { [key]: { value, updatedAt } } }
// PUT /factory-data  — accepts { key, value }, upserts the row, returns { updatedAt }

const router: IRouter = Router();

router.get("/factory-data", async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(factoryKvTable);
    const data: Record<string, { value: unknown; updatedAt: string }> = {};
    for (const row of rows) {
      data[row.key] = { value: row.value, updatedAt: row.updatedAt.toISOString() };
    }
    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "failed to list factory-data");
    res.status(500).json({ error: "Failed to list factory data" });
  }
});

router.put(
  "/factory-data",
  requireCapability("manage-factory-settings"),
  async (req: Request, res: Response) => {
    const { key, value } = req.body ?? {};
    if (typeof key !== "string" || key.trim().length === 0) {
      res.status(400).json({ error: "key must be a non-empty string" });
      return;
    }
    if (value === undefined) {
      res.status(400).json({ error: "value is required" });
      return;
    }
    const updatedAt = new Date();
    try {
      await db
        .insert(factoryKvTable)
        .values({ key: key.trim(), value, updatedAt })
        .onConflictDoUpdate({
          target: factoryKvTable.key,
          set: { value, updatedAt },
        });
      res.json({ updatedAt: updatedAt.toISOString() });
    } catch (err) {
      req.log.error({ err }, "failed to upsert factory-data key");
      res.status(500).json({ error: "Failed to save factory data" });
    }
  },
);

export default router;
