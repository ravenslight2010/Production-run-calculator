// Production rules — web platform glue.
//
// Managers define factory-wide production rules (modeled on the built-in
// allergen rule). Rules are persisted server-side (shared across all signed-in
// users) and are NOT part of the per-day sync payload. Reading is open to any
// signed-in user (both apps evaluate rules to warn/block a run); creating,
// updating and deleting are manager-only (the server enforces the role).
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/productionRules.ts (replit.md parity).

import { normalizeRule, type ProductionRule } from "@workspace/production-rules";
import { inventoryClientId } from "./inventoryShared";

function clean(rules: unknown): ProductionRule[] {
  if (!Array.isArray(rules)) return [];
  const out: ProductionRule[] = [];
  for (const raw of rules) {
    const rule = normalizeRule(raw);
    if (rule) out.push(rule);
  }
  return out;
}

export async function fetchProductionRules(): Promise<ProductionRule[]> {
  const res = await fetch("/api/production-rules", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List production rules failed (${res.status})`);
  const data = (await res.json()) as { rules: unknown };
  return clean(data.rules);
}

export async function saveProductionRules(rules: ProductionRule[]): Promise<ProductionRule[]> {
  const res = await fetch("/api/production-rules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`Save production rules failed (${res.status})`);
  const data = (await res.json()) as { rules: unknown };
  return clean(data.rules);
}

export async function deleteProductionRules(ids: string[]): Promise<ProductionRule[]> {
  const res = await fetch("/api/production-rules", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete production rules failed (${res.status})`);
  const data = (await res.json()) as { rules: unknown };
  return clean(data.rules);
}
