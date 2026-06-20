// Production rules — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/productionRules.ts
// (replit.md parity). Managers define factory-wide production rules (modeled on
// the built-in allergen rule). Rules are persisted server-side (shared across
// all signed-in users) and are NOT part of the per-day sync payload. Reading is
// open to any signed-in user; creating/updating/deleting are manager-only (the
// server enforces the role). Mobile has no cookie jar, so the session bearer
// token is attached explicitly to every request.

import { getAuthToken } from "@workspace/api-client-react";
import { normalizeRule, type ProductionRule } from "@workspace/production-rules";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

function clean(rules: unknown): ProductionRule[] {
  if (!Array.isArray(rules)) return [];
  const out: ProductionRule[] = [];
  for (const raw of rules) {
    const rule = normalizeRule(raw);
    if (rule) out.push(rule);
  }
  return out;
}

async function call(path: string, opts?: RequestInit): Promise<ProductionRule[]> {
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
  const data = (await res.json()) as { rules: unknown };
  return clean(data.rules);
}

export async function fetchProductionRules(): Promise<ProductionRule[]> {
  return call("/production-rules");
}

export async function saveProductionRules(
  rules: ProductionRule[],
): Promise<ProductionRule[]> {
  return call("/production-rules", {
    method: "POST",
    body: JSON.stringify({ rules }),
  });
}

export async function deleteProductionRules(
  ids: string[],
): Promise<ProductionRule[]> {
  return call("/production-rules", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
