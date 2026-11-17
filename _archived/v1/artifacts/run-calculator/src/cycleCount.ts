// Cycle-count schedules — web platform glue.
//
// Managers configure which warehouse sections must be counted and how often (a
// cadence in days). Schedules are persisted server-side (shared across all
// signed-in users) and are NOT part of the per-day sync payload. Reading is open
// to any signed-in user (both apps build the warehouse "Time to Count" card);
// creating, updating and deleting are manager-only (the server enforces
// "manage-inventory"). Marking a section counted is open to any signed-in user
// (floor staff perform the counts).
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/cycleCount.ts (replit.md parity).

import {
  normalizeCycleCountSchedules,
  type CycleCountSchedule,
} from "@workspace/cycle-count";
import { inventoryClientId } from "./inventoryShared";
import { todayStr } from "./utils";

export async function fetchCycleCountSchedules(): Promise<CycleCountSchedule[]> {
  const res = await fetch("/api/cycle-count-schedules", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List cycle-count schedules failed (${res.status})`);
  const data = (await res.json()) as { schedules: unknown };
  return normalizeCycleCountSchedules(data.schedules);
}

export async function saveCycleCountSchedules(
  schedules: CycleCountSchedule[],
): Promise<CycleCountSchedule[]> {
  const res = await fetch("/api/cycle-count-schedules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ schedules }),
  });
  if (!res.ok) throw new Error(`Save cycle-count schedules failed (${res.status})`);
  const data = (await res.json()) as { schedules: unknown };
  return normalizeCycleCountSchedules(data.schedules);
}

export async function deleteCycleCountSchedules(
  ids: string[],
): Promise<CycleCountSchedule[]> {
  const res = await fetch("/api/cycle-count-schedules", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete cycle-count schedules failed (${res.status})`);
  const data = (await res.json()) as { schedules: unknown };
  return normalizeCycleCountSchedules(data.schedules);
}

export async function markCycleCountCounted(
  id: string,
): Promise<CycleCountSchedule[]> {
  const res = await fetch(
    `/api/cycle-count-schedules/${encodeURIComponent(id)}/mark-counted`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      // Stamp with the client's local factory day so the last-counted date
      // matches the same basis the due list uses (no timezone off-by-one).
      body: JSON.stringify({ today: todayStr() }),
    },
  );
  if (!res.ok) throw new Error(`Mark counted failed (${res.status})`);
  const data = (await res.json()) as { schedules: unknown };
  return normalizeCycleCountSchedules(data.schedules);
}
