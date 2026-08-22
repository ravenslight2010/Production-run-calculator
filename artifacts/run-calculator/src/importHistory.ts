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
  importType: "spec" | "premix";
  snapshotId: number;
  requestId: number;
};

function headers(json = false): Record<string, string> {
  return {
    "x-client-id": inventoryClientId(),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
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

export async function recordImportHistory(input: {
  importType: ImportHistoryImportType;
  sourceKey?: string;
  sourceLabel: string;
  customerScope?: string;
  status: "complete" | "partial" | "failed";
  summary: ImportHistorySummary;
}): Promise<ImportHistoryItem> {
  const res = await fetch("/api/import-history", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Save import history failed (${res.status})`);
  const out = await res.json() as { import: ImportHistoryItem };
  return out.import;
}
