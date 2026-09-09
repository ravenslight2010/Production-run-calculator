import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, mixesTable, type MixRow } from "@workspace/db";
import { SaveMixesBody, DeleteMixesBody } from "@workspace/api-zod";
import { normalizeMix, type Mix } from "@workspace/mixes";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import { invalidateMasterDataBootstrapCache } from "./masterDataBootstrap";
import { broadcastMasterDataChanged } from "./sync";

// Manager-defined, factory-wide mixes (pre-blended recipes made ahead for a
// product). Reading is open to any signed-in user (both apps build the mix
// make-day plan from them), while creating, updating, and deleting are
// manager-only — matching the production-rules / freezer-pull precedent (open
// GET, manager-gated writes). Mixes are normalized + validated with the shared
// @workspace/mixes model so the server is the source of truth for what a
// well-formed mix is. Gated on "manage-inventory" since this is warehouse/
// inventory master-data, not a separate capability.

const MAX_BATCH = 500;

class RecipeRevisionConflict extends Error {
  constructor(readonly rejectedIds: string[]) {
    super("Mix snapshot is stale");
  }
}

function comparable(item: Mix): string {
  return JSON.stringify({
    id: item.id,
    name: item.name,
    brand: item.brand,
    flavor: item.flavor,
    batchSize: item.batchSize,
    daysEarly: item.daysEarly,
    notes: item.notes,
    amountAlreadyMade: item.amountAlreadyMade,
    components: item.components,
    isPrep: item.isPrep,
    enabled: item.enabled,
  });
}

function toApiItem(row: MixRow): Mix {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    brand: row.brand,
    flavor: row.flavor,
    batchSize: row.batchSize,
    daysEarly: row.daysEarly,
    notes: row.notes,
    amountAlreadyMade: row.amountAlreadyMade,
    components: row.components ?? [],
    isPrep: row.isPrep ?? false,
    enabled: row.enabled,
  };
}

function toDbValues(item: Mix) {
  return {
    id: item.id,
    scope: currentScope(),
    name: item.name,
    brand: item.brand,
    flavor: item.flavor,
    batchSize: item.batchSize,
    daysEarly: item.daysEarly,
    notes: item.notes ?? "",
    amountAlreadyMade: item.amountAlreadyMade,
    components: item.components,
    isPrep: item.isPrep ?? false,
    enabled: item.enabled,
    updatedAt: new Date(),
  };
}

function nextRevision(previous?: Date): Date {
  return new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1));
}

async function listAll(): Promise<Mix[]> {
  const rows = await db
    .select()
    .from(mixesTable)
    .where(eq(mixesTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/mixes", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list mixes");
    res.status(500).json({ error: "Failed to list mixes" });
  }
});

router.post(
  "/mixes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = SaveMixesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed mixes, then dedupe by id (last write wins) so a
    // single request can't fight itself with two values for the same id.
    const byId = new Map<string, Mix>();
    for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
      const mix = normalizeMix(raw);
      if (mix) byId.set(mix.id, mix);
    }

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"mixes:" + currentScope()}))`,
        );
        const existingRows = await tx
          .select()
          .from(mixesTable)
          .where(eq(mixesTable.scope, currentScope()))
          .for("update");
        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        const rejectedIds: string[] = [];
        for (const [id, mix] of byId) {
          const existing = existingById.get(id);
          if (!existing) continue;
          const incomingRevision = mix.updatedAt ? new Date(mix.updatedAt) : null;
          const storedRevision = existing.updatedAt.getTime();
          if (
            !incomingRevision ||
            !Number.isFinite(incomingRevision.getTime()) ||
            incomingRevision.getTime() < storedRevision
          ) {
            rejectedIds.push(id);
          }
        }
        if (rejectedIds.length > 0) throw new RecipeRevisionConflict(rejectedIds);

        for (const mix of byId.values()) {
          const existing = existingById.get(mix.id);
          const values = toDbValues(mix);
          values.updatedAt = nextRevision(existing?.updatedAt);
          if (!existing) {
            await tx.insert(mixesTable).values(values);
            continue;
          }
          if (
            mix.updatedAt &&
            new Date(mix.updatedAt).getTime() === existing.updatedAt.getTime() &&
            comparable(mix) === comparable(toApiItem(existing))
          ) {
            continue;
          }
          await tx
            .update(mixesTable)
            .set({
              name: values.name,
              brand: values.brand,
              flavor: values.flavor,
              batchSize: values.batchSize,
              daysEarly: values.daysEarly,
              notes: values.notes,
              amountAlreadyMade: values.amountAlreadyMade,
              components: values.components,
              isPrep: values.isPrep,
              enabled: values.enabled,
              updatedAt: values.updatedAt,
            })
            .where(
              and(
                eq(mixesTable.id, mix.id),
                eq(mixesTable.scope, currentScope()),
              ),
            );
        }
      });
      invalidateMasterDataBootstrapCache();
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      if (err instanceof RecipeRevisionConflict) {
        res.status(409).json({
          error: "STALE_MIX_SNAPSHOT",
          rejectedIds: err.rejectedIds,
          items: await listAll(),
        });
        return;
      }
      req.log.error({ err }, "failed to save mixes");
      res.status(500).json({ error: "Failed to save mixes" });
    }
  },
);

router.delete(
  "/mixes",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response) => {
    const parsed = DeleteMixesBody.safeParse(req.body);
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
          .delete(mixesTable)
          .where(
            and(
              inArray(mixesTable.id, ids),
              eq(mixesTable.scope, currentScope()),
            ),
          );
      }
      invalidateMasterDataBootstrapCache();
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
      const items = await listAll();
      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "failed to delete mixes");
      res.status(500).json({ error: "Failed to delete mixes" });
    }
  },
);

export default router;
