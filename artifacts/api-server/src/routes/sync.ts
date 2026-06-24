import { Router, type IRouter, type Request, type Response } from "express";
import { db, dailySyncTable } from "@workspace/db";
import { and, eq, gt, asc } from "drizzle-orm";
import { currentScope, type Scope } from "../lib/requestScope";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string; scope: Scope };
const clients = new Set<SseClient>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Only ever push to clients watching the SAME data scope, so a sandbox writer's
// state never streams into a live watcher's UI (or vice versa).
function broadcast(data: unknown, senderId: string, scope: Scope): void {
  const msg = `data: ${JSON.stringify({ data, senderId })}\n\n`;
  for (const client of clients) {
    if (client.scope === scope && client.clientId !== senderId) {
      try { client.res.write(msg); } catch {}
    }
  }
}

router.get("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, todayStr()), eq(dailySyncTable.scope, currentScope())));
  res.json(row?.data ?? null);
});

router.put("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const today = todayStr();
  const scope = currentScope();
  await db
    .insert(dailySyncTable)
    .values({ date: today, scope, data: payload as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dailySyncTable.date, dailySyncTable.scope],
      set: { data: payload as any, updatedAt: new Date() },
    });
  broadcast(payload, senderId, scope);
  res.json({ ok: true });
});

router.get("/sync/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";
  const scope = currentScope();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, todayStr()), eq(dailySyncTable.scope, scope)));
  if (row) {
    res.write(`data: ${JSON.stringify({ data: row.data, senderId: null })}\n\n`);
  }

  const client: SseClient = { res, clientId, scope };
  clients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch {}
  }, 15_000);

  req.on("close", () => {
    clients.delete(client);
    clearInterval(heartbeat);
  });
});

// ── Scheduled (future) days ──────────────────────────────────────────────────
// NOTE: /sync/scheduled must be declared before /sync/:date so Express doesn't
// treat "scheduled" as a date param.

router.get("/sync/scheduled", async (req: Request, res: Response): Promise<void> => {
  const includeRuns = req.query.include === "runs";
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(and(gt(dailySyncTable.date, todayStr()), eq(dailySyncTable.scope, currentScope())))
    .orderBy(asc(dailySyncTable.date));
  res.json(
    rows.map(r => {
      const data = r.data as any;
      const runs: Array<{ brand: string; flavor: string }> = data?.dayState?.runs ?? [];
      const runValues: Record<string, any> = data?.runValues ?? {};
      const base: Record<string, unknown> = {
        date: r.date,
        runCount: runs.length,
      };
      if (includeRuns) {
        base.runs = runs.map((run: any) => ({
          id: run.id ?? "",
          brand: run.brand ?? "",
          flavor: run.flavor ?? "",
          casesNeeded: runValues[run.id]?.casesNeeded ?? 0,
          dieType: runValues[run.id]?.dieType ?? "",
        }));
      }
      return base;
    })
  );
});

router.get("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, currentScope())));
  res.json(row?.data ?? null);
});

router.put("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const scope = currentScope();
  await db
    .insert(dailySyncTable)
    .values({ date, scope, data: payload as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dailySyncTable.date, dailySyncTable.scope],
      set: { data: payload as any, updatedAt: new Date() },
    });
  // Broadcast to live SSE clients when writing today's date (supports same-day watchers)
  if (date === todayStr()) {
    broadcast(payload, senderId, scope);
  }
  res.json({ ok: true });
});

router.delete("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  if (date <= todayStr()) { res.status(400).json({ error: "Cannot delete today or past days" }); return; }
  await db
    .delete(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, currentScope())));
  res.json({ ok: true });
});

export default router;
