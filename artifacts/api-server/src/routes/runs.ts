import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, productionRunsTable } from "@workspace/db";
import { CreateRunBody, DeleteRunParams, ListRunsResponse, ListRunsResponseItem } from "@workspace/api-zod";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

router.get("/runs", async (req, res): Promise<void> => {
  const scope = currentScope();
  const runs = await db
    .select()
    .from(productionRunsTable)
    .where(eq(productionRunsTable.scope, scope))
    .orderBy(desc(productionRunsTable.createdAt));
  res.json(ListRunsResponse.parse(runs));
});

router.post("/runs", requireCapability("manage-factory-settings"), async (req, res): Promise<void> => {
  const parsed = CreateRunBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid run body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const scope = currentScope();
  const [run] = await db.insert(productionRunsTable).values({ ...parsed.data, scope }).returning();
  res.status(201).json(ListRunsResponseItem.parse(run));
});

router.delete("/runs/:id", requireCapability("manage-factory-settings"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteRunParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const scope = currentScope();
  const [deleted] = await db
    .delete(productionRunsTable)
    .where(and(eq(productionRunsTable.id, params.data.id), eq(productionRunsTable.scope, scope)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
