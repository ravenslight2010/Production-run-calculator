// Supervisor PIN — web platform glue.
//
// The 4-digit PIN that gates supervisor actions used to live only in this
// device's localStorage, so changing it on one device left every other device on
// the old PIN. It is now a facility-wide server setting (one per facility) so it
// follows the facility. Reading is open to any signed-in user (both apps do a
// local compare to gate supervisor actions — the PIN is a low-security
// convenience gate, not a secret); changing it is manager-only (the server
// enforces "manage-staff").
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/supervisorPinApi.ts (replit.md parity).

import { inventoryClientId } from "./inventoryShared";

export async function fetchSupervisorPin(): Promise<string> {
  const res = await fetch("/api/supervisor-pin", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Get supervisor PIN failed (${res.status})`);
  const data = (await res.json()) as { pin: unknown };
  return typeof data.pin === "string" ? data.pin : "";
}

export async function updateSupervisorPin(pin: string): Promise<string> {
  const res = await fetch("/api/supervisor-pin", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(`Update supervisor PIN failed (${res.status})`);
  const data = (await res.json()) as { pin: unknown };
  return typeof data.pin === "string" ? data.pin : pin;
}
