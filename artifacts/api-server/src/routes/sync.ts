import { Router, type IRouter, type Request, type Response } from "express";
import { db, dailySyncTable } from "@workspace/db";
import { and, eq, gt, asc } from "drizzle-orm";
import { currentScope, type Scope } from "../lib/requestScope";
import { protectRunValues } from "../lib/protectRunValues";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string; scope: Scope; watchDate: string };
const clients = new Set<SseClient>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// "Today" for scheduling is the CLIENT's local date, not the server's. The app
// is driven by client-local midnight, but the server runs in UTC in production,
// so prefer the client-supplied `today` query param and fall back to the server
// date only when it's absent or malformed.
function clientToday(req: Request): string {
  const t = req.query.today;
  return typeof t === "string" && isValidDate(t) ? t : todayStr();
}

// Only ever push to clients watching the SAME data scope AND the SAME local date,
// so a sandbox writer's state never streams into a live watcher's UI, and a peer
// on a different local calendar day (behind/ahead of UTC) never receives another
// day's state into its live view — the cross-date clobber this fix prevents.
function broadcast(data: unknown, senderId: string, scope: Scope, date: string): void {
  const msg = `data: ${JSON.stringify({ data, senderId })}\n\n`;
  for (const client of clients) {
    if (client.scope === scope && client.watchDate === date && client.clientId !== senderId) {
      try { client.res.write(msg); } catch {}
    }
  }
}

// Postgres unique-violation is SQLSTATE 23505. Drizzle wraps driver errors, so
// the original pg error (carrying `.code`) is reachable via the `.cause` chain
// rather than the top-level error — walk it.
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Atomically upsert the day-state row with the protective merge applied (see
// protectRunValues). The read of the existing row and the write MUST happen
// inside one transaction with a row lock (SELECT ... FOR UPDATE), otherwise two
// concurrent PUTs could each merge against a stale snapshot and the later commit
// would overwrite a newer per-run stamp (or a fuller run list) with an older one
// — defeating the strictly-newer-wins guarantee and re-opening the data-loss
// window. Mirrors the FOR UPDATE pattern used by inventory drawdown.
//
// FIRST-WRITE RACE: when no row exists yet (first push of a date) FOR UPDATE
// locks nothing, so two concurrent first PUTs would each merge against "no
// existing" and the later writer would clobber the earlier one's runs. We close
// that window by doing a plain INSERT when no row exists: the losing writer hits
// a unique-violation (23505) and we retry — the row now exists, FOR UPDATE locks
// it, and we merge against it instead of overwriting. Returns the merged payload
// that was actually written so callers broadcast the same state peers will read.
async function upsertProtected(date: string, scope: Scope, payload: unknown): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
          .for("update");
        const merged = protectRunValues(payload, existing?.data);
        if (existing) {
          await tx
            .update(dailySyncTable)
            .set({ data: merged as any, updatedAt: new Date() })
            .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
        } else {
          await tx
            .insert(dailySyncTable)
            .values({ date, scope, data: merged as any, updatedAt: new Date() });
        }
        return merged;
      });
    } catch (e) {
      // A concurrent first writer created the row between our select and insert;
      // retry so we merge against it rather than failing or clobbering.
      if (isUniqueViolation(e) && attempt < 3) continue;
      throw e;
    }
  }
}

router.get("/sync/today", async (req: Request, res: Response): Promise<void> => {
  // "Today" is the CLIENT's local date (see clientToday). The server runs in UTC,
  // so a client behind UTC would otherwise read/write a different calendar row
  // than its scheduled days and rollover use — clobbering a scheduled "tomorrow".
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, clientToday(req)), eq(dailySyncTable.scope, currentScope())));
  res.json(row?.data ?? null);
});

router.put("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const today = clientToday(req);
  const scope = currentScope();
  try {
    const p = payload as { brands?: unknown } | null | undefined;
    const brands = p && Array.isArray(p.brands) ? p.brands : [];
    if (brands.length > 0) {
      req.log?.warn(
        { ua: req.get("user-agent"), senderId, brandCount: brands.length, brands },
        "PURGE-DIAG: client pushed brands",
      );
    }
  } catch {
    /* diagnostic only */
  }
  // Atomic read-merge-write so an incoming empty-with-real-stamp push can't wipe a
  // populated stored run value (see upsertProtected / protectRunValues).
  const merged = await upsertProtected(today, scope, payload);
  // Broadcast the merged result (not the raw push) so peers converge on the same
  // protected state the row was written with.
  broadcast(merged, senderId, scope, today);
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
    .where(and(eq(dailySyncTable.date, clientToday(req)), eq(dailySyncTable.scope, scope)));
  if (row) {
    res.write(`data: ${JSON.stringify({ data: row.data, senderId: null })}\n\n`);
  }

  // Record the client's local date so broadcasts only reach peers on the SAME
  // calendar day (see broadcast). Matches the initial-row lookup above.
  const client: SseClient = { res, clientId, scope, watchDate: clientToday(req) };
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
  // "Future" is relative to the CLIENT's local date (see clientToday): filtering
  // by the server's UTC date would make a user behind UTC lose their local
  // "tomorrow" a day early.
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(and(gt(dailySyncTable.date, clientToday(req)), eq(dailySyncTable.scope, currentScope())))
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
  // Atomic per-run protective merge (see /sync/today): an empty run value can't
  // clobber a populated stored one on scheduled days either.
  const merged = await upsertProtected(date, scope, payload);
  // Broadcast to live SSE clients when writing today's date (supports same-day
  // watchers). "Today" is the client's local date, matching /sync/today's keying.
  if (date === clientToday(req)) {
    broadcast(merged, senderId, scope, date);
  }
  res.json({ ok: true });
});

router.delete("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  if (date <= clientToday(req)) { res.status(400).json({ error: "Cannot delete today or past days" }); return; }
  await db
    .delete(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, currentScope())));
  res.json({ ok: true });
});

export default router;
