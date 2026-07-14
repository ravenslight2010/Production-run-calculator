import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, savedShippingGuidesTable, type SavedShippingGuideRow } from "@workspace/db";
import { SaveShippingGuideBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Saved shipping & palletizing guides: snapshots of imported guides (the
// reviewed brand+flavor packaging rows) so they can later be reached back into
// by the Setup Profiles auto-fill panel and cross-referenced against the spec
// sheet. Shared factory-wide across all signed-in users (router-level
// requireAuth gates them) and scope-isolated like saved spec sheets. Only the
// two most recent snapshots PER distinct file are kept; older ones are pruned.
const MAX_SAVED = 2;
const MAX_LABEL_LEN = 200;
const MAX_SOURCE_KEY_LEN = 300;

// Content fingerprint format: SHA-256 hex (64 chars). Anything else is stored
// as null — reuse eligibility must never key off a malformed client value.
const SOURCE_HASH_RE = /^[0-9a-f]{64}$/;

type ApiShippingGuide = {
  id: number;
  label: string;
  sourceKey: string | null;
  sourceHash: string | null;
  createdAt: number;
  data: unknown;
};

function toApi(row: SavedShippingGuideRow): ApiShippingGuide {
  return {
    id: row.id,
    label: row.label,
    sourceKey: row.sourceKey ?? null,
    sourceHash: row.sourceHash ?? null,
    createdAt: row.createdAt.getTime(),
    data: row.data,
  };
}

async function listAll(): Promise<ApiShippingGuide[]> {
  const rows = await db
    .select()
    .from(savedShippingGuidesTable)
    .where(eq(savedShippingGuidesTable.scope, currentScope()))
    .orderBy(desc(savedShippingGuidesTable.createdAt), desc(savedShippingGuidesTable.id));
  return rows.map(toApi);
}

router.get("/shipping-guides", async (req: Request, res: Response) => {
  try {
    const shippingGuides = await listAll();
    res.json({ shippingGuides });
  } catch (err) {
    req.log.error({ err }, "failed to list saved shipping guides");
    res.status(500).json({ error: "Failed to list saved shipping guides" });
  }
});

router.post("/shipping-guides", async (req: Request, res: Response) => {
  const parsed = SaveShippingGuideBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const label = (parsed.data.label ?? "").trim().slice(0, MAX_LABEL_LEN) || "Palletizing guide";
  const sourceKey = (parsed.data.sourceKey ?? "").trim().slice(0, MAX_SOURCE_KEY_LEN) || null;
  const rawHash = (parsed.data.sourceHash ?? "").trim().toLowerCase();
  const sourceHash = SOURCE_HASH_RE.test(rawHash) ? rawHash : null;

  try {
    await db.insert(savedShippingGuidesTable).values({
      scope: currentScope(),
      label,
      sourceKey,
      sourceHash,
      data: parsed.data.data,
    });

    // Keep only the two most recent snapshots PER distinct file (sourceKey).
    // Rows without a sourceKey share a single legacy bucket. Re-read newest
    // first and delete past the per-key cap.
    const rows = await db
      .select({ id: savedShippingGuidesTable.id, sourceKey: savedShippingGuidesTable.sourceKey })
      .from(savedShippingGuidesTable)
      .where(eq(savedShippingGuidesTable.scope, currentScope()))
      .orderBy(desc(savedShippingGuidesTable.createdAt), desc(savedShippingGuidesTable.id));
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
        .delete(savedShippingGuidesTable)
        .where(
          and(eq(savedShippingGuidesTable.scope, currentScope()), eq(savedShippingGuidesTable.id, id)),
        );
    }

    const shippingGuides = await listAll();
    res.json({ shippingGuides });
  } catch (err) {
    req.log.error({ err }, "failed to save shipping guide");
    res.status(500).json({ error: "Failed to save shipping guide" });
  }
});

router.delete("/shipping-guides/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db
      .delete(savedShippingGuidesTable)
      .where(
        and(eq(savedShippingGuidesTable.scope, currentScope()), eq(savedShippingGuidesTable.id, id)),
      );
    const shippingGuides = await listAll();
    res.json({ shippingGuides });
  } catch (err) {
    req.log.error({ err }, "failed to delete shipping guide");
    res.status(500).json({ error: "Failed to delete shipping guide" });
  }
});

export default router;
