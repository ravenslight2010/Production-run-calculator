import type { FormValues } from "./types";
import { DEFAULT_PEP_TYPES } from "./types";
import { computeSummaryStats } from "./utils";

// ── Types (mirror the API server's inventory responses) ──────────────────────
export type InventoryCategory = "ingredient" | "packaging";

export type InventoryLot = {
  id: number;
  itemId: number;
  lotNumber: string;
  qtyReceived: number;
  qtyRemaining: number;
  receivedDate: string | null;
  expirationDate: string | null;
  createdAt: string;
};

export type InventoryItem = {
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
};

export type LedgerEntry = {
  id: number;
  itemId: number;
  lotId: number | null;
  type: string;
  qtyDelta: number;
  runId: string | null;
  note: string | null;
  createdAt: string;
};

export type ConsumeLine = { itemKey: string; qty: number };
export type CandidateItem = { key: string; category: InventoryCategory; name: string; unit: string };
export type RunLine = CandidateItem & { qty: number };

// ── Per-run consumption mapping ──────────────────────────────────────────────
// Mirrors the warehouse roll-up (aggregateNeedRows + aggregatePackagingNeeds in
// home.tsx) so inventory item keys line up exactly with production demand. Keys
// are stable identities; the server treats unknown keys as no-ops.
export function computeRunLines(vals: FormValues): RunLine[] {
  const map = new Map<string, RunLine>();
  const add = (key: string, category: InventoryCategory, name: string, unit: string, qty: number) => {
    if (!(qty > 0)) return;
    const ex = map.get(key);
    if (ex) ex.qty += qty;
    else map.set(key, { key, category, name, unit, qty });
  };

  const s = computeSummaryStats(vals);

  // Dough — batches = ceil(totalPizzas / effective yield)
  const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc, r) => acc + Number(r.lbs ?? 0), 0);
  const effYield =
    dRecipeLbs > 0 && vals.targetDoughballWeight > 0
      ? (dRecipeLbs * 16) / vals.targetDoughballWeight
      : vals.doughBatchYield;
  if (effYield > 0 && vals.targetDoughballWeight > 0) {
    const batches = Math.ceil(s.totalPizzas / effYield);
    add("ingredient:Dough:batches", "ingredient", "Dough", "batches", batches);
  }

  // Sauce
  if (s.sauceBatches > 0) {
    add("ingredient:Sauce:batches", "ingredient", "Sauce", "batches", s.sauceBatches);
  }

  // Applicators (cheese / mixes)
  const apps = [
    { type: s.app1Type, lbs: s.app1Lbs, batches: s.app1Batches },
    { type: s.app2Type, lbs: s.app2Lbs, batches: s.app2Batches },
    { type: s.app3Type, lbs: s.app3Lbs, batches: s.app3Batches },
    { type: s.app4Type, lbs: s.app4Lbs, batches: s.app4Batches },
  ];
  for (const a of apps) {
    const type = (a.type ?? "").trim();
    if (!type) continue;
    const isMix = type.toLowerCase().includes("mix");
    if (isMix && a.lbs > 0) add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", a.lbs);
    else if (!isMix && a.batches > 0) add(`ingredient:${type}:batches`, "ingredient", type, "batches", a.batches);
  }

  // Pepperoni / toppings — trim type identically to mobile so keys/std-vs-batch
  // classification stay in parity even when the type has stray whitespace.
  const pep1Type = (s.pep1Type ?? "").trim();
  if (pep1Type && s.pep1Lbs > 0) {
    const std = DEFAULT_PEP_TYPES.includes(pep1Type);
    if (std) add(`ingredient:${pep1Type}:lbs`, "ingredient", pep1Type, "lbs", s.pep1Lbs);
    else add(`ingredient:${pep1Type}:batches`, "ingredient", pep1Type, "batches", s.pep1Batches);
  }
  const pep2Type = (s.pep2Type ?? "").trim();
  if (pep2Type && s.pep2Lbs > 0) {
    const std = DEFAULT_PEP_TYPES.includes(pep2Type);
    if (std) add(`ingredient:${pep2Type}:lbs`, "ingredient", pep2Type, "lbs", s.pep2Lbs);
    else add(`ingredient:${pep2Type}:batches`, "ingredient", pep2Type, "batches", s.pep2Batches);
  }

  // Packaging — only cartoned runs consume packaging
  if ((vals.cartoned ?? "").trim().toLowerCase() === "yes") {
    const circle = (vals.circles ?? "").trim();
    if (circle && circle.toLowerCase() !== "none" && s.totalPizzas > 0) {
      add(`packaging:circles:${circle}`, "packaging", `Circles — ${circle}`, "circles", s.totalPizzas);
    }
    const shipper = (vals.shipper ?? "").trim();
    if (shipper && shipper.toLowerCase() !== "none" && s.totalCases > 0) {
      add(`packaging:shippers:${shipper}`, "packaging", `Shippers — ${shipper}`, "shippers", s.totalCases);
    }
    const perCase = Number(vals.cartonsPerCase) || 0;
    if (perCase > 0 && s.totalPizzas > 0) {
      add("packaging:cartons:cases", "packaging", "Cartons", "cases", Math.ceil(s.totalPizzas / perCase));
    }
  }

  return [...map.values()];
}

