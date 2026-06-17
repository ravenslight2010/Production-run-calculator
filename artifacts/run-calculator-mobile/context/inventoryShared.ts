// Mobile inventory: per-run consumption mapping + REST/SSE client.
//
// Consumption MUST match the web app's deduction exactly (replit.md parity
// rule). The web app deducts a run's full planned usage based on
// computeSummaryStats (totals from casesNeeded, plus the casesPerLayer buffer
// for sauce/apps/peps) — NOT the remaining-demand computeCalc used by the live
// warehouse screen. We replicate computeSummaryStats here against RunSettings.
//
// Item keys are quantity-independent stable identities shared with the web app
// (same backend DB), so the same material lines up regardless of platform.

import { Platform } from "react-native";
import type { RunSettings, RecipeRow } from "./RunContext";
import { DEFAULT_PEP_TYPES } from "./RunContext";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

// ── Types (mirror the API server's inventory responses) ──────────────────────
export type InventoryCategory = "ingredient" | "packaging";

export interface InventoryLot {
  id: number;
  itemId: number;
  lotNumber: string;
  qtyReceived: number;
  qtyRemaining: number;
  receivedDate: string | null;
  expirationDate: string | null;
  createdAt: string;
}

export interface InventoryItem {
  id: number;
  key: string;
  category: string;
  name: string;
  unit: string;
  reorderThreshold: number;
  createdAt: string;
  updatedAt: string;
  onHand: number;
  lots: InventoryLot[];
}

