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

import { getAuthToken } from "@workspace/api-client-react";
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
// Typed error so callers can react to specific HTTP statuses (e.g. the photo
// endpoint's rate limit 429 / size cap 413) instead of parsing message strings.
export class InventoryApiError extends Error {
  status: number;
  retryAfterSec: number | null;
  serverMessage: string | null;
  constructor(
    status: number,
    message: string,
    retryAfterSec: number | null,
    serverMessage: string | null,
  ) {
    super(message);
    this.name = "InventoryApiError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.serverMessage = serverMessage;
  }
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  // Mobile has no cookie jar — attach the session bearer token explicitly.
  const token = await getAuthToken();
  const res = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw))
        ? Number(retryAfterRaw)
        : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore and fall back to the generic message
    }
    throw new InventoryApiError(
      res.status,
      `Inventory request failed (${res.status}): ${path}`,
      retryAfterSec,
      serverMessage,
    );
  }
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

// ── Staff roles / access control ─────────────────────────────────────────────
export type Role = "manager" | "operator";
export interface StaffMember {
  userId: string;
  role: Role;
  email: string | null;
  name: string | null;
}
export const fetchMe = () => api<StaffMember>("/me");

// Auth — username + password. Mobile has no cookie jar, so the server's session
// token is returned in the response body; the auth context persists it in
// expo-secure-store and replays it as a bearer header via setAuthTokenGetter.
export type AuthResult = { token: string; user: StaffMember };
export const signUpRequest = (username: string, password: string) =>
  api<AuthResult>("/auth/sign-up", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
export const signInRequest = (username: string, password: string) =>
  api<AuthResult>("/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
export const signOutRequest = () =>
  api<null>("/auth/sign-out", { method: "POST" });

export const fetchStaff = () => api<StaffMember[]>("/users");
export const setStaffRole = (userId: string, role: Role) =>
  api<StaffMember>(`/users/${encodeURIComponent(userId)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });

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

export type MergeInventoryLine = {
  fromKey: string;
  toKey: string;
  toName: string;
  category: string;
  unit: string;
};
// Why the server skipped a fold instead of applying it. `source-not-tracked` is
// benign (the name simply isn't in inventory); the others flag bad input.
export type MergeSkipReason =
  | "blank-key"
  | "same-key"
  | "source-not-tracked"
  | "same-item";
export type MergeOutcome = {
  fromKey: string;
  toKey: string;
  status: "applied" | "skipped";
  reason?: MergeSkipReason;
};
export type MergeInventoryResult = {
  merged: number;
  results: MergeOutcome[];
};
// Fold each source item's stock + ledger history into the target item server-
// side. Safe to call even when no source name is tracked in inventory — the
// server skips unknown keys. Returns a per-entry report (applied vs
// skipped-with-reason) so callers can surface which pairs didn't fold and why.
// Mirrors the web client at `run-calculator/src/inventoryShared.ts`.
export const mergeInventory = (merges: MergeInventoryLine[]) =>
  api<MergeInventoryResult>("/inventory/merge", {
    method: "POST",
    body: JSON.stringify({ merges }),
  });
// Server rejects images whose base64 payload exceeds MAX_IMAGE_BASE64_CHARS
// (8M chars) with a 413. Clients downscale/compress to stay comfortably under
// this target so a 413 should never reach the user. The margin below the server
// cap leaves room for the rest of the JSON body (candidates, etc.).
export const MAX_IMAGE_BASE64_CHARS = 7_000_000;

// iPhones often hand a web file picker a HEIC/HEIF photo, which most desktop
// browsers can't decode via <img>/canvas. Detect it (MIME type is often blank
// for HEIC, so fall back to the filename extension) so the web app can show
// actionable guidance instead of a cryptic "Failed to load image". Native
// mobile decodes HEIC via expo-image-manipulator, so this never fires there;
// it's mirrored here only to keep the shared message/behavior in parity.
export function isHeicFile(file: { name?: string; type?: string }): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;
  const name = (file.name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

export const HEIC_UNSUPPORTED_MESSAGE =
  "This looks like an iPhone HEIC photo your browser can't open. Please choose a JPEG or PNG instead — or set your iPhone's Settings → Camera → Formats to \"Most Compatible.\"";

export const identifyInventoryPhoto = (body: IdentifyPhotoBody) =>
  api<{ items: PhotoGuess[] }>("/inventory/identify-photo", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Maps a photo-intake failure to a friendly, human message. The server guards
// this endpoint with a rate limit (429) and image-size cap (413); surface those
// as intentional, actionable guidance rather than a generic failure.
export function photoErrorMessage(e: unknown): string {
  if (e instanceof InventoryApiError) {
    if (e.status === 429) {
      const wait =
        e.retryAfterSec && e.retryAfterSec > 0
          ? `try again in about ${e.retryAfterSec} second${e.retryAfterSec === 1 ? "" : "s"}`
          : "try again in a minute";
      return `You're going a bit fast — ${wait}.`;
    }
    if (e.status === 413) {
      return "That image is too large. Try retaking the photo at a lower resolution.";
    }
  }
  return e instanceof Error ? e.message : "Failed to analyze photo";
}

// Score how closely a free-text guess name matches a known candidate name.
// Higher is closer. Used to surface the closest inventory items when the AI
// match is uncertain so the user can pick the right one.
export function scoreNameMatch(query: string, name: string): number {
  const q = query.toLowerCase().trim();
  const n = name.toLowerCase().trim();
  if (!q || !n) return 0;
  if (q === n) return 1000;
  if (n.includes(q) || q.includes(n)) return 500 + Math.min(q.length, n.length);
  const qt = new Set(q.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const t of n.split(/\s+/).filter(Boolean)) if (qt.has(t)) overlap += 1;
  return overlap * 10;
}

// Rank candidates by closeness to a guessed name (closest first). Stable for
// equal scores (preserves input order).
export function rankCandidatesByName(name: string, candidates: CandidateItem[]): CandidateItem[] {
  return candidates
    .map((c, i) => ({ c, i, s: scoreNameMatch(name, c.name) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

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

  // Native: resolve the bearer token first, then open with an Authorization header.
  let closed = false;
  let es: { close: () => void } | null = null;
  void (async () => {
    const token = await getAuthToken();
    if (closed) return;
    const RNEventSource = require("react-native-sse").default as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => {
      addEventListener: (type: string, listener: (event: SseMessageEvent) => void) => void;
      close: () => void;
    };
    const inst = new RNEventSource(url, {
      pollingInterval: 0,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    inst.addEventListener("message", (event: SseMessageEvent) => handleData(event.data));
    es = inst;
  })();
  return {
    close: () => {
      closed = true;
      es?.close();
    },
  };
}
