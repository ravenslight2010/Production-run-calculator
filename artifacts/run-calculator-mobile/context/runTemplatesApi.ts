// Run templates — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/runTemplatesApi.ts
// (replit.md parity). Saved run-setup templates are persisted server-side
// (facility-wide master-data, shared by every signed-in user) and are NOT part
// of the per-day sync payload. Reads and writes are open to any signed-in user —
// templates are a shared convenience, not a policy control. Mobile has no cookie
// jar, so the session bearer token is attached explicitly to every request.
//
// The `values` blob is the cross-platform wire shape (WebFormValues); the
// RunContext maps it to/from its own RunSettings via the sync mapping helpers.

import { getAuthToken } from "@workspace/api-client-react";
import type { WebFormValues } from "./sync/payloadTypes";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export interface RemoteRunTemplate {
  id: string;
  name: string;
  values: WebFormValues;
  brand?: string;
  flavor?: string;
  createdAt: string;
}

function normalizeTemplate(raw: unknown): RemoteRunTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!id) return null;
  if (!r.values || typeof r.values !== "object") return null;
  const out: RemoteRunTemplate = {
    id,
    name: typeof r.name === "string" ? r.name : "Template",
    values: r.values as WebFormValues,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
  };
  if (typeof r.brand === "string") out.brand = r.brand;
  if (typeof r.flavor === "string") out.flavor = r.flavor;
  return out;
}

function normalizeTemplates(raw: unknown): RemoteRunTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteRunTemplate[] = [];
  for (const t of raw) {
    const n = normalizeTemplate(t);
    if (n) out.push(n);
  }
  return out;
}

async function call(path: string, opts?: RequestInit): Promise<RemoteRunTemplate[]> {
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
  const data = (await res.json()) as { templates: unknown };
  return normalizeTemplates(data.templates);
}

export async function fetchRunTemplates(): Promise<RemoteRunTemplate[]> {
  return call("/run-templates");
}

export async function saveRunTemplates(
  templates: RemoteRunTemplate[],
): Promise<RemoteRunTemplate[]> {
  return call("/run-templates", {
    method: "POST",
    body: JSON.stringify({ templates }),
  });
}

export async function deleteRunTemplates(ids: string[]): Promise<RemoteRunTemplate[]> {
  return call("/run-templates", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