export function computeRunConsumptionLines(vals: FormValues): ConsumeLine[] {
  return computeRunLines(vals).map((l) => ({ itemKey: l.key, qty: l.qty }));
}

// Distinct candidate items across the given runs, for the "add from production"
// picker. Deduped by stable key; quantities are dropped.
export function deriveCandidateItems(valsList: FormValues[]): CandidateItem[] {
  const map = new Map<string, CandidateItem>();
  for (const vals of valsList) {
    for (const l of computeRunLines(vals)) {
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
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
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

// ── API client (raw fetch, matches the hand-written sync client) ─────────────
const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
export function inventoryClientId(): string {
  return clientId;
}

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

// A 401 from a normal (already signed-in) request means the session ended —
// most often because the daily reset advanced the server-side session boundary.
// AuthContext registers a handler here so any such 401 routes the user back to
// the login screen. Sign-in/up failures and the signed-out /me probe are not
// session expiries, so those paths are excluded by the caller below.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

function isSessionProbePath(path: string): boolean {
  return path === "/me" || path.startsWith("/auth/");
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401 && !isSessionProbePath(path)) onUnauthorized?.();
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

export type CreateItemBody = {
  key: string;
  category: string;
  name: string;
  unit: string;
  reorderThreshold?: number;
};
export type UpdateItemBody = { name?: string; reorderThreshold?: number };
export type RestockBody = {
  itemKey: string;
  category: string;
  name: string;
  unit: string;
  qty: number;
  lotNumber?: string;
  receivedDate?: string;
  expirationDate?: string;
};
export type AdjustBody = { itemId: number; qtyDelta: number; note?: string };
export type InventorySettings = { expirySoonDays: number };

// ── Photo stock intake (AI vision) ───────────────────────────────────────────
export type PhotoGuess = {
  name: string;
  qty: number;
  unit: string;
  category: InventoryCategory;
  matchedKey: string | null;
  confidence: number;
};
export type IdentifyPhotoBody = {
  imageBase64: string;
  mimeType?: string;
  candidates?: CandidateItem[];
};

// Server rejects images whose base64 payload exceeds MAX_IMAGE_BASE64_CHARS
// (8M chars) with a 413. Clients downscale/compress to stay comfortably under
// this target so a 413 should never reach the user. The margin below the server
// cap leaves room for the rest of the JSON body (candidates, etc.).
export const MAX_IMAGE_BASE64_CHARS = 7_000_000;

// iPhones often hand the web file picker a HEIC/HEIF photo, which most desktop
// browsers can't decode via <img>/canvas. Detect it (MIME type is often blank
// for HEIC, so fall back to the filename extension) so we can show actionable
// guidance instead of a cryptic "Failed to load image".
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

// ── Staff roles / access control ─────────────────────────────────────────────
export type Role = "manager" | "operator";
export type StaffMember = {
  userId: string;
  role: Role;
  email: string | null;
  name: string | null;
};
export const fetchMe = () => api<StaffMember>("/me");

// Auth — username + password. On the web the server sets an httpOnly `rc_auth`
// session cookie, which same-origin fetches send automatically, so we ignore the
// token in the response body and rely on the cookie for subsequent requests.
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
export const changePasswordRequest = (
  currentPassword: string,
  newPassword: string,
) =>
  api<null>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

export const fetchStaff = () => api<StaffMember[]>("/users");
export const setStaffRole = (userId: string, role: Role) =>
  api<StaffMember>(`/users/${encodeURIComponent(userId)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
export const resetStaffPassword = (userId: string, newPassword: string) =>
  api<null>(`/users/${encodeURIComponent(userId)}/password`, {
    method: "PUT",
    body: JSON.stringify({ newPassword }),
  });
export const deleteStaffMember = (userId: string) =>
  api<null>(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });

// ── Forgot-password recovery (manager-approved) ──────────────────────────────
// There is no email/SMS channel, so a locked-out user requests a reset, a
// manager approves it and is shown a single-use relay code once, and the user
// enters that code with a new password.
export type PasswordResetRequestItem = {
  id: string;
  userId: string;
  username: string;
  requestedAt: string;
};
export type ApproveResetResult = {
  username: string;
  code: string;
  expiresAt: string;
};

// Public (signed-out). Always resolves to { ok: true } regardless of whether the
// username exists, so it can't be used to discover accounts.
export const forgotPasswordRequest = (username: string) =>
  api<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ username }),
  });

// Public (signed-out). Throws InventoryApiError(401) when the code is wrong,
// expired, or already used.
export const resetPasswordRequest = (
  username: string,
  code: string,
  newPassword: string,
) =>
  api<null>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ username, code, newPassword }),
  });

// Manager-only.
export const fetchPasswordResetRequests = () =>
  api<PasswordResetRequestItem[]>("/password-reset-requests");
export const approvePasswordReset = (id: string) =>
  api<ApproveResetResult>(
    `/password-reset-requests/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
  );
export const declinePasswordReset = (id: string) =>
  api<null>(
    `/password-reset-requests/${encodeURIComponent(id)}/decline`,
    { method: "POST" },
  );

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
export const consumeRun = (runId: string, lines: ConsumeLine[]) =>
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
export const mergeInventory = (merges: MergeInventoryLine[]) =>
  api<MergeInventoryResult>("/inventory/merge", {
    method: "POST",
    body: JSON.stringify({ merges }),
  });
