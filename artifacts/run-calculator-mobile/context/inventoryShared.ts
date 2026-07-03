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
import type { RunSettings } from "./RunContext";
import { DEFAULT_PEP_TYPES } from "./RunContext";
import {
  computeRunLines as computeRunLinesShared,
  computeRunConsumptionLines as computeRunConsumptionLinesShared,
  deriveCandidateItems as deriveCandidateItemsShared,
  aggregateRunDemand as aggregateRunDemandShared,
  computeTransferNeeds,
  computeReorderList as computeReorderListShared,
  computeUseFirstList as computeUseFirstListShared,
  applySubstitutions as applySubstitutionsShared,
  type InventoryCategory,
  type ConsumeLine,
  type CandidateItem,
  type RunLine,
  type TransferNeed,
  type TransferDemand,
  type ReorderInput,
  type ReorderItem,
  type UseFirstItemInput,
  type UseFirstEntry,
  type LocationStock as LocationStockMath,
  type IngredientSubstitution,
  type SubstitutionAction,
  type SubstitutionLogEntry,
} from "@workspace/inventory-math";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { notifyUnauthorized } from "./authEvents";

// Consumption/summary math now lives in @workspace/inventory-math (shared with
// the web app so the two can't drift). Re-export the types so this module's
// public surface stays stable for existing mobile call sites (they're also
// imported above for use within this file). RunSettings already uses the lib's
// canonical `doughballWeightOz` field name, so it is passed straight through;
// only DEFAULT_PEP_TYPES is injected (owned per-app).
export type { InventoryCategory, ConsumeLine, CandidateItem, RunLine, TransferNeed, ReorderItem, IngredientSubstitution, SubstitutionAction, SubstitutionLogEntry };

// Overlay today's temporary substitutions onto a run's settings before computing
// totals/consumption. Pure (clones) so the override reverts cleanly when subs are
// cleared. Recipe arrays + type fields share the lib's field-name contract, so
// RunSettings is passed straight through (cast around the generic constraint).
export function overlaySettings(
  settings: RunSettings,
  subs: IngredientSubstitution[] | undefined,
): RunSettings {
  if (!subs || subs.length === 0) return settings;
  return applySubstitutionsShared(
    settings as unknown as Record<string, unknown>,
    subs,
  ) as unknown as RunSettings;
}

// ── Types (mirror the API server's inventory responses) ──────────────────────

export interface InventoryLot {
  id: number;
  itemId: number;
  locationId: number | null;
  lotNumber: string;
  qtyReceived: number;
  qtyRemaining: number;
  receivedDate: string | null;
  expirationDate: string | null;
  createdAt: string;
}

// One location's on-hand for a given item. Null-location (legacy) stock folds
// into the onsite row server-side.
export interface LocationStock {
  locationId: number;
  locationName: string;
  isOnsite: boolean;
  onHand: number;
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
  byLocation: LocationStock[];
}

