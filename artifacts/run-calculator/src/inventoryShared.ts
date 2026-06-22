import type { FormValues } from "./types";
import { DEFAULT_PEP_TYPES } from "./types";
import { withSubstitutions } from "./substitutionState";
import {
  computeRunLines as computeRunLinesShared,
  computeRunConsumptionLines as computeRunConsumptionLinesShared,
  deriveCandidateItems as deriveCandidateItemsShared,
  aggregateRunDemand as aggregateRunDemandShared,
  computeTransferNeeds,
  type RunLinesInput,
  type InventoryCategory,
  type ConsumeLine,
  type CandidateItem,
  type RunLine,
  type TransferNeed,
  type TransferDemand,
} from "@workspace/inventory-math";

// Consumption/summary math now lives in @workspace/inventory-math (shared with
// mobile so the two can't drift). Re-export the types so this module's public
// surface stays stable for existing web call sites (they're also imported above
// for use within this file).
export type { InventoryCategory, ConsumeLine, CandidateItem, RunLine, TransferNeed };

// Web `FormValues` uses `targetDoughballWeight`; the shared lib's canonical
// field name is `doughballWeightOz`. Map it here so the formulas stay shared.
function toRunLinesInput(vals: FormValues): RunLinesInput {
  // Overlay today's substitutions (if any) BEFORE mapping to the shared input,
  // so consumption keys (ingredient:<Name>:lbs|batches) reflect the swap/add/
  // remove for every run that contains the affected ingredient.
  const v = withSubstitutions(vals);
  return { ...v, doughballWeightOz: v.targetDoughballWeight };
}

// ── Types (mirror the API server's inventory responses) ──────────────────────

export type InventoryLot = {
  id: number;
  itemId: number;
  locationId: number | null;
  lotNumber: string;
  qtyReceived: number;
  qtyRemaining: number;
  receivedDate: string | null;
  expirationDate: string | null;
  createdAt: string;
};

// One location's on-hand for a given item. Null-location (legacy) stock folds
// into the onsite row server-side.
export type LocationStock = {
  locationId: number;
  locationName: string;
  isOnsite: boolean;
  onHand: number;
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
  byLocation: LocationStock[];
};

