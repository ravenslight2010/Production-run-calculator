import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryConsumedRunsTable,
  type InventoryLot,
} from "@workspace/db";
import {
  CreateInventoryItemBody,
  UpdateInventoryItemBody,
  RestockInventoryBody,
  AdjustInventoryBody,
  ConsumeInventoryBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── SSE: any inventory change pings connected clients to refetch ──────────────
type SseClient = { res: Response; clientId: string };
const clients = new Set<SseClient>();

function broadcast(senderId: string): void {
  const msg = `data: ${JSON.stringify({ type: "inventory", senderId })}\n\n`;
  for (const client of clients) {
    if (client.clientId !== senderId) {
      try {
        client.res.write(msg);
      } catch {
        /* client gone; cleaned up on close */
      }
    }
  }
}

// ── Serialization ────────────────────────────────────────────────────────────
async function loadItemResponse(itemId: number) {
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  if (!item) return null;
  const lots = await db
    .select()
    .from(inventoryLotsTable)
    .where(eq(inventoryLotsTable.itemId, itemId));
  const sortedLots = sortLotsForConsumption(lots);
  const onHand = lots.reduce((acc, l) => acc + l.qtyRemaining, 0);
  return { ...item, onHand, lots: sortedLots };
}

// FIFO/FEFO order: earliest expiration first (nulls last), then earliest
// received date (nulls last), then insertion order (id).
function sortLotsForConsumption(lots: InventoryLot[]): InventoryLot[] {
  const byDate = (a: string | null, b: string | null): number => {
    if (a === b) return 0;
    if (!a) return 1; // null sorts last
    if (!b) return -1;
    return a < b ? -1 : 1;
  };
  return [...lots].sort(
    (a, b) =>
      byDate(a.expirationDate, b.expirationDate) ||
      byDate(a.receivedDate, b.receivedDate) ||
      a.id - b.id,
  );
}

// Executor type shared by the top-level db handle and a transaction handle, so
// drawDown can run either standalone or inside a transaction.
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Draw `qty` out of an item's lots in FIFO/FEFO order. Never goes negative;
// returns how much was actually consumed (may be less than requested).
async function drawDown(exec: Executor, itemId: number, qty: number): Promise<number> {
  if (qty <= 0) return 0;
  const lots = await exec
    .select()
    .from(inventoryLotsTable)
    .where(
      and(eq(inventoryLotsTable.itemId, itemId), gt(inventoryLotsTable.qtyRemaining, 0)),
    );
  const ordered = sortLotsForConsumption(lots);
  let remaining = qty;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    await exec
      .update(inventoryLotsTable)
      .set({ qtyRemaining: lot.qtyRemaining - take })
      .where(eq(inventoryLotsTable.id, lot.id));
    remaining -= take;
  }
  return qty - remaining;
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/inventory", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
  const allLots = await db.select().from(inventoryLotsTable);
  const lotsByItem = new Map<number, InventoryLot[]>();
  for (const lot of allLots) {
    const arr = lotsByItem.get(lot.itemId) ?? [];
    arr.push(lot);
    lotsByItem.set(lot.itemId, arr);
  }
  const out = items.map((item) => {
    const lots = lotsByItem.get(item.id) ?? [];
    return {
      ...item,
      onHand: lots.reduce((acc, l) => acc + l.qtyRemaining, 0),
      lots: sortLotsForConsumption(lots),
    };
  });
  res.json(out);
});

router.post("/inventory/items", async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid inventory item body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { key, category, name, unit, reorderThreshold } = parsed.data;
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key, category, name, unit, reorderThreshold: reorderThreshold ?? 0 })
    .onConflictDoUpdate({
      target: inventoryItemsTable.key,
      set: {
        name,
        unit,
        category,
        ...(reorderThreshold != null ? { reorderThreshold } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  broadcast(headerSenderId(req));
  res.status(201).json(await loadItemResponse(item.id));
});

router.patch("/inventory/items/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name != null) set.name = parsed.data.name;
  if (parsed.data.reorderThreshold != null) set.reorderThreshold = parsed.data.reorderThreshold;
  const [updated] = await db
    .update(inventoryItemsTable)
    .set(set)
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req));
  res.json(await loadItemResponse(id));
});

router.delete("/inventory/items/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req));
  res.sendStatus(204);
});

