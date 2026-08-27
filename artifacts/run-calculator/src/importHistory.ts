import { inventoryClientId } from "./inventoryShared";

export type ImportHistorySummary = {
  phases?: Record<string, string>;
  counts?: Record<string, number>;
  source?: Record<string, number>;
  landed?: Record<string, number>;
  components?: Record<string, number>;
  links?: Record<string, number>;
  mismatches?: string[];
  warnings?: string[];
  unresolved?: string[];
  skipped?: string[];
  followUp?: string[];
  /** Bounded deterministic manifest retained with the import's saved snapshot. */
  changes?: Array<{ kind: string; entity: string; message: string }>;
  snapshotId?: number | null;
};

export type ImportHistoryItem = {
  id: number;
  importType: ImportHistoryImportType;
  sourceKey: string | null;
  sourceLabel: string;
  customerScope: string | null;
  status: "complete" | "partial" | "failed";
  summary: ImportHistorySummary;
  snapshotId: number | null;
  createdAt: number;
};

export type ImportHistoryImportType =
  | "spec" | "premix" | "cheese" | "sauce" | "dough" | "schedule" | "shipping" | "recipe";

export type ImportHistoryReopenRequest = {
  importType: "spec" | "premix" | "cheese";
  snapshotId: number;
  requestId: number;
};

export type ImportHistoryRecordInput = {
  importType: ImportHistoryImportType;
  sourceKey?: string;
  sourceLabel: string;
  customerScope?: string;
  status: "complete" | "partial" | "failed";
  summary: ImportHistorySummary;
  /** Client-created key used only to make a transport retry idempotent. */
  operationId?: string;
};

export const SUPPORTED_IMPORTERS: ReadonlyArray<{
  type: ImportHistoryImportType;
  label: string;
  description: string;
}> = [
  { type: "spec", label: "Pizza spec sheets", description: "AI-assisted product and recipe setup" },
  { type: "premix", label: "Premix sheets", description: "Mix formulas and freezer pulls" },
  { type: "cheese", label: "Cheese mix recipe specs", description: "Cheese recipes and recipe links" },
  { type: "shipping", label: "Shipping & palletizing guides", description: "Packaging profile patches" },
  { type: "sauce", label: "Sauce recipe guides", description: "Sauce assignments for saved profiles" },
  { type: "dough", label: "Dough recipe guides", description: "Dough assignments for saved profiles" },
  { type: "schedule", label: "Production schedules", description: "Reviewed production-day runs" },
];

export type ImportReconciliationRow = {
  label: string;
  source: number | null;
  landed: number | null;
  delta: number | null;
};

/**
 * Make the stored import metrics comparable without assuming that every
 * importer calls its entities by the same name. Rows with only one value are
 * intentionally shown as "not comparable" rather than inventing a zero.
 */
export function importReconciliationRows(summary: ImportHistorySummary): ImportReconciliationRow[] {
  const source = summary.source ?? {};
  const landed = summary.landed ?? {};
  const keys = [...new Set([...Object.keys(source), ...Object.keys(landed)])].sort((a, b) => a.localeCompare(b));
  return keys.map((label) => {
    const sourceValue = typeof source[label] === "number" ? source[label] : null;
    const landedValue = typeof landed[label] === "number" ? landed[label] : null;
    return {
      label,
      source: sourceValue,
      landed: landedValue,
      delta: sourceValue !== null && landedValue !== null ? landedValue - sourceValue : null,
    };
  });
}

export function requiredImportAction(item: Pick<ImportHistoryItem, "status" | "summary" | "snapshotId" | "importType">): string {
  const followUp = item.summary.followUp?.find((line) => line.trim());
  if (followUp) return followUp;
  if (item.status === "failed") return "Retry from the retained review, or choose the original source file again.";
  if (item.status === "partial") {
    return item.snapshotId != null && (item.importType === "spec" || item.importType === "premix" || item.importType === "cheese")
      ? "Reopen the saved review and resolve the outstanding items."
      : "Review the skipped or unresolved items before importing again.";
  }
  return "No action required. Reopen the retained review if you need to verify the result.";
}

