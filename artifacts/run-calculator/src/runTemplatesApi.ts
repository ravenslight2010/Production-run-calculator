// Run templates — web platform glue.
//
// Saved run-setup templates used to live only in this device's localStorage
// (`run-calc-templates`), so a template saved on one device never appeared on
// another. They are now persisted server-side (facility-wide master-data, shared
// by every signed-in user) and are NOT part of the per-day sync payload. Reads
// and writes are open to any signed-in user — templates are a shared
// convenience, not a policy control.
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/runTemplatesApi.ts (replit.md parity).

import type { RunTemplate } from "./types";
import { inventoryClientId } from "./inventoryShared";

function normalizeTemplate(raw: unknown): RunTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!id) return null;
  if (!r.values || typeof r.values !== "object") return null;
  return {
    id,
    name: typeof r.name === "string" ? r.name : "Template",
    values: r.values as RunTemplate["values"],
    brand: typeof r.brand === "string" ? r.brand : undefined,
    flavor: typeof r.flavor === "string" ? r.flavor : undefined,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
  };
}

function normalizeTemplates(raw: unknown): RunTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: RunTemplate[] = [];
  for (const t of raw) {
    const n = normalizeTemplate(t);
    if (n) out.push(n);
  }
  return out;
}

export async function fetchRunTemplates(): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List run templates failed (${res.status})`);
  const data = (await res.json()) as { templates: unknown };
  return normalizeTemplates(data.templates);
}

export async function saveRunTemplates(templates: RunTemplate[]): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ templates }),
  });
  if (!res.ok) throw new Error(`Save run templates failed (${res.status})`);
  const data = (await res.json()) as { templates: unknown };
  return normalizeTemplates(data.templates);
}

export async function deleteRunTemplates(ids: string[]): Promise<RunTemplate[]> {
  const res = await fetch("/api/run-templates", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete run templates failed (${res.status})`);
  const data = (await res.json()) as { templates: unknown };
  return normalizeTemplates(data.templates);
}
