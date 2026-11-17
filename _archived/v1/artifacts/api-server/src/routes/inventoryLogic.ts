// Pure (DB-free) core of inventory auto-deduction, extracted so it can be unit
// tested without a database or transaction. The route handlers in inventory.ts
// supply the DB-backed plumbing; everything correctness-critical (lot ordering,
// never-go-negative drawdown, and run-once idempotency control flow) lives here.

// Minimal shape a lot needs to be ordered/drawn down. Kept structural (not the
// full InventoryLot) so this module never has to import @workspace/db.
export interface LotForConsumption {
  id: number;
  qtyRemaining: number;
  receivedDate: string | null;
  expirationDate: string | null;
}

// FIFO/FEFO order: earliest expiration first (nulls last), then earliest
// received date (nulls last), then insertion order (id).
export function sortLotsForConsumption<T extends LotForConsumption>(lots: T[]): T[] {
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

// Plan how to draw `qty` out of an item's lots in FIFO/FEFO order. Never goes
// negative; `consumed` is how much was actually taken (<= qty, capped at the
// total available). `updates` lists only the lots that change, with their new
// remaining quantity. Caller is responsible for persisting the updates.
export function planDrawDown<T extends LotForConsumption>(
  lots: T[],
  qty: number,
): { consumed: number; updates: Array<{ id: number; qtyRemaining: number }> } {
  if (qty <= 0) return { consumed: 0, updates: [] };
  const ordered = sortLotsForConsumption(lots);
  const updates: Array<{ id: number; qtyRemaining: number }> = [];
  let remaining = qty;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    if (take <= 0) continue;
    updates.push({ id: lot.id, qtyRemaining: lot.qtyRemaining - take });
    remaining -= take;
  }
  return { consumed: qty - remaining, updates };
}

// One material to deduct for a finished run.
export interface ConsumeLine {
  itemKey: string;
  qty: number;
}

// DB-backed operations injected by the route handler. claimRun is the
// idempotency gate: it must atomically insert the run marker and return true
// only the first time a given runId is seen (false if already consumed).
export interface ConsumeDeps {
  claimRun(runId: string): Promise<boolean>;
  findItemByKey(itemKey: string): Promise<{ id: number; conversionFactor?: number } | null>;
  drawDown(itemId: number, qty: number): Promise<number>;
  drawDownDetails?: (itemId: number, qty: number) => Promise<{ consumed: number; lots: Array<{ lotId: number; qty: number }> }>;
  recordConsumption(itemId: number, consumed: number, lots?: Array<{ lotId: number; qty: number }>): Promise<void>;
}

// Run-once auto-deduction control flow. The run is claimed exactly once up
// front (writing the marker even for a zero-consume run), so re-finalizing the
// same run draws nothing down a second time. Non-positive lines and materials
// without a matching inventory item are skipped; only lots that actually move
// produce a ledger entry. Returns whether the run was applied this call and how
// many distinct items were drawn down.
export async function applyRunConsumption(
  deps: ConsumeDeps,
  runId: string,
  lines: ConsumeLine[],
): Promise<{ applied: boolean; consumed: number }> {
  const claimed = await deps.claimRun(runId);
  if (!claimed) return { applied: false, consumed: 0 };
  let consumedItems = 0;
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const item = await deps.findItemByKey(line.itemKey);
    if (!item) continue;
    const requestedInventoryQty = line.qty / (item.conversionFactor ?? 1);
    const detail = deps.drawDownDetails
      ? await deps.drawDownDetails(item.id, requestedInventoryQty)
      : { consumed: await deps.drawDown(item.id, requestedInventoryQty), lots: [] };
    const consumed = detail.consumed;
    if (consumed > 0) {
      await deps.recordConsumption(item.id, consumed, detail.lots);
      consumedItems += 1;
    }
  }
  return { applied: true, consumed: consumedItems };
}
