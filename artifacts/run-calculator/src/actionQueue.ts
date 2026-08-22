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

function headers(json = false): Record<string, string> {
  return { "x-client-id": inventoryClientId(), ...(json ? { "Content-Type": "application/json" } : {}) };
}

export async function fetchActionQueue(): Promise<{ items: ActionItem[]; counts: Record<string, number> }> {
  const response = await fetch("/api/manager-action-queue", { headers: headers() });
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