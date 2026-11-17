import { inventoryClientId } from "./inventoryShared";
import type { AttentionState } from "./attentionStates";

export type ActionItem = {
  id: number; scope: string; dedupKey: string;
  category: "incident" | "import" | "data-health" | "sync" | "production-rule" | "report";
  severity: "info" | "warning" | "error" | "urgent";
  attentionState?: AttentionState;
  nextAction?: string;
  title: string; description: string; sourceType: string; sourceId: string; sourcePath: string;
  status: "open" | "in_progress" | "deferred" | "resolved";
  assigneeId: string | null; assigneeName: string | null; deferReason: string | null; resolutionNote: string | null;
  createdAt: string; updatedAt: string; version: number;
};

export type ActionQueueDestination =
  | { kind: "tab"; tab: "incidents" | "summary" }
  | { kind: "manage"; category: "import" | "rules" | "audit" };

export function actionQueueDestination(item: Pick<ActionItem, "sourceType">): ActionQueueDestination {
  if (item.sourceType === "incident") return { kind: "tab", tab: "incidents" };
  if (item.sourceType === "sync") return { kind: "tab", tab: "summary" };
  if (item.sourceType === "import") return { kind: "manage", category: "import" };
  if (item.sourceType === "production-rule") return { kind: "manage", category: "rules" };
  return { kind: "manage", category: "audit" };
}

function headers(json = false): Record<string, string> {
  return { "x-client-id": inventoryClientId(), ...(json ? { "Content-Type": "application/json" } : {}) };
}

export async function fetchActionQueue(filters: {
  status?: string;
  category?: string;
  cursor?: string;
} = {}): Promise<{ items: ActionItem[]; counts: Record<string, number>; nextCursor?: string | null }> {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.cursor) params.set("cursor", filters.cursor);
  const query = params.toString();
  const response = await fetch(`/api/manager-action-queue${query ? `?${query}` : ""}`, { headers: headers() });
  if (!response.ok) throw new Error(`Load action queue failed (${response.status})`);
  return response.json();
}

export async function updateActionItem(id: number, input: {
  version: number; status?: ActionItem["status"]; assigneeId?: string | null;
  deferReason?: string; resolutionNote?: string;
}): Promise<ActionItem> {
  const response = await fetch(`/api/manager-action-queue/${id}`, {
    method: "PATCH", headers: headers(true), body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Update failed");
  return (await response.json() as { item: ActionItem }).item;
}