import { Router, type IRouter, type Request, type Response } from "express";
import { db, dailySyncTable } from "@workspace/db";
import { eq, gt, asc } from "drizzle-orm";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string };
const clients = new Set<SseClient>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function broadcast(data: unknown, senderId: string): void {
  const msg = `data: ${JSON.stringify({ data, senderId })}\n\n`;
  for (const client of clients) {
    if (client.clientId !== senderId) {
      try { client.res.write(msg); } catch {}
    }
  }
}

router.get("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const [row] = await db.select().from(dailySyncTable).where(eq(dailySyncTable.date, todayStr()));
  res.json(row?.data ?? null);
});

router.put("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const today = todayStr();
  await db
    .insert(dailySyncTable)
    .values({ date: today, data: payload as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dailySyncTable.date,
      set: { data: payload as any, updatedAt: new Date() },
    });
  broadcast(payload, senderId);
  res.json({ ok: true });
});

router.get("/sync/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const [row] = await db.select().from(dailySyncTable).where(eq(dailySyncTable.date, todayStr()));
  if (row) {
    res.write(`data: ${JSON.stringify({ data: row.data, senderId: null })}\n\n`);
  }

  const client: SseClient = { res, clientId };
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
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(gt(dailySyncTable.date, todayStr()))
    .orderBy(asc(dailySyncTable.date));
  res.json(
    rows.map(r => ({
      date: r.date,
      runCount: ((r.data as any)?.dayState?.runs?.length ?? 0),
    }))
  );
});

router.get("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const [row] = await db.select().from(dailySyncTable).where(eq(dailySyncTable.date, date));
  res.json(row?.data ?? null);
});

router.put("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  await db
    .insert(dailySyncTable)
    .values({ date, data: payload as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dailySyncTable.date,
      set: { data: payload as any, updatedAt: new Date() },
    });
  // Broadcast to live SSE clients when writing today's date (supports same-day watchers)
  if (date === todayStr()) {
    broadcast(payload, senderId);
  }
  res.json({ ok: true });
});

router.delete("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  if (date <= todayStr()) { res.status(400).json({ error: "Cannot delete today or past days" }); return; }
  await db.delete(dailySyncTable).where(eq(dailySyncTable.date, date));
  res.json({ ok: true });
});

export default router;
