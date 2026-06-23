import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, freezerPullItemsTable, type FreezerPullItemRow } from "@workspace/db";
import { SaveFreezerPullItemsBody, DeleteFreezerPullItemsBody } from "@workspace/api-zod";
import {
  normalizeFreezerPullItem,
  type FreezerPullItem,
} from "@workspace/freezer-pull";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Manager-defined, factory-wide freezer-pull items. Reading is open to any
// signed-in user (both apps build the warehouse pull notices from them), while
// creating, updating, and deleting are manager-only — matching the
// production-rules / inventory-settings precedent (open GET, manager-gated
// writes). Items are normalized + validated with the shared
// @workspace/freezer-pull model so the server is the source of truth for what a
// well-formed item is. Gated on "manage-inventory" since this is warehouse/
// inventory master-data, not a separate capability.

const MAX_BATCH = 500;

function toApiItem(row: FreezerPullItemRow): FreezerPullItem {
  return {
    id: row.id,
    ingredient: row.ingredient,
    daysEarly: row.daysEarly,
    enabled: row.enabled,
  };
}

function toDbValues(item: FreezerPullItem) {
  return {
    id: item.id,
    scope: currentScope(),
    ingredient: item.ingredient,
    daysEarly: item.daysEarly,
    enabled: item.enabled,
    updatedAt: new Date(),
  };
}

async function listAll(): Promise<FreezerPullItem[]> {
  const rows = await db
    .select()
    .from(freezerPullItemsTable)
    .where(eq(freezerPullItemsTable.scope, currentScope()));
  return rows.map(toApiItem);
}

router.get("/freezer-pull-items", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list freezer-pull items");
    res.status(500).json({ error: "Failed to list freezer-pull items" });
  }
});

router.post(
  "/freezer-pull-items",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveFreezerPullItemsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed items, then dedupe by id (last write wins) so a
    // single request can't fight itself with two values for the same id.
    const byId = new Map<string, FreezerPullItem>();
    for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
      const item = normalizeFreezerPullItem(raw);
      if (item) byId.set(item.id, item);
    }

    try {
      for (const item of byId.values()) {
        const values = toDbValues(item);
        await db
          .insert(freezerPullItemsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [freezerPullItemsTable.id, freezerPullItemsTable.scope],
            set: {
              ingredient: values.ingredient,
              daysEarly: values.daysEarly,
              enabled: values.enabled,
              updatedAt: values.updatedAt,
            },
          });
      }
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to save freezer-pull items");
      res.status(500).json({ error: "Failed to save freezer-pull items" });
    }
  },
);

router.delete(
  "/freezer-pull-items",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteFreezerPullItemsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const ids = parsed.data.ids
      .slice(0, MAX_BATCH)
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);

    try {
      if (ids.length > 0) {
        await db
          .delete(freezerPullItemsTable)
          .where(
            and(
              inArray(freezerPullItemsTable.id, ids),
              eq(freezerPullItemsTable.scope, currentScope()),
            ),
          );
      }
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete freezer-pull items");
      res.status(500).json({ error: "Failed to delete freezer-pull items" });
    }
  },
);

export default router;
