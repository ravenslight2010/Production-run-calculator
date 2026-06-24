// Cycle-count schedules — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/cycleCount.ts
// (replit.md parity). Managers configure which warehouse sections must be
// counted and how often (a cadence in days). Schedules are persisted
// server-side (shared across all signed-in users) and are NOT part of the
// per-day sync payload. Reading is open to any signed-in user (both apps build
// the warehouse "Time to Count" card); creating, updating and deleting are
// manager-only (the server enforces "manage-inventory"). Marking a section
// counted is open to any signed-in user (floor staff perform the counts).
// Mobile has no cookie jar, so the session bearer token is attached explicitly
// to every request.

import { getAuthToken } from "@workspace/api-client-react";
import {
  normalizeCycleCountSchedules,
  type CycleCountSchedule,
} from "@workspace/cycle-count";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { todayStr } from "./inventoryShared";

async function call(
  path: string,
  opts?: RequestInit,
): Promise<CycleCountSchedule[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
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
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${path} -> ${res.status}`);
  const data = (await res.json()) as { schedules: unknown };
  return normalizeCycleCountSchedules(data.schedules);
}

export async function fetchCycleCountSchedules(): Promise<CycleCountSchedule[]> {
  return call("/cycle-count-schedules");
}

export async function saveCycleCountSchedules(
  schedules: CycleCountSchedule[],
): Promise<CycleCountSchedule[]> {
  return call("/cycle-count-schedules", {
    method: "POST",
    body: JSON.stringify({ schedules }),
  });
}

export async function deleteCycleCountSchedules(
  ids: string[],
): Promise<CycleCountSchedule[]> {
  return call("/cycle-count-schedules", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

export async function markCycleCountCounted(
  id: string,
): Promise<CycleCountSchedule[]> {
  return call(`/cycle-count-schedules/${encodeURIComponent(id)}/mark-counted`, {
    method: "POST",
    // Stamp with the client's local factory day so the last-counted date
    // matches the same basis the due list uses (no timezone off-by-one).
    body: JSON.stringify({ today: todayStr() }),
  });
}
