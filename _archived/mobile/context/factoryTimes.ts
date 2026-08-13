// Factory shift timing — mobile platform glue.
//
// Reads and writes the shiftStartTime / productionStartTime keys from the
// factory-wide KV store (GET /api/factory-data). Mirrors the web approach in
// artifacts/run-calculator/src/factoryDataSync.ts. Reading is open to any
// signed-in user; writing is manager-only (server enforces the role).

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export const SHIFT_START_TIME_KEY = "run-calc-shift-start-time";
export const PRODUCTION_START_TIME_KEY = "run-calc-production-start-time";
export const DEFAULT_SHIFT_START_TIME = "06:00";
export const DEFAULT_PRODUCTION_START_TIME = "07:00";

export interface FactoryTimes {
  shiftStartTime: string;
  productionStartTime: string;
}

async function makeHeaders(): Promise<Record<string, string>> {
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  return {
    "Content-Type": "application/json",
    "x-client-id": clientId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchFactoryTimes(): Promise<FactoryTimes> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL");
  const headers = await makeHeaders();
  const res = await fetch(`${base}/api/factory-data`, { headers });
  if (!res.ok) throw new Error(`fetchFactoryTimes failed (${res.status})`);
  const body = (await res.json()) as {
    data?: Record<string, { value: unknown; updatedAt: string }>;
  };
  const data = body.data ?? {};
  return {
    shiftStartTime:
      typeof data[SHIFT_START_TIME_KEY]?.value === "string"
        ? (data[SHIFT_START_TIME_KEY].value as string)
        : DEFAULT_SHIFT_START_TIME,
    productionStartTime:
      typeof data[PRODUCTION_START_TIME_KEY]?.value === "string"
        ? (data[PRODUCTION_START_TIME_KEY].value as string)
        : DEFAULT_PRODUCTION_START_TIME,
  };
}

export async function saveFactoryTime(key: string, value: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL");
  const headers = await makeHeaders();
  const res = await fetch(`${base}/api/factory-data`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`saveFactoryTime failed (${res.status})`);
}
