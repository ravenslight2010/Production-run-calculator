import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, factoryKvTable } from "@workspace/db";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

// Factory-wide key-value store. Only managers with the manage-factory-settings
// capability may read or write (GET and PUT are both gated). The value shape is
// opaque — each consumer is responsible for validating what it reads/writes.
// Rows are scope-isolated: live and sandbox data never intermingle.
//
// GET /factory-data  — returns { data: { [key]: { value, updatedAt } } }
// PUT /factory-data  — accepts { key, value }, upserts the row, returns { updatedAt }

const router: IRouter = Router();

router.get(
  "/factory-data",
  requireCapability("manage-factory-settings"),
  async (req: Request, res: Response) => {
    const scope = currentScope();
    try {
      const rows = await db
        .select()
        .from(factoryKvTable)
        .where(eq(factoryKvTable.scope, scope));
      const data: Record<string, { value: unknown; updatedAt: string }> = {};
      for (const row of rows) {
        data[row.key] = { value: row.value, updatedAt: row.updatedAt.toISOString() };
      }
      res.json({ data });
    } catch (err) {
      req.log.error({ err }, "failed to list factory-data");
      res.status(500).json({ error: "Failed to list factory data" });
    }
  },
);

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
    const scope = currentScope();
    const updatedAt = new Date();
    try {
      await db
        .insert(factoryKvTable)
        .values({ scope, key: key.trim(), value, updatedAt })
        .onConflictDoUpdate({
          target: [factoryKvTable.scope, factoryKvTable.key],
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