function headers(json = false): Record<string, string> {
  return {
    "x-client-id": inventoryClientId(),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

class ImportHistoryPostError extends Error {
  constructor(readonly status: number) {
    super(`Save import history failed (${status})`);
  }
}

async function postImportHistory(input: ImportHistoryRecordInput): Promise<ImportHistoryItem> {
  const res = await fetch("/api/import-history", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ImportHistoryPostError(res.status);
  const out = await res.json() as { import: ImportHistoryItem };
  return out.import;
}

export async function fetchImportHistory(filters: {
  type?: string;
  status?: string;
  customer?: string;
} = {}): Promise<ImportHistoryItem[]> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
  const res = await fetch(`/api/import-history${qs.size ? `?${qs}` : ""}`, { headers: headers() });
  if (!res.ok) throw new Error(`List import history failed (${res.status})`);
  const out = await res.json() as { imports?: ImportHistoryItem[] };
  return out.imports ?? [];
}

type ImportHistoryIdentity = { scope: "live" | "sandbox"; userId: string };
let activeIdentity: ImportHistoryIdentity | null = null;
const PENDING_IMPORT_HISTORY_LIMIT = 12;

type PendingImportHistory = { input: Required<Pick<ImportHistoryRecordInput, "operationId">> & ImportHistoryRecordInput };

function pendingKey(identity: ImportHistoryIdentity): string {
  return `run-calculator.pending-import-history.v1.${identity.scope}.${identity.userId}`;
}

function readPending(identity: ImportHistoryIdentity): PendingImportHistory[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(pendingKey(identity)) ?? "[]");
    return Array.isArray(value) ? value.slice(0, PENDING_IMPORT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writePending(identity: ImportHistoryIdentity, records: PendingImportHistory[]): void {
  try {
    window.localStorage.setItem(pendingKey(identity), JSON.stringify(records.slice(-PENDING_IMPORT_HISTORY_LIMIT)));
  } catch {
    // The visible event still tells the manager that auditing was not saved.
  }
}

function createOperationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `import-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function queuePending(input: PendingImportHistory["input"]): void {
  if (typeof window === "undefined" || !activeIdentity) return;
  const existing = readPending(activeIdentity).filter((record) => record.input.operationId !== input.operationId);
  writePending(activeIdentity, [...existing, { input }]);
}

export function setImportHistoryIdentity(identity: ImportHistoryIdentity | null): void {
  activeIdentity = identity;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("import-history-pending"));
}

/** Number of recoverable audit writes for the active authenticated scope. */
export function pendingImportHistoryCount(): number {
  return typeof window !== "undefined" && activeIdentity ? readPending(activeIdentity).length : 0;
}

/** Retries only the current authenticated user's records in the active scope. */
export async function retryPendingImportHistory(): Promise<{ saved: number; remaining: number }> {
  if (typeof window === "undefined" || !activeIdentity) return { saved: 0, remaining: 0 };
  const pending = readPending(activeIdentity);
  const remaining: PendingImportHistory[] = [];
  let saved = 0;
  for (const record of pending) {
    try {
      await postImportHistory(record.input);
      saved += 1;
    } catch (error) {
      remaining.push(record);
      // A transient connection problem is unlikely to improve for later
      // records, and stopping preserves ordering for a bounded audit trail.
      if (!(error instanceof ImportHistoryPostError) || error.status >= 500) {
        remaining.push(...pending.slice(pending.indexOf(record) + 1));
        break;
      }
    }
  }
  writePending(activeIdentity, remaining);
  return { saved, remaining: remaining.length };
}

export async function recordImportHistory(input: ImportHistoryRecordInput): Promise<ImportHistoryItem> {
  const request = { ...input, operationId: input.operationId ?? createOperationId() };
  try {
    return await postImportHistory(request);
  } catch (error) {
    // Only retry failures that may be transient. The queue is scoped to the
    // authenticated user and server idempotency prevents timeout duplicates.
    if (!(error instanceof ImportHistoryPostError) || error.status >= 500) queuePending(request);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("import-history-pending"));
    throw error;
  }
}