export interface LedgerEntry {
  id: number;
  itemId: number;
  lotId: number | null;
  type: string;
  qtyDelta: number;
  runId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ConsumeLine {
  itemKey: string;
  qty: number;
}
export interface CandidateItem {
  key: string;
  category: InventoryCategory;
  name: string;
  unit: string;
}
export interface RunLine extends CandidateItem {
  qty: number;
}

function sumRecipe(rows: RecipeRow[] | undefined): number {
  return (rows ?? []).reduce((acc, r) => acc + Number(r.lbs ?? 0), 0);
}

// ── Per-run consumption mapping (mirrors web computeSummaryStats) ────────────
export function computeRunLines(s: RunSettings): RunLine[] {
  const map = new Map<string, RunLine>();
  const add = (key: string, category: InventoryCategory, name: string, unit: string, qty: number) => {
    if (!(qty > 0)) return;
    const ex = map.get(key);
    if (ex) ex.qty += qty;
    else map.set(key, { key, category, name, unit, qty });
  };

  const totalPizzas = s.casesNeeded * s.pizzasPerCase;
  const totalPizzasForSauce = totalPizzas + s.casesPerLayer * s.pizzasPerCase;

  // Dough — effective yield from recipe (lbs * 16 / doughball oz) or flat yield.
  const dRecipeLbs = sumRecipe(s.doughRecipe);
  const effYield =
    dRecipeLbs > 0 && s.doughballWeightOz > 0
      ? (dRecipeLbs * 16) / s.doughballWeightOz
      : s.doughBatchYield;
  if (effYield > 0 && s.doughballWeightOz > 0) {
    const batches = Math.ceil(totalPizzas / effYield);
    add("ingredient:Dough:batches", "ingredient", "Dough", "batches", batches);
  }

  // Sauce
  const frontlineLbs = sumRecipe(s.frontlineRecipe);
  const sauceEffBarrel = frontlineLbs > 0 ? frontlineLbs : s.sauceBarrelLbs;
  const sauceLbs = (totalPizzasForSauce * s.sauceOzPerPizza) / 16 + 30;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  if (sauceBatches > 0) add("ingredient:Sauce:batches", "ingredient", "Sauce", "batches", sauceBatches);

  // Applicators 1–4
  const apps = [
    { type: s.app1Type, oz: s.app1OzPerPizza, recipe: s.app1CheeseRecipe, batch: s.app1BatchLbs },
    { type: s.app2Type, oz: s.app2OzPerPizza, recipe: s.app2CheeseRecipe, batch: s.app2BatchLbs },
    { type: s.app3Type, oz: s.app3OzPerPizza, recipe: s.app3CheeseRecipe, batch: s.app3BatchLbs },
    { type: s.app4Type, oz: s.app4OzPerPizza, recipe: s.app4CheeseRecipe, batch: s.app4BatchLbs },
  ];
  for (const a of apps) {
    const type = (a.type ?? "").trim();
    if (!type) continue;
    const lbs = (totalPizzasForSauce * a.oz) / 16 + 20;
    const isMix = type.toLowerCase().includes("mix");
    const effBatch = sumRecipe(a.recipe) > 0 ? sumRecipe(a.recipe) : a.batch;
    if (isMix && lbs > 0) add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", lbs);
    else if (!isMix && effBatch > 0) add(`ingredient:${type}:batches`, "ingredient", type, "batches", lbs / effBatch);
  }

  // Pepperoni 1–2
  const peps = [
    { type: s.pep1Type, oz: s.pep1OzPerPizza, sticks: s.pep1Sticks, batch: s.pep1BatchLbs },
    { type: s.pep2Type, oz: s.pep2OzPerPizza, sticks: s.pep2Sticks, batch: s.pep2BatchLbs },
  ];
  for (const pep of peps) {
    const type = (pep.type ?? "").trim();
    if (!type) continue;
    const lbs = (totalPizzasForSauce * pep.oz) / 16 + pep.sticks;
    if (!(lbs > 0)) continue;
    const std = DEFAULT_PEP_TYPES.includes(type);
    if (std) add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", lbs);
    else if (pep.batch > 0) add(`ingredient:${type}:batches`, "ingredient", type, "batches", lbs / pep.batch);
  }

  // Packaging — only cartoned runs consume packaging
  if ((s.cartoned ?? "").trim().toLowerCase() === "yes") {
    const circle = (s.circles ?? "").trim();
    if (circle && circle.toLowerCase() !== "none" && totalPizzas > 0) {
      add(`packaging:circles:${circle}`, "packaging", `Circles — ${circle}`, "circles", totalPizzas);
    }
    const shipper = (s.shipper ?? "").trim();
    if (shipper && shipper.toLowerCase() !== "none" && s.casesNeeded > 0) {
      add(`packaging:shippers:${shipper}`, "packaging", `Shippers — ${shipper}`, "shippers", s.casesNeeded);
    }
    const perCase = Number(s.cartonsPerCase) || 0;
    if (perCase > 0 && totalPizzas > 0) {
      add("packaging:cartons:cases", "packaging", "Cartons", "cases", Math.ceil(totalPizzas / perCase));
    }
  }

  return [...map.values()];
}

export function computeRunConsumptionLines(s: RunSettings): ConsumeLine[] {
  return computeRunLines(s).map((l) => ({ itemKey: l.key, qty: l.qty }));
}

export function deriveCandidateItems(settingsList: RunSettings[]): CandidateItem[] {
  const map = new Map<string, CandidateItem>();
  for (const s of settingsList) {
    for (const l of computeRunLines(s)) {
      if (!map.has(l.key)) map.set(l.key, { key: l.key, category: l.category, name: l.name, unit: l.unit });
    }
  }
  return [...map.values()];
}

// ── Expiration helpers ───────────────────────────────────────────────────────
// Default expiry lead time; overridden by the user-configured value loaded from
// the inventory settings endpoint.
export const EXPIRY_SOON_DAYS = 7;

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export type ExpiryStatus = "expired" | "soon" | "ok" | "none";

export function lotExpiryStatus(
  lot: InventoryLot,
  soonDays: number = EXPIRY_SOON_DAYS,
): ExpiryStatus {
  const d = daysUntil(lot.expirationDate);
  if (d == null) return "none";
  if (d < 0) return "expired";
  if (d <= soonDays) return "soon";
  return "ok";
}

export function isLowStock(item: InventoryItem): boolean {
  return item.reorderThreshold > 0 && item.onHand <= item.reorderThreshold;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── REST client ──────────────────────────────────────────────────────────────
async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const res = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Inventory request failed (${res.status}): ${path}`);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export interface CreateItemBody {
  key: string;
  category: string;
  name: string;
  unit: string;
  reorderThreshold?: number;
}
export interface UpdateItemBody {
  name?: string;
  reorderThreshold?: number;
}
export interface RestockBody {
  itemKey: string;
  category: string;
  name: string;
  unit: string;
  qty: number;
  lotNumber?: string;
  receivedDate?: string;
  expirationDate?: string;
}
export interface AdjustBody {
  itemId: number;
  qtyDelta: number;
  note?: string;
}
export interface InventorySettings {
  expirySoonDays: number;
}

// ── Photo stock intake (AI vision) ───────────────────────────────────────────
export interface PhotoGuess {
  name: string;
  qty: number;
  unit: string;
  category: InventoryCategory;
  matchedKey: string | null;
  confidence: number;
}
export interface IdentifyPhotoBody {
  imageBase64: string;
  mimeType?: string;
  candidates?: CandidateItem[];
}

export const fetchInventory = () => api<InventoryItem[]>("/inventory");
export const fetchInventorySettings = () =>
  api<InventorySettings>("/inventory/settings");
export const updateInventorySettings = (body: InventorySettings) =>
  api<InventorySettings>("/inventory/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
export const fetchLedger = (itemId?: number) =>
  api<LedgerEntry[]>(`/inventory/ledger${itemId != null ? `?itemId=${itemId}` : ""}`);
export const createInventoryItem = (body: CreateItemBody) =>
  api<InventoryItem>("/inventory/items", { method: "POST", body: JSON.stringify(body) });
export const updateInventoryItem = (id: number, body: UpdateItemBody) =>
  api<InventoryItem>(`/inventory/items/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteInventoryItem = (id: number) =>
  api<null>(`/inventory/items/${id}`, { method: "DELETE" });
export const restockInventory = (body: RestockBody) =>
  api<InventoryItem>("/inventory/restock", { method: "POST", body: JSON.stringify(body) });
export const adjustInventory = (body: AdjustBody) =>
  api<InventoryItem>("/inventory/adjust", { method: "POST", body: JSON.stringify(body) });
export const consumeRunInventory = (runId: string, lines: ConsumeLine[]) =>
  api<{ applied: boolean; consumed: number }>("/inventory/consume", {
    method: "POST",
    body: JSON.stringify({ runId, lines }),
  });
export const identifyInventoryPhoto = (body: IdentifyPhotoBody) =>
  api<{ items: PhotoGuess[] }>("/inventory/identify-photo", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── SSE stream (ping → refetch), cross-platform like openSyncStream ──────────
export interface InventoryStream {
  close: () => void;
}

interface SseMessageEvent {
  data?: string | null;
}

export function openInventoryStream(
  clientId: string,
  onPing: (senderId: string | null) => void,
): InventoryStream {
  const base = getApiBaseUrl();
  if (!base) return { close: () => {} };
  const url = `${base}/api/inventory/events?clientId=${encodeURIComponent(clientId)}`;

  function handleData(raw: string | null | undefined): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { senderId?: string | null };
      onPing(parsed.senderId ?? null);
    } catch {
      /* ignore malformed frame */
    }
  }

  if (Platform.OS === "web" && typeof globalThis !== "undefined" && "EventSource" in globalThis) {
    const ES = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource;
    const es = new ES(url);
    es.onmessage = (e: MessageEvent) => handleData(e.data as string);
    return { close: () => es.close() };
  }

  const RNEventSource = require("react-native-sse").default as new (
    url: string,
    opts?: Record<string, unknown>,
  ) => {
    addEventListener: (type: string, listener: (event: SseMessageEvent) => void) => void;
    close: () => void;
  };
  const es = new RNEventSource(url, { pollingInterval: 0 });
  es.addEventListener("message", (event: SseMessageEvent) => handleData(event.data));
  return { close: () => es.close() };
}