router.post("/inventory/restock", async (req, res): Promise<void> => {
  const parsed = RestockInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemKey, category, name, unit, qty, lotNumber, receivedDate, expirationDate } =
    parsed.data;
  if (qty <= 0) {
    res.status(400).json({ error: "qty must be positive" });
    return;
  }
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key: itemKey, category, name, unit })
    .onConflictDoUpdate({
      target: inventoryItemsTable.key,
      set: { name, unit, category, updatedAt: new Date() },
    })
    .returning();
  const [lot] = await db
    .insert(inventoryLotsTable)
    .values({
      itemId: item.id,
      lotNumber: lotNumber ?? "",
      qtyReceived: qty,
      qtyRemaining: qty,
      receivedDate: receivedDate ?? todayStr(),
      expirationDate: expirationDate ?? null,
    })
    .returning();
  await db.insert(inventoryLedgerTable).values({
    itemId: item.id,
    lotId: lot.id,
    type: "restock",
    qtyDelta: qty,
    note: lotNumber ? `Restock — lot ${lotNumber}` : "Restock",
  });
  broadcast(headerSenderId(req));
  res.json(await loadItemResponse(item.id));
});

router.post("/inventory/adjust", async (req, res): Promise<void> => {
  const parsed = AdjustInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemId, qtyDelta, note } = parsed.data;
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (qtyDelta === 0) {
    res.json(await loadItemResponse(itemId));
    return;
  }
  // Lot mutation + ledger + item touch are one atomic unit so a mid-step failure
  // can't leave stock and audit trail out of sync.
  await db.transaction(async (tx) => {
    let appliedDelta = qtyDelta;
    let lotId: number | null = null;
    if (qtyDelta > 0) {
      // Positive correction lands in a new unlotted lot.
      const [lot] = await tx
        .insert(inventoryLotsTable)
        .values({
          itemId,
          lotNumber: "",
          qtyReceived: qtyDelta,
          qtyRemaining: qtyDelta,
          receivedDate: todayStr(),
          expirationDate: null,
        })
        .returning();
      lotId = lot.id;
    } else {
      const consumed = await drawDown(tx, itemId, -qtyDelta);
      appliedDelta = -consumed; // cap at available stock
    }
    await tx.insert(inventoryLedgerTable).values({
      itemId,
      lotId,
      type: "adjust",
      qtyDelta: appliedDelta,
      note: note ?? "Manual adjustment",
    });
    await tx
      .update(inventoryItemsTable)
      .set({ updatedAt: new Date() })
      .where(eq(inventoryItemsTable.id, itemId));
  });
  broadcast(headerSenderId(req));
  res.json(await loadItemResponse(itemId));
});

router.post("/inventory/consume", async (req, res): Promise<void> => {
  const parsed = ConsumeInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { runId, lines } = parsed.data;
  if (!runId) {
    res.status(400).json({ error: "runId required" });
    return;
  }
  // Claim + drawdown + ledger all run in one transaction. The unique runId
  // marker is written even for zero-consume runs, so a later restock + re-consume
  // of the same run can't double-deduct, and onConflictDoNothing makes the claim
  // race-safe. Because the claim is part of the transaction, any failure mid-loop
  // rolls the claim back too, so the run can be retried and applied exactly once.
  let claimed = false;
  let consumedItems = 0;
  await db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(inventoryConsumedRunsTable)
      .values({ runId })
      .onConflictDoNothing({ target: inventoryConsumedRunsTable.runId })
      .returning();
    if (!claim) return; // already consumed — leave claimed=false
    claimed = true;
    for (const line of lines) {
      if (line.qty <= 0) continue;
      const [item] = await tx
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.key, line.itemKey));
      if (!item) continue; // no-op for materials with no inventory item
      const consumed = await drawDown(tx, item.id, line.qty);
      if (consumed > 0) {
        await tx.insert(inventoryLedgerTable).values({
          itemId: item.id,
          lotId: null,
          type: "consume",
          qtyDelta: -consumed,
          runId,
          note: "Auto-deducted on run completion",
        });
        consumedItems += 1;
      }
    }
  });
  if (!claimed) {
    res.json({ applied: false, consumed: 0 });
    return;
  }
  broadcast(headerSenderId(req));
  res.json({ applied: true, consumed: consumedItems });
});

router.get("/inventory/ledger", async (req, res): Promise<void> => {
  const itemIdRaw = req.query.itemId;
  const itemId = itemIdRaw != null ? parseId(String(itemIdRaw)) : null;
  const rows = itemId != null
    ? await db
        .select()
        .from(inventoryLedgerTable)
        .where(eq(inventoryLedgerTable.itemId, itemId))
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500)
    : await db
        .select()
        .from(inventoryLedgerTable)
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500);
  res.json(rows);
});

router.get("/inventory/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "inventory", senderId: null })}\n\n`);

  const client: SseClient = { res, clientId };
  clients.add(client);
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      /* noop */
    }
  }, 15_000);
  req.on("close", () => {
    clients.delete(client);
    clearInterval(heartbeat);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function headerSenderId(req: Request): string {
  const h = req.header("x-client-id");
  return typeof h === "string" ? h : "";
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default router;