// A named storage location. `isOnsite` marks the single location production
// deducts from; there is always exactly one onsite location.
export type InventoryLocation = {
  id: number;
  name: string;
  isOnsite: boolean;
  createdAt: string;
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

// ── Per-run consumption mapping ──────────────────────────────────────────────
// Thin wrappers over @workspace/inventory-math so existing web call sites keep
// their `FormValues` signatures; the formulas (shared with mobile) live there.
export const computeRunLines = (vals: FormValues) =>
  computeRunLinesShared(toRunLinesInput(vals), DEFAULT_PEP_TYPES);

export const computeRunConsumptionLines = (vals: FormValues) =>
  computeRunConsumptionLinesShared(toRunLinesInput(vals), DEFAULT_PEP_TYPES);

export const deriveCandidateItems = (valsList: FormValues[]) =>
  deriveCandidateItemsShared(valsList.map(toRunLinesInput), DEFAULT_PEP_TYPES);

// ── Transfer-warning wiring (shared math) ────────────────────────────────────
// Roll the planned + scheduled runs up into total material demand (same keys as
// auto-deduction), then compare against per-location stock. Returns the items
// where the onsite/line location can't cover demand while another location holds
// transferable stock. Mobile mirrors this exactly so warnings can't drift.
export const aggregateRunDemand = (valsList: FormValues[]): RunLine[] =>
  aggregateRunDemandShared(valsList.map(toRunLinesInput), DEFAULT_PEP_TYPES);

// Build the per-key location-stock map computeTransferNeeds expects from the
// inventory items' byLocation breakdown.
export function buildStockByKey(items: InventoryItem[]): Record<string, LocationStock[]> {
  const out: Record<string, LocationStock[]> = {};
  for (const it of items) out[it.key] = it.byLocation;
  return out;
}

// Top-level convenience: given the day's runs and current inventory, return the
// transfer warnings. Pure aside from reading its inputs.
export function computeRunTransferNeeds(
  valsList: FormValues[],
  items: InventoryItem[],
): TransferNeed[] {
  const demands = aggregateRunDemand(valsList) as TransferDemand[];
  return computeTransferNeeds({ demands, stockByKey: buildStockByKey(items) });
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
  locationId?: number;
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

// ── AI quality/defect photo check (read-only) ────────────────────────────────
export type QualityProductType = "pizza" | "crust" | "other";
export type QualitySeverity = "minor" | "major" | "critical";
export type QualityStatus = "pass" | "warn" | "fail";

export type QualityIssue = {
  type: string;
  severity: QualitySeverity;
  detail: string;
};
export type QualityAssessment = {
  summary: string;
  status: QualityStatus;
  confidence: number;
  issues: QualityIssue[];
};
export type QualityCheckResult = {
  assessment: QualityAssessment;
  generatedAt: number;
  note?: string;
};
export type QualityCheckBody = {
  imageBase64: string;
  mimeType?: string;
  productType?: QualityProductType;
  notes?: string;
};

// Read-only: asks the AI to assess a finished pizza/crust photo. Never records
// anything; confirming an outcome is a separate user-driven write to facility
// memory.
export const qualityCheckPhoto = (body: QualityCheckBody) =>
  api<QualityCheckResult>("/inventory/quality-photo", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Quality check history (persisted, manager-reviewed records) ──────────────
export type QualityCheckRecord = {
  id: number;
  productType: QualityProductType;
  status: QualityStatus;
  confidence: number;
  summary: string;
  issues: QualityIssue[];
  notes: string | null;
  thumbnail: string | null;
  reviewerName: string | null;
  createdAt: string;
};
export type QualityCheckRecordBody = {
  productType: QualityProductType;
  status: QualityStatus;
  confidence: number;
  summary: string;
  issues: QualityIssue[];
  notes?: string;
  thumbnail?: string;
};

// Persist a reviewed-and-confirmed quality check into the manager history.
// Manager-only; the advisory quality-photo endpoint never writes.
export const recordQualityCheck = (body: QualityCheckRecordBody) =>
  api<QualityCheckRecord>("/inventory/quality-checks", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Manager-only: list past quality checks (newest first), optionally filtered by
// product type and/or status.
export const fetchQualityChecks = (filter?: {
  productType?: QualityProductType;
  status?: QualityStatus;
}) => {
  const params = new URLSearchParams();
  if (filter?.productType) params.set("productType", filter.productType);
  if (filter?.status) params.set("status", filter.status);
  const qs = params.toString();
  return api<QualityCheckRecord[]>(`/inventory/quality-checks${qs ? `?${qs}` : ""}`);
};

// ── AI expiry & waste insight ────────────────────────────────────────────────
export type WasteStatus = "expired" | "soon";
export type WasteInsightItem = {
  key: string;
  name: string;
  category: string;
  unit: string;
  status: WasteStatus;
  qtyAtRisk: number;
  earliestExpiration: string | null;
  daysUntilExpiry: number | null;
};
export type WasteInsightResult = {
  flagged: WasteInsightItem[];
  suggestion: string | null;
  generatedAt: number;
  note?: string;
};
export type WasteInsightBody = {
  plannedItems?: CandidateItem[];
};

// Server flags expiring/expired stock and (when anything is at risk) asks the AI
// for a run-order suggestion to consume it first. Advisory only.
export const wasteInsight = (body: WasteInsightBody = {}) =>
  api<WasteInsightResult>("/inventory/waste-insight", {
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

// ── Photo identifier learned aliases (server-persisted, factory-wide) ─────────
// When a user confirms that a photo guess (e.g. "Hormel Pepperoni") maps to a
// specific inventory item, that guessName -> itemKey link is remembered here so
// future scans auto-apply the match — the same pattern as learned import
// aliases. Open to any signed-in user (no manager gate), best-effort.
export type PhotoAlias = { guessName: string; itemKey: string };

export const fetchPhotoAliases = () =>
  api<{ aliases: PhotoAlias[] }>("/photo-aliases").then((d) => d.aliases ?? []);

export const savePhotoAliases = (aliases: PhotoAlias[]) =>
  aliases.length === 0
    ? Promise.resolve()
    : api<void>("/photo-aliases", {
        method: "POST",
        body: JSON.stringify({ aliases }),
      }).then(() => undefined);

// Pure helper: given a guessed name and the learned aliases, return the matched
// itemKey IF one is remembered AND that item still exists among the current
// candidates (items can be deleted/renamed, so a stale alias must be ignored).
// Case-insensitive on guessName, mirroring the server upsert. Returns null when
// there is no usable learned match.
export function applyPhotoAliases(
  guessName: string,
  aliases: ReadonlyArray<PhotoAlias>,
  candidates: ReadonlyArray<CandidateItem>,
): string | null {
  const g = guessName.trim().toLowerCase();
  if (!g) return null;
  const hit = aliases.find((a) => a.guessName.trim().toLowerCase() === g);
  if (!hit) return null;
  return candidates.some((c) => c.key === hit.itemKey) ? hit.itemKey : null;
}

// ── Staff roles / access control ─────────────────────────────────────────────
// Roles are now data-driven: a role is just a name plus a set of capabilities.
// The server seeds built-in + default editable roles and managers can create,
// edit, and delete roles. Access is gated on capabilities, not role names.
export type Role = string;
export const CAPABILITIES = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "manage-staff": "Manage staff & roles",
  "manage-inventory": "Manage inventory",
  "edit-production-rules": "Edit production rules",
  "approve-password-resets": "Approve password resets",
  "review-incidents": "Review incidents",
  "use-ai-tools": "Use AI tools",
};
export type RoleDefinition = {
  name: string;
  capabilities: Capability[];
  builtin: boolean;
};
export type StaffMember = {
  userId: string;
  role: Role;
  capabilities: Capability[];
  email: string | null;
  name: string | null;
  onboardingSeen: boolean;
  tourCompleted: boolean;
  // True only for the seeded sandbox account, which operates in the isolated
  // "sandbox" data scope. Clients show a persistent banner and a "Reset
  // sandbox" action when this is set.
  sandbox: boolean;
  // ISO timestamp of when the sandbox was last re-copied from live (null until
  // the first copy). Shown in the banner as "Sandbox copied from live at …".
  sandboxCopiedAt: string | null;
  // True when the sandbox copy is stale and due for an automatic refresh. The
  // server owns the staleness cutoff; the client reacts by running the same
  // reset-and-reload flow as the manual "Reset sandbox" button.
  sandboxStale: boolean;
};
export const fetchMe = () => api<StaffMember>("/me");
// Mark the first-login "Get Started" overview as seen. Returns the updated
// StaffMember so the caller can refresh its cached identity.
export const markOnboardingSeenRequest = () =>
  api<StaffMember>("/me/onboarding-seen", { method: "POST" });
// Mark the guided tour as completed (user reached its final step). Returns the
// updated StaffMember so the caller can refresh its cached identity.
export const markTourCompletedRequest = () =>
  api<StaffMember>("/me/tour-completed", { method: "POST" });

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
// Public (signed-out). Read-only lookup behind the live sign-up hint; resolves
// to { available } so the form can warn before submit when a name is taken.
export const checkUsernameAvailable = (username: string) =>
  api<{ available: boolean }>(
    `/auth/username-available?username=${encodeURIComponent(username)}`,
  );
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

// Re-copy live → sandbox. Only succeeds for a sandbox session (the server
// returns 403 otherwise), so it can never touch live factory data.
export const resetSandboxRequest = () =>
  api<{ ok: true }>("/sandbox/reset", { method: "POST" });

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

// Role catalog management (manage-staff). Managers list/create/edit/delete the
// roles that can be assigned to staff.
export const fetchRoles = () => api<RoleDefinition[]>("/roles");
export const createRoleRequest = (name: string, capabilities: Capability[]) =>
  api<RoleDefinition>("/roles", {
    method: "POST",
    body: JSON.stringify({ name, capabilities }),
  });
// Edit a role's capabilities and, optionally, rename it. Pass `newName` (the
// role's new name) to rename; the server rewrites the role and every staff
// assignment together. Built-in roles can't be renamed.
export const updateRoleRequest = (
  name: string,
  capabilities: Capability[],
  newName?: string,
) =>
  api<RoleDefinition>(`/roles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(
      newName !== undefined && newName !== name
        ? { capabilities, name: newName }
        : { capabilities },
    ),
  });
export const deleteRoleRequest = (name: string) =>
  api<null>(`/roles/${encodeURIComponent(name)}`, { method: "DELETE" });

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

// ── Locations (named storage) + transfers ────────────────────────────────────
export type CreateLocationBody = { name: string; isOnsite?: boolean };
export type UpdateLocationBody = { name?: string; isOnsite?: boolean };
export type TransferBody = {
  itemId: number;
  fromLocationId: number;
  toLocationId: number;
  qty: number;
};

export const fetchInventoryLocations = () =>
  api<InventoryLocation[]>("/inventory/locations");
export const createInventoryLocation = (body: CreateLocationBody) =>
  api<InventoryLocation>("/inventory/locations", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const updateInventoryLocation = (id: number, body: UpdateLocationBody) =>
  api<InventoryLocation>(`/inventory/locations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const deleteInventoryLocation = (id: number) =>
  api<null>(`/inventory/locations/${id}`, { method: "DELETE" });
// Move stock between two locations. Returns the updated item (with fresh
// per-location on-hand) so callers can refresh without a separate fetch.
export const transferInventory = (body: TransferBody) =>
  api<InventoryItem>("/inventory/transfer", {
    method: "POST",
    body: JSON.stringify(body),
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

// ── Incidents: report an issue / crash + AI diagnosis ────────────────────────
export type IncidentSource = "user_report" | "auto_crash";
export type IncidentContext = {
  description?: string;
  errorMessage?: string;
  errorStack?: string;
  userAgent?: string;
};
export type ReportIncidentBody = {
  source: IncidentSource;
  screen: string;
  appPlatform: "web" | "mobile";
  appVersion?: string;
  description?: string;
  errorMessage?: string;
  errorStack?: string;
  userAgent?: string;
};
// "Seen before" signal: how many prior similar incidents were found and the
// recovery step that helped previously. Null when the problem has no precedent.
export type IncidentRecurrence = {
  count: number;
  lastWorkaround: string | null;
};
export type IncidentDiagnosis = {
  incidentId: string;
  diagnosis: string;
  workaround: string;
  recurrence: IncidentRecurrence | null;
};
export type Incident = {
  id: string;
  source: IncidentSource;
  reporterId: string | null;
  reporterName: string | null;
  reporterRole: string | null;
  screen: string;
  appPlatform: string;
  appVersion: string | null;
  context: IncidentContext;
  diagnosis: string | null;
  workaround: string | null;
  recurrence: IncidentRecurrence | null;
  status: "new" | "reviewed" | "resolved";
  createdAt: string;
  reviewedAt: string | null;
  resolvedAt: string | null;
};

// Report a problem (or auto-submit a crash) and get back a plain-language
// diagnosis + workaround. Allowed for any signed-in user.
export const reportIncident = (body: ReportIncidentBody) =>
  api<IncidentDiagnosis>("/incidents", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Manager-only review endpoints.
export const fetchIncidents = () => api<Incident[]>("/incidents");
export const fetchUnreviewedIncidentCount = () =>
  api<{ count: number }>("/incidents/unreviewed-count");
export const markIncidentReviewed = (id: string) =>
  api<Incident>(`/incidents/${encodeURIComponent(id)}/review`, { method: "POST" });
export const markIncidentResolved = (id: string) =>
  api<Incident>(`/incidents/${encodeURIComponent(id)}/resolve`, { method: "POST" });
