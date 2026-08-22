import { inventoryClientId } from "./inventoryShared";
import type { AttentionState } from "./attentionStates";

export type HandoffSeverity = "urgent" | "high" | "medium" | "low" | "info";
export type HandoffStatus = "open" | "reviewed" | "resolved" | "historical" | "current";
export type HandoffSource = "incidents" | "quality" | "inventory" | "sync" | "data-health";

export type HandoffItem = {
  id: string;
  source: HandoffSource;
  severity: HandoffSeverity;
  status: HandoffStatus;
  title: string;
  detail: string;
  affectedRun: string | null;
  affectedProduct: string | null;
  occurredAt: string | null;
  sourcePath: string;
  historical: boolean;
  attentionState?: AttentionState;
  nextAction?: string;
};

export type ShiftHandoffDigest = {
  scope: string;
  date: string;
  generatedAt: string;
  items: HandoffItem[];
  sources: Record<HandoffSource, {
    availability: "available" | "unavailable";
    note?: string;
    itemCount: number;
  }>;
};

export async function fetchShiftHandoff(date: string): Promise<ShiftHandoffDigest> {
  const res = await fetch(`/api/reports/handoff?date=${encodeURIComponent(date)}`, {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to load shift handoff: ${res.status}`);
  return await res.json() as ShiftHandoffDigest;
}