import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
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
const MAX_REVISION = Number.MAX_SAFE_INTEGER;

type ApiTemplate = {
  id: string;
  name: string;
  values: Record<string, unknown>;
  brand?: string;
  flavor?: string;
  createdAt: string;
  revision: number;
  deleted: boolean;
};

type IncomingTemplate = Omit<ApiTemplate, "revision"> & { revision?: number };

function toApiTemplate(row: RunTemplateRow): ApiTemplate {
  const out: ApiTemplate = {
    id: row.id,
    name: row.name,
    values: (row.values ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    revision: row.revision ?? 0,
    deleted: row.deleted ?? false,
  };
  if (row.brand != null) out.brand = row.brand;
  if (row.flavor != null) out.flavor = row.flavor;
  return out;
}

// Validate + canonicalize a single incoming template. Drops anything malformed
// (no usable id or a non-object `values`) so a bad client can't corrupt the
// shared list. Returns null to signal "skip this one".
function normalizeTemplate(raw: unknown): IncomingTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!id) return null;
  const revision = r.revision;
  if (revision !== undefined && (
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0
  )) return null;
  if (!r.values || typeof r.values !== "object" || Array.isArray(r.values)) return null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Template";
  const createdAt =
    typeof r.createdAt === "string" && r.createdAt.trim()
      ? r.createdAt.trim()
      : new Date().toISOString();
  const out: IncomingTemplate = {
    id,
    name,
    values: r.values as Record<string, unknown>,
    createdAt,
    revision,
    deleted: r.deleted === true,
  };
  if (typeof r.brand === "string" && r.brand.trim()) out.brand = r.brand.trim();
  if (typeof r.flavor === "string" && r.flavor.trim()) out.flavor = r.flavor.trim();
  return out;
}

async function applyTemplate(scope: string, tpl: ApiTemplate): Promise<void> {
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
      revision: tpl.revision,
      deleted: tpl.deleted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [runTemplatesTable.id, runTemplatesTable.scope],
      set: {
        name: tpl.name,
        values: tpl.values,
        brand: tpl.brand ?? null,
        flavor: tpl.flavor ?? null,
        revision: tpl.revision,
        deleted: tpl.deleted,
        updatedAt: new Date(),
      },
      // This predicate is part of the single INSERT ... ON CONFLICT statement,
      // so concurrent writes cannot let a lower revision overwrite a higher one.
      where: sql`${runTemplatesTable.revision} < ${tpl.revision}`,
    });
}

async function applyLegacyTemplate(scope: string, tpl: IncomingTemplate): Promise<boolean> {
  const rows = await db
    .insert(runTemplatesTable)
    .values({
      id: tpl.id,
      scope,
      name: tpl.name,
      values: tpl.values,
      brand: tpl.brand ?? null,
      flavor: tpl.flavor ?? null,
      createdAt: tpl.createdAt,
      revision: 1,
      deleted: tpl.deleted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [runTemplatesTable.id, runTemplatesTable.scope],
      set: {
        name: tpl.name,
        values: tpl.values,
        brand: tpl.brand ?? null,
        flavor: tpl.flavor ?? null,
        // This expression is evaluated while PostgreSQL holds the conflict-row
        // lock, so concurrent legacy mutations each receive a newer revision.
        revision: sql<number>`${runTemplatesTable.revision} + 1`,
        deleted: tpl.deleted,
        updatedAt: new Date(),
      },
      where: sql`${runTemplatesTable.revision} < ${MAX_REVISION}`,
    })
    .returning({ revision: runTemplatesTable.revision });
  return rows.length > 0;
}

async function applyTombstone(scope: string, id: string, revision: number): Promise<void> {
  await db
    .insert(runTemplatesTable)
    .values({
      id,
      scope,
      // A never-seen deletion still needs a complete response envelope.
      name: "Deleted template",
      values: {},
      createdAt: new Date().toISOString(),
      revision,
      deleted: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [runTemplatesTable.id, runTemplatesTable.scope],
      // Keep the existing envelope when tombstoning a known template.
      set: {
        revision,
        deleted: true,
        updatedAt: new Date(),
      },
      where: sql`${runTemplatesTable.revision} < ${revision}`,
    });
}

async function applyLegacyTombstone(scope: string, id: string): Promise<boolean> {
  const rows = await db
    .insert(runTemplatesTable)
    .values({
      id,
      scope,
      name: "Deleted template",
      values: {},
      createdAt: new Date().toISOString(),
      revision: 1,
      deleted: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [runTemplatesTable.id, runTemplatesTable.scope],
      set: {
        // Preserve the known template's envelope, but never physically delete it.
        revision: sql<number>`${runTemplatesTable.revision} + 1`,
        deleted: true,
        updatedAt: new Date(),
      },
      where: sql`${runTemplatesTable.revision} < ${MAX_REVISION}`,
    })
    .returning({ revision: runTemplatesTable.revision });
  return rows.length > 0;
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

  // Normalize + drop malformed templates, then keep the highest revision per id.
  // A legacy mutation wins for its id because it intentionally requests a fresh,
  // server-assigned revision rather than participating in client revision ordering.
  const byId = new Map<string, IncomingTemplate>();
  for (const raw of parsed.data.templates.slice(0, MAX_BATCH)) {
    const tpl = normalizeTemplate(raw);
    const existing = tpl && byId.get(tpl.id);
    if (tpl && (!existing || tpl.revision === undefined || (
      existing.revision !== undefined && tpl.revision > existing.revision
    ))) {
      byId.set(tpl.id, tpl);
    }
  }

  try {
    const scope = currentScope();
    for (const tpl of byId.values()) {
      if (tpl.revision === undefined) {
        if (!await applyLegacyTemplate(scope, tpl)) {
          res.status(409).json({ error: "Template revision limit reached; refresh and retry with a revisioned client" });
          return;
        }
      } else {
        await applyTemplate(scope, tpl as ApiTemplate);
      }
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

  const byId = new Map<string, { id: string; revision?: number }>();
  for (const item of (parsed.data.items ?? []).slice(0, MAX_BATCH)) {
    const id = item.id.trim();
    if (id && (!byId.has(id) || item.revision > byId.get(id)!.revision!)) {
      byId.set(id, { id, revision: item.revision });
    }
  }
  for (const rawId of (parsed.data.ids ?? []).slice(0, MAX_BATCH)) {
    const id = rawId.trim();
    // Legacy ids intentionally supersede a revisioned item for the same id.
    if (id) byId.set(id, { id });
  }

  try {
    const scope = currentScope();
    for (const item of byId.values()) {
      if (item.revision === undefined) {
        if (!await applyLegacyTombstone(scope, item.id)) {
          res.status(409).json({ error: "Template revision limit reached; refresh and retry with a revisioned client" });
          return;
        }
      } else {
        await applyTombstone(scope, item.id, item.revision);
      }
    }
    const templates = await listAll();
    res.json({ templates });
  } catch (err) {
    req.log.error({ err }, "failed to delete run templates");
    res.status(500).json({ error: "Failed to delete run templates" });
  }
});

export default router;
