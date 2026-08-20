import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, factoryKvTable } from "@workspace/db";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

// Factory-wide key-value store. Only managers with the manage-factory-settings
// capability may read or write (GET and PUT are both gated). The value shape is
// opaque — each consumer is responsible for validating what it reads/writes.
// Rows are scope-isolated: live and sandbox data never intermingle.
//
// GET /factory-data  — returns { data: { [key]: { value, updatedAt } } }
// PUT /factory-data  — accepts { key, value, updatedAt? }, guarded per-key
// client timestamps so a waking offline browser cannot overwrite a newer save.

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
    const { key, value, updatedAt: rawUpdatedAt } = req.body ?? {};
    if (typeof key !== "string" || key.trim().length === 0) {
      res.status(400).json({ error: "key must be a non-empty string" });
      return;
    }
    if (value === undefined) {
      res.status(400).json({ error: "value is required" });
      return;
    }
    const scope = currentScope();
    // Accept the client stamp for cross-device LWW but keep a small forward
    // skew bound so one accidentally future-dated device cannot freeze a key.
    const clientUpdatedAt =
      typeof rawUpdatedAt === "number" && Number.isFinite(rawUpdatedAt)
        ? Math.min(Math.floor(rawUpdatedAt), Date.now() + 5 * 60_000)
        : Date.now();
    const updatedAt = new Date(clientUpdatedAt);
    try {
      await db
        .insert(factoryKvTable)
        .values({ scope, key: key.trim(), value, updatedAt })
        .onConflictDoUpdate({
          target: [factoryKvTable.scope, factoryKvTable.key],
          set: { value, updatedAt },
          where: sql`${factoryKvTable.updatedAt} < ${updatedAt}`,
        });
      const [current] = await db
        .select()
        .from(factoryKvTable)
        .where(and(eq(factoryKvTable.scope, scope), eq(factoryKvTable.key, key.trim())));
      res.json({
        updatedAt: current?.updatedAt.toISOString() ?? updatedAt.toISOString(),
        value: current?.value ?? value,
      });
    } catch (err) {
      req.log.error({ err }, "failed to upsert factory-data key");
      res.status(500).json({ error: "Failed to save factory data" });
    }
  },
);

export default router;