// A named storage location. `isOnsite` marks the single location production
// deducts from; there is always exactly one onsite location.
export interface InventoryLocation {
  id: number;
  name: string;
  isOnsite: boolean;
  createdAt: string;
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

// ── Per-run consumption mapping (shared with web via @workspace/inventory-math) ─
// Thin wrappers so existing mobile call sites keep their `RunSettings`
// signatures; the formulas live in the shared lib.
export const computeRunLines = (s: RunSettings) =>
  computeRunLinesShared(s, DEFAULT_PEP_TYPES);

export const computeRunConsumptionLines = (s: RunSettings) =>
  computeRunConsumptionLinesShared(s, DEFAULT_PEP_TYPES);

export const deriveCandidateItems = (settingsList: RunSettings[]) =>
  deriveCandidateItemsShared(settingsList, DEFAULT_PEP_TYPES);

// ── Transfer-warning wiring (shared math) ────────────────────────────────────
// Roll the planned + scheduled runs up into total material demand (same keys as
// auto-deduction), then compare against per-location stock. Returns the items
// where the onsite/line location can't cover demand while another location holds
// transferable stock. Mirrors the web app exactly so warnings can't drift.
export const aggregateRunDemand = (settingsList: RunSettings[]): RunLine[] =>
  aggregateRunDemandShared(settingsList, DEFAULT_PEP_TYPES);

// Build the per-key location-stock map computeTransferNeeds expects from the
// inventory items' byLocation breakdown.
export function buildStockByKey(items: InventoryItem[]): Record<string, LocationStockMath[]> {
  const out: Record<string, LocationStockMath[]> = {};
  for (const it of items) out[it.key] = it.byLocation;
  return out;
}

// Top-level convenience: given the day's runs and current inventory, return the
// transfer warnings. Pure aside from reading its inputs.
export function computeRunTransferNeeds(
  settingsList: RunSettings[],
  items: InventoryItem[],
): TransferNeed[] {
  const demands = aggregateRunDemand(settingsList) as TransferDemand[];
  return computeTransferNeeds({ demands, stockByKey: buildStockByKey(items) });
}

// Map an inventory item to the shared reorder input shape (item.category is a
// plain string on the API type; the lib uses the InventoryCategory union).
function toReorderInput(it: InventoryItem): ReorderInput {
  return {
    key: it.key,
    name: it.name,
    unit: it.unit,
    category: it.category as InventoryCategory,
    onHand: it.onHand,
    reorderThreshold: it.reorderThreshold,
  };
}

// Roll a list of resolved scheduled runs up into a per-item-key demand map (the
// SAME aggregation the reorder card uses). Shared so the warehouse "Reorder Now"
// card and the proactive reorder nudge subtract identical demand and can never
// disagree (replit.md parity). The proactive nudge sends this map to the server.
export function buildReorderDemandByKey(
  scheduledSettingsList: RunSettings[],
): Record<string, number> {
  const demandByKey: Record<string, number> = {};
  for (const d of aggregateRunDemand(scheduledSettingsList)) demandByKey[d.key] = d.qty;
  return demandByKey;
}

// Top-level convenience: given current inventory and the upcoming scheduled runs
// (resolved to their RunSettings via brand profiles), return the items that have
// dropped to/below their reorder threshold once projected scheduled demand is
// subtracted, each with a suggested reorder quantity. Demand is aggregated on
// the SAME basis as the transfer warnings, so web and mobile flag identically.
// Advisory only — never writes stock.
export function computeRunReorderList(
  items: InventoryItem[],
  scheduledSettingsList: RunSettings[],
): ReorderItem[] {
  return computeReorderListShared(items.map(toReorderInput), buildReorderDemandByKey(scheduledSettingsList));
}

// Re-export the use-first entry type for the card.
export type { UseFirstEntry };

// Map an inventory item (with lots) to the shared use-first input shape.
function toUseFirstItem(it: InventoryItem): UseFirstItemInput {
  return {
    key: it.key,
    name: it.name,
    unit: it.unit,
    category: it.category as InventoryCategory,
    lots: it.lots.map((l) => ({
      qtyRemaining: l.qtyRemaining,
      expirationDate: l.expirationDate,
      locationId: l.locationId,
    })),
  };
}

// Top-level convenience: given current inventory, the storage locations, the
// configured "expiring soon" window, and the runs active/scheduled for today,
// return the at-risk lots to use first (FEFO, today's items prioritized). The
// today-item basis is aggregated on the SAME keys as auto-deduction, so web and
// mobile list and order lots identically. Advisory only — never writes stock.
export function computeRunUseFirstList(
  items: InventoryItem[],
  locations: InventoryLocation[],
  soonDays: number,
  todaySettingsList: RunSettings[],
): UseFirstEntry[] {
  const todayItemKeys = aggregateRunDemand(todaySettingsList).map((d) => d.key);
  return computeUseFirstListShared({
    items: items.map(toUseFirstItem),
    locations: locations.map((l) => ({ id: l.id, name: l.name, isOnsite: l.isOnsite })),
    soonDays,
    todayItemKeys,
  });
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
    // A 401 on an already-signed-in request means the session ended (typically
    // the daily reset advanced the server-side boundary). Sign-in/up failures
    // and the signed-out /me probe are not session expiries, so exclude them.
    if (
      res.status === 401 &&
      path !== "/me" &&
      !path.startsWith("/auth/")
    ) {
      notifyUnauthorized();
    }
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
  locationId?: number;
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
export interface StaffMember {
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
}
export const fetchMe = () => api<StaffMember>("/me");
// Mark the first-login "Get Started" overview as seen. Returns the updated
// StaffMember so the caller can refresh its cached identity.
export const markOnboardingSeenRequest = () =>
  api<StaffMember>("/me/onboarding-seen", { method: "POST" });
// Mark the guided tour as completed (user reached its final step). Returns the
// updated StaffMember so the caller can refresh its cached identity.
export const markTourCompletedRequest = () =>
  api<StaffMember>("/me/tour-completed", { method: "POST" });

// Auth — username + password. Mobile has no cookie jar, so the server's session
// token is returned in the response body; the auth context persists it in
// expo-secure-store and replays it as a bearer header via setAuthTokenGetter.
export type AuthResult = { token: string; user: StaffMember };
export const signUpRequest = (
  username: string,
  password: string,
  accessCode: string,
) =>
  api<AuthResult>("/auth/sign-up", {
    method: "POST",
    body: JSON.stringify({ username, password, accessCode }),
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
export const declinePasswordReset = (id: string) =>
  api<null>(
    `/password-reset-requests/${encodeURIComponent(id)}/decline`,
    { method: "POST" },
  );
export const approvePasswordReset = (id: string) =>
  api<ApproveResetResult>(
    `/password-reset-requests/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
  );

// ── Incidents: report an issue / crash + AI diagnosis ────────────────────────
// Mirrors the web inventoryShared incident helpers; behaviour identical, only
// the transport differs (mobile threads a bearer token via the shared `api`).
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

// Manager-only AI root-cause clustering across the incident log. Advisory and
// read-only: the server reads the incidents itself, the AI only proposes the
// grouping, and a deterministic grouping is returned if the AI is unavailable.
// EXACT mirror of the web wrapper (replit.md parity).
export type IncidentClusterSeverity = "low" | "medium" | "high";
export type IncidentCluster = {
  theme: string;
  rootCauseHypothesis: string;
  recommendedAction: string;
  severity: IncidentClusterSeverity;
  incidentIds: string[];
  incidentCount: number;
};
export type IncidentClustersResult = {
  clusters: IncidentCluster[];
  totalIncidents: number;
  note?: string;
  generatedAt: number;
  aiGenerated: boolean;
};
export const requestIncidentClusters = (lookbackDays?: number) =>
  api<IncidentClustersResult>("/ai/incident-clusters", {
    method: "POST",
    body: JSON.stringify(lookbackDays ? { lookbackDays } : {}),
  });

// AI predictive-maintenance / anomaly flags. Drift detection (downtime/yield/
// stoppages vs. a per-product baseline) is deterministic server-side; the AI
// only narrates flagged anomalies. Advisory and read-only. Open to all staff.
// EXACT mirror of the web wrapper (replit.md parity).
export type AnomalyMetric = "downtime" | "yield" | "stoppages";
export type AnomalySeverity = "low" | "medium" | "high";
export type AnomalyRunInput = {
  brand: string;
  flavor: string;
  casesPlanned: number;
  casesProduced: number;
  downtimeMinutes: number;
  stoppageCount: number;
};
export type Anomaly = {
  runLabel: string;
  brand: string;
  flavor: string;
  metric: AnomalyMetric;
  observed: number;
  baseline: number;
  severity: AnomalySeverity;
  baselineSamples: number;
  description: string;
};
export type AnomalyResult = {
  anomalies: Anomaly[];
  checkedRuns: number;
  baselineRuns: number;
  summary: string;
  note?: string;
  generatedAt: number;
  aiGenerated: boolean;
};
export const requestAnomalies = (
  today: AnomalyRunInput[],
  history: AnomalyRunInput[],
) =>
  api<AnomalyResult>("/ai/anomalies", {
    method: "POST",
    body: JSON.stringify({ today, history }),
  });

// AI schedule optimizer. The suggested run order (allergen runs end-of-day,
// similar brand/die grouped to cut changeovers, factory sequence rules honored)
// is computed deterministically server-side; the AI only narrates it, and only
// when a strictly better order exists. Advisory and read-only — the manager
// applies it through the normal move path. Manager-gated.
export type ScheduleAllergen = "none" | "egg" | "soy";
export type ScheduleRunInput = {
  id: string;
  label: string;
  brand: string;
  flavor: string;
  allergen: ScheduleAllergen;
  dieType?: string;
};
export type ScheduleMetrics = {
  allergenViolations: number;
  ruleViolations: number;
  changeovers: number;
};
export type ScheduleOptimizeResult = {
  order: string[];
  changed: boolean;
  improved: boolean;
  before: ScheduleMetrics;
  after: ScheduleMetrics;
  summary: string;
  note?: string;
  generatedAt: number;
  aiGenerated: boolean;
};
export const requestScheduleOptimize = (
  runs: ScheduleRunInput[],
  rules?: unknown[],
) =>
  api<ScheduleOptimizeResult>("/ai/schedule-optimize", {
    method: "POST",
    body: JSON.stringify({ runs, rules: rules ?? [] }),
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

// ── AI quality/defect photo check (read-only) ────────────────────────────────
// Mirrors the web glue (replit.md parity).
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

// ── AI production-sheet photo → run rows (read-only, advisory) ───────────────
export type ProductionSheetRow = {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  date: string | null;
  confidence: number;
};
export type ProductionSheetPhotoResult = {
  rows: ProductionSheetRow[];
  generatedAt: number;
  note?: string;
};
export type ProductionSheetPhotoBody = {
  imageBase64: string;
  mimeType?: string;
  notes?: string;
};

// Read-only: transcribes the run rows from a paper production sheet. Never
// writes anything; the user confirms which rows to add through the existing
// schedule path.
export const productionSheetPhoto = (body: ProductionSheetPhotoBody) =>
  api<ProductionSheetPhotoResult>("/inventory/production-sheet-photo", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── AI label / pallet verification (read-only, advisory) ─────────────────────
export type LabelVerdict = "pass" | "warn" | "fail";
export type LabelFieldMatch = "match" | "mismatch" | "unreadable";
export type LabelExpected = {
  brand?: string;
  flavor?: string;
  dieType?: string;
  date?: string;
  lotCode?: string;
  caseCount?: number;
};
export type LabelFieldCheck = {
  field: string;
  expected: string | null;
  observed: string | null;
  match: LabelFieldMatch;
};
export type LabelVerifyResult = {
  verdict: LabelVerdict;
  summary: string;
  confidence: number;
  fields: LabelFieldCheck[];
  generatedAt: number;
  note?: string;
};
export type LabelVerifyBody = {
  imageBase64: string;
  mimeType?: string;
  expected?: LabelExpected;
  notes?: string;
};

// Read-only: compares a label/pallet photo against expected values. The overall
// verdict is recomputed server-side from the per-field results; nothing is
// written.
export const verifyLabelPhoto = (body: LabelVerifyBody) =>
  api<LabelVerifyResult>("/inventory/label-verify", {
    method: "POST",
    body: JSON.stringify(body),
  });

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
// aliases. Open to any signed-in user (no manager gate), best-effort. Mirrors
// the web glue (replit.md parity).
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

// ── SSE response reader (for opt-in streaming AI chat) ──────────────────────
// Mirrors web's postEventStream: POST asking for `text/event-stream`, stream
// answer text via onDelta from `delta` events, resolve with the final payload
// from the single `done` event, and throw an InventoryApiError on an `error`
// event or any transport/non-OK failure so the caller falls back to non-stream.
// Expo web has a streaming fetch body (getReader); native RN does not, so it
// uses react-native-sse with a POST body exactly like openInventoryStream.
function parseSseFrameMobile(frame: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

export async function postEventStream<T>(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  failMessage: string,
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const url = `${base}/api${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-client-id": clientId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const payloadStr = JSON.stringify(body);

  // Expo web: stream the fetch body with a reader, same as the web app.
  if (
    Platform.OS === "web" &&
    typeof globalThis !== "undefined" &&
    "ReadableStream" in globalThis
  ) {
    const res = await fetch(url, { method: "POST", headers, body: payloadStr });
    if (!res.ok || !res.body) {
      if (res.status === 401) notifyUnauthorized();
      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfterSec =
        retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
      let serverMessage: string | null = null;
      try {
        const errBody = (await res.json()) as { error?: unknown };
        if (errBody && typeof errBody.error === "string") serverMessage = errBody.error;
      } catch {
        /* ignore */
      }
      throw new InventoryApiError(res.status, failMessage, retryAfterSec, serverMessage);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: T | null = null;
    let streamError: string | null = null;
    const handleFrame = (frame: string): void => {
      if (!frame.trim()) return;
      const { event, data } = parseSseFrameMobile(frame);
      if (event === "delta") {
        try {
          const d = JSON.parse(data) as { text?: string };
          if (d.text) onDelta(d.text);
        } catch {
          /* ignore malformed delta */
        }
      } else if (event === "done") {
        try {
          done = JSON.parse(data) as T;
        } catch {
          streamError = "Stream ended without a result";
        }
      } else if (event === "error") {
        try {
          const d = JSON.parse(data) as { error?: string };
          streamError = d.error ?? "AI provider error";
        } catch {
          streamError = "AI provider error";
        }
      }
    };
    for (;;) {
      const { value, done: rdDone } = await reader.read();
      if (rdDone) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        handleFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    if (buffer.trim()) handleFrame(buffer);
    if (streamError) throw new InventoryApiError(502, failMessage, null, streamError);
    if (done == null)
      throw new InventoryApiError(502, failMessage, null, "Stream ended without a result");
    return done;
  }

  // Native: react-native-sse with a POST body (RN fetch can't stream a body).
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const RNEventSource = require("react-native-sse").default as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => {
      addEventListener: (type: string, listener: (event: SseMessageEvent) => void) => void;
      close: () => void;
    };
    const es = new RNEventSource(url, {
      method: "POST",
      headers,
      body: payloadStr,
      pollingInterval: 0,
    });
    const fail = (message: string, status = 502): void => {
      if (settled) return;
      settled = true;
      es.close();
      reject(new InventoryApiError(status, failMessage, null, message));
    };
    es.addEventListener("delta", (event: SseMessageEvent) => {
      if (settled || !event.data) return;
      try {
        const d = JSON.parse(event.data) as { text?: string };
        if (d.text) onDelta(d.text);
      } catch {
        /* ignore malformed delta */
      }
    });
    es.addEventListener("done", (event: SseMessageEvent) => {
      if (settled) return;
      try {
        const payload = JSON.parse(event.data ?? "") as T;
        settled = true;
        es.close();
        resolve(payload);
      } catch {
        fail("Stream ended without a result");
      }
    });
    // react-native-sse routes both server `event: error` frames (which carry
    // .data) and transport errors to "error" listeners; either way we fall back.
    es.addEventListener("error", (event: SseMessageEvent) => {
      if (settled) return;
      if (event.data) {
        try {
          const d = JSON.parse(event.data) as { error?: string };
          fail(d.error ?? "AI provider error");
          return;
        } catch {
          /* fall through to generic */
        }
      }
      fail("AI provider error");
    });
  });
}
