// Mix surplus ledger — web platform glue.
//
// The ledger lives server-side (mix_surplus_lots + mix_surplus_allocations):
// day-start consumption records over-produced lots at the source, and the
// Mixes tab reads balances here for the "X lbs in the freezer" reminder.
// Using surplus never re-deducts inventory — the mix's amountAlreadyMade
// reducer already applied the carry; allocations/voids are ledger actions.
//
// Parsing is defensive (mirrors parseFreezerSurplusLedger): unknown/partial
// server shapes degrade to an empty ledger instead of crashing the tab, and
// balances derive from lots when the server omits them.

import { inventoryClientId } from "./inventoryShared";

export interface MixSurplusLot {
  id: string;
  mixId: string;
  name: string;
  brand?: string;
  flavor?: string;
  isPrep?: boolean;
  productionDate: string;
  location: string;
  amountMade: number;
  amountUsed: number;
  amountRemaining: number;
}

export interface MixSurplusAllocation {
  id: string;
  lotId: string;
  mixId: string;
  runId?: string;
  runDate: string;
  brand?: string;
  flavor?: string;
  isPrep?: boolean;
  amount: number;
}

export interface MixSurplusBalance {
  mixId: string;
  name: string;
  lbs: number;
  productionDates: string[];
}

export interface MixSurplusLedger {
  lots: MixSurplusLot[];
  allocations: MixSurplusAllocation[];
  balances: MixSurplusBalance[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asDateString(value: unknown): string | null {
  return typeof value === "string" && DATE_RE.test(value) ? value : null;
}

function asNonNegNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function deriveBalances(lots: MixSurplusLot[]): MixSurplusBalance[] {
  const byMix = new Map<string, { name: string; lbs: number; dates: Set<string> }>();
  for (const lot of lots) {
    if (lot.amountRemaining <= 0) continue;
    const cur = byMix.get(lot.mixId) ?? { name: lot.name, lbs: 0, dates: new Set<string>() };
    if (lot.name) cur.name = lot.name;
    cur.lbs = Math.round((cur.lbs + lot.amountRemaining) * 100) / 100;
    cur.dates.add(lot.productionDate);
    byMix.set(lot.mixId, cur);
  }
  return [...byMix.entries()].map(([mixId, b]) => ({
    mixId,
    name: b.name,
    lbs: b.lbs,
    productionDates: [...b.dates].sort(),
  }));
}

export function parseMixSurplusLedger(value: unknown): MixSurplusLedger {
  if (!value || typeof value !== "object") return { lots: [], allocations: [], balances: [] };
  const raw = value as { lots?: unknown; allocations?: unknown; balances?: unknown };

  const lots: MixSurplusLot[] = [];
  if (Array.isArray(raw.lots)) {
    for (const candidate of raw.lots) {
      if (!candidate || typeof candidate !== "object") continue;
      const lot = candidate as Record<string, unknown>;
      const productionDate = asDateString(lot.productionDate);
      const amountMade = asNonNegNumber(lot.amountMade);
      const amountUsed = asNonNegNumber(lot.amountUsed);
      const amountRemaining = asNonNegNumber(lot.amountRemaining);
      if (
        typeof lot.id !== "string" ||
        typeof lot.mixId !== "string" ||
        !productionDate ||
        amountMade === null ||
        amountRemaining === null ||
        amountRemaining > amountMade
      ) {
        continue;
      }
      lots.push({
        id: lot.id,
        mixId: lot.mixId,
        name: typeof lot.name === "string" ? lot.name : "",
        ...(asString(lot.brand) !== undefined ? { brand: lot.brand as string } : {}),
        ...(asString(lot.flavor) !== undefined ? { flavor: lot.flavor as string } : {}),
        ...(asBool(lot.isPrep) !== undefined ? { isPrep: lot.isPrep as boolean } : {}),
        productionDate,
        location: typeof lot.location === "string" ? lot.location : "freezer",
        amountMade,
        amountUsed: amountUsed ?? 0,
        amountRemaining,
      });
    }
  }

  const allocations: MixSurplusAllocation[] = [];
  if (Array.isArray(raw.allocations)) {
    for (const candidate of raw.allocations) {
      if (!candidate || typeof candidate !== "object") continue;
      const allocation = candidate as Record<string, unknown>;
      const runDate = asDateString(allocation.runDate);
      const amount = asNonNegNumber(allocation.amount);
      if (
        typeof allocation.id !== "string" ||
        typeof allocation.lotId !== "string" ||
        typeof allocation.mixId !== "string" ||
        !runDate ||
        amount === null
      ) {
        continue;
      }
      allocations.push({
        id: allocation.id,
        lotId: allocation.lotId,
        mixId: allocation.mixId,
        ...(asString(allocation.runId) !== undefined ? { runId: allocation.runId as string } : {}),
        runDate,
        ...(asString(allocation.brand) !== undefined ? { brand: allocation.brand as string } : {}),
        ...(asString(allocation.flavor) !== undefined ? { flavor: allocation.flavor as string } : {}),
        ...(asBool(allocation.isPrep) !== undefined ? { isPrep: allocation.isPrep as boolean } : {}),
        amount,
      });
    }
  }

  let balances: MixSurplusBalance[] = [];
  if (Array.isArray(raw.balances)) {
    for (const candidate of raw.balances) {
      if (!candidate || typeof candidate !== "object") continue;
      const balance = candidate as Record<string, unknown>;
      const lbs = asNonNegNumber(balance.lbs);
      const productionDates = Array.isArray(balance.productionDates)
        ? balance.productionDates.filter(asDateString).map(String)
        : [];
      if (typeof balance.mixId !== "string" || lbs === null) continue;
      balances.push({
        mixId: balance.mixId,
        name: typeof balance.name === "string" ? balance.name : "",
        lbs,
        productionDates,
      });
    }
  }
  if (balances.length === 0) balances = deriveBalances(lots);

  return { lots, allocations, balances };
}

async function requestSurplus(path: string, init?: RequestInit): Promise<MixSurplusLedger> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "The mix surplus server did not accept the request.",
    );
  }
  return parseMixSurplusLedger(body);
}

export function fetchMixSurplusLedger(): Promise<MixSurplusLedger> {
  return requestSurplus("/api/mix-surplus");
}

export function recordMixSurplus(input: {
  mixId: string;
  productionDate: string;
  amountMade: number;
}): Promise<MixSurplusLedger> {
  return requestSurplus("/api/mix-surplus", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function replaceMixSurplusAllocations(
  runDate: string,
  allocations: Array<{ lotId: string; amount: number }>,
): Promise<MixSurplusLedger> {
  return requestSurplus(`/api/mix-surplus/allocations/${encodeURIComponent(runDate)}`, {
    method: "PUT",
    body: JSON.stringify({ runDate, allocations }),
  });
}

export function voidMixSurplusLot(id: string): Promise<MixSurplusLedger> {
  return requestSurplus(`/api/mix-surplus/lots/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
