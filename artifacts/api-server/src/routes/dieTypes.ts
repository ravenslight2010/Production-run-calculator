import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, dieTypesTable, type DieTypeRow } from "@workspace/db";
import { SaveDieTypesBody, DeleteDieTypesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Factory-wide die-type master list. Die types are shared master-data (NOT in
// the per-day sync payload) so they survive factory data resets, cleared
// browsers, and fresh devices. Reads AND writes are open to any signed-in user
// (matching the run-templates precedent): dies are added from the run-form
// picker and the self-heal by ordinary operators, so gating writes would break
// the existing flows. Deletion tombstones live client-side; the server simply
// stores the current list.

const MAX_BATCH = 500;

// Case-folded canonical id so upserts are idempotent across spellings while
// the display spelling (`name`) is preserved as first-written.
function dieTypeId(name: string): string {
  return name.trim().toLowerCase();
}

function cleanNames(names: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of names.slice(0, MAX_BATCH)) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t && t.length <= 200) out.push(t);
  }
  return out;
}

async function listAll(): Promise<string[]> {
  const rows: DieTypeRow[] = await db
    .select()
    .from(dieTypesTable)
    .where(eq(dieTypesTable.scope, currentScope()));
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
}

router.get("/die-types", async (req: Request, res: Response) => {
  try {
    res.json({ names: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to list die types");
    res.status(500).json({ error: "Failed to list die types" });
  }
});

router.post("/die-types", async (req: Request, res: Response) => {
  const parsed = SaveDieTypesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // Dedupe by canonical id (last write wins) so one request can't fight itself.
  const byId = new Map<string, string>();
  for (const name of cleanNames(parsed.data.names)) byId.set(dieTypeId(name), name);
  try {
    for (const [id, name] of byId) {
      await db
        .insert(dieTypesTable)
        .values({ id, scope: currentScope(), name, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [dieTypesTable.id, dieTypesTable.scope],
          set: { name, updatedAt: new Date() },
        });
    }
    res.json({ names: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to save die types");
    res.status(500).json({ error: "Failed to save die types" });
  }
});

router.post("/die-types/delete", async (req: Request, res: Response) => {
  const parsed = DeleteDieTypesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const ids = [...new Set(cleanNames(parsed.data.names).map(dieTypeId))];
  try {
    if (ids.length > 0) {
      await db
        .delete(dieTypesTable)
        .where(and(inArray(dieTypesTable.id, ids), eq(dieTypesTable.scope, currentScope())));
    }
    res.json({ names: await listAll() });
  } catch (err) {
    req.log.error({ err }, "failed to delete die types");
    res.status(500).json({ error: "Failed to delete die types" });
  }
});

export default router;
