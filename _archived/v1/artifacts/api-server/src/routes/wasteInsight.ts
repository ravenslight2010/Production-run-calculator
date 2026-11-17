import { WasteInsightBody } from "@workspace/api-zod";
import * as z from "zod";

// Keep the compatibility request bounded even though deterministic expiry
// insight no longer sends planned items to a model.
export const MAX_PLANNED_ITEMS = 1000;

export type WasteStatus = "expired" | "soon";

export type WasteFlaggedItem = {
  key: string;
  name: string;
  category: string;
  unit: string;
  status: WasteStatus;
  qtyAtRisk: number;
  earliestExpiration: string | null;
  daysUntilExpiry: number | null;
};

// Minimal shape of an inventory item the flagging logic needs. The real DB rows
// carry more, but keeping this narrow lets the pure function be unit-tested
// without a database.
export type FlaggableLot = {
  qtyRemaining: number;
  expirationDate: string | null;
};
export type FlaggableItem = {
  key: string;
  name: string;
  category: string;
  unit: string;
  lots: FlaggableLot[];
};

// Whole-day difference between an expiration date (YYYY-MM-DD) and `now`,
// measured in local calendar days. Negative once expired. Returns null when the
// date is missing or unparseable.
export function daysUntilExpiry(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// Pure: from the current inventory, flag items that have stock in lots which are
// already expired or expiring within `soonDays`. Aggregates the at-risk quantity
// per item and surfaces the earliest at-risk expiration. Items with no remaining
// at-risk stock are skipped. Result is sorted most-urgent first (expired before
// expiring-soon, then by soonest expiry).
export function flagExpiringItems(
  items: ReadonlyArray<FlaggableItem>,
  soonDays: number,
  now: Date = new Date(),
): WasteFlaggedItem[] {
  const out: WasteFlaggedItem[] = [];
  for (const item of items) {
    let qtyAtRisk = 0;
    let earliestDays: number | null = null;
    let earliestDate: string | null = null;
    let anyExpired = false;
    for (const lot of item.lots ?? []) {
      if (!(lot.qtyRemaining > 0)) continue;
      const days = daysUntilExpiry(lot.expirationDate, now);
      if (days == null) continue;
      const isExpired = days < 0;
      const isSoon = days >= 0 && days <= soonDays;
      if (!isExpired && !isSoon) continue;
      qtyAtRisk += lot.qtyRemaining;
      if (isExpired) anyExpired = true;
      if (earliestDays == null || days < earliestDays) {
        earliestDays = days;
        earliestDate = lot.expirationDate;
      }
    }
    if (qtyAtRisk <= 0 || earliestDays == null) continue;
    out.push({
      key: item.key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      status: anyExpired ? "expired" : "soon",
      qtyAtRisk,
      earliestExpiration: earliestDate,
      daysUntilExpiry: earliestDays,
    });
  }
  out.sort((a, b) => {
    const da = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    const dbb = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    return da - dbb;
  });
  return out;
}

export type WasteInsightInput = z.infer<typeof WasteInsightBody>;

export type WasteValidationResult =
  | { ok: true; data: WasteInsightInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /inventory/waste-insight.
export function validateWasteInsightBody(body: unknown): WasteValidationResult {
  const parsed = WasteInsightBody.safeParse(body ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const planned = parsed.data.plannedItems;
  if (planned && planned.length > MAX_PLANNED_ITEMS) {
    return {
      ok: false,
      status: 400,
      error: `Too many planned items (max ${MAX_PLANNED_ITEMS})`,
    };
  }
  return { ok: true, data: parsed.data };
}
// End of deterministic waste insight helpers.
