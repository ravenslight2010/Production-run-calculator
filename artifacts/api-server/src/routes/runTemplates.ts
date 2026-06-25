import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, runTemplatesTable, type RunTemplateRow } from "@workspace/db";
import { SaveRunTemplatesBody, DeleteRunTemplatesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Facility-wide saved run templates. Unlike freezer-pull items / production
// rules (manager-gated master-data), templates are a shared *convenience*, not a
// policy control, so reads and writes are open to any signed-in user — matching
// the previous local behavior where anyone could create one. They are global
// master-data (one set per scope), NOT part of the per-day sync payload. The
// `values` blob is the cross-platform run-config wire shape and is opaque to the
// server (stored as jsonb); the server only owns the envelope.

const MAX_BATCH = 200;

type ApiTemplate = {
  id: string;
  name: string;
  values: Record<string, unknown>;
  brand?: string;
  flavor?: string;
  createdAt: string;
};

function toApiTemplate(row: RunTemplateRow): ApiTemplate {
  const out: ApiTemplate = {
    id: row.id,
    name: row.name,
    values: (row.values ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
  if (row.brand != null) out.brand = row.brand;
  if (row.flavor != null) out.flavor = row.flavor;
  return out;
}

// Validate + canonicalize a single incoming template. Drops anything malformed
// (no usable id, or a non-object `values`) so a bad client can't corrupt the
// shared list. Returns null to signal "skip this one".
function normalizeTemplate(raw: unknown): ApiTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!id) return null;
  if (!r.values || typeof r.values !== "object" || Array.isArray(r.values)) return null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Template";
  const createdAt =
    typeof r.createdAt === "string" && r.createdAt.trim()
      ? r.createdAt.trim()
      : new Date().toISOString();
  const out: ApiTemplate = {
    id,
    name,
    values: r.values as Record<string, unknown>,
    createdAt,
  };
  if (typeof r.brand === "string" && r.brand.trim()) out.brand = r.brand.trim();
  if (typeof r.flavor === "string" && r.flavor.trim()) out.flavor = r.flavor.trim();
  return out;
}

async function listAll(): Promise<ApiTemplate[]> {
  const rows = await db
    .select()
    .from(runTemplatesTable)
    .where(eq(runTemplatesTable.scope, currentScope()));
  return rows.map(toApiTemplate);
}

router.get("/run-templates", async (req: Request, res: Response) => {
  try {
    const templates = await listAll();
    res.json({ templates });
  } catch (err) {
    req.log.error({ err }, "failed to list run templates");
    res.status(500).json({ error: "Failed to list run templates" });
  }
});

router.post("/run-templates", async (req: Request, res: Response) => {
  const parsed = SaveRunTemplatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize + drop malformed templates, then dedupe by id (last write wins).
  const byId = new Map<string, ApiTemplate>();
  for (const raw of parsed.data.templates.slice(0, MAX_BATCH)) {
    const tpl = normalizeTemplate(raw);
    if (tpl) byId.set(tpl.id, tpl);
  }

  try {
    const scope = currentScope();
    for (const tpl of byId.values()) {
      await db
        .insert(runTemplatesTable)
        .values({
          id: tpl.id,
          scope,
          name: tpl.name,
          values: tpl.values,
          brand: tpl.brand ?? null,
          flavor: tpl.flavor ?? null,
          createdAt: tpl.createdAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [runTemplatesTable.id, runTemplatesTable.scope],
          set: {
            name: tpl.name,
            values: tpl.values,
            brand: tpl.brand ?? null,
            flavor: tpl.flavor ?? null,
            updatedAt: new Date(),
          },
        });
    }
    const templates = await listAll();
    res.json({ templates });
  } catch (err) {
    req.log.error({ err }, "failed to save run templates");
    res.status(500).json({ error: "Failed to save run templates" });
  }
});

router.delete("/run-templates", async (req: Request, res: Response) => {
  const parsed = DeleteRunTemplatesBody.safeParse(req.body);
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
        .delete(runTemplatesTable)
        .where(
          and(
            inArray(runTemplatesTable.id, ids),
            eq(runTemplatesTable.scope, currentScope()),
          ),
        );
    }
    const templates = await listAll();
    res.json({ templates });
  } catch (err) {
    req.log.error({ err }, "failed to delete run templates");
    res.status(500).json({ error: "Failed to delete run templates" });
  }
});

export default router;
