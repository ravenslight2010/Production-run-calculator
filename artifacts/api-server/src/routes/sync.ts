import { Router, type IRouter, type Request, type Response } from "express";
import { db, dailySyncTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string };
const clients = new Set<SseClient>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

export default router;
