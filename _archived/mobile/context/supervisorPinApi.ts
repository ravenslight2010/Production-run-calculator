// Supervisor PIN — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/supervisorPinApi.ts
// (replit.md parity). The supervisor PIN is a facility-wide server setting (one
// per facility) so it follows the facility instead of living per-device. Reading
// is open to any signed-in user (both apps do a local compare to gate supervisor
// actions); changing it is manager-only (the server enforces "manage-staff").
// Mobile has no cookie jar, so the session bearer token is attached explicitly.

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

async function call(path: string, opts?: RequestInit): Promise<string> {
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
  const data = (await res.json()) as { pin: unknown };
  return typeof data.pin === "string" ? data.pin : "";
}

export async function fetchSupervisorPin(): Promise<string> {
  return call("/supervisor-pin");
}

export async function updateSupervisorPin(pin: string): Promise<string> {
  return call("/supervisor-pin", {
    method: "PUT",
    body: JSON.stringify({ pin }),
  });
}
