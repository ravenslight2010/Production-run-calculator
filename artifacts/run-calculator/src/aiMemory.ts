// Shared AI memory — web platform glue.
//
// Facility knowledge is the durable, factory-wide operational-facts store
// (domain + key + fact), shared by retained bounded workflows.
//
// Best-effort: on any failure (sync disabled, network) callers should treat the
// memory as empty and proceed. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/aiMemory.ts (replit.md parity).

import { inventoryClientId } from "./inventoryShared";

export type FacilityKnowledge = {
  domain: string;
  key: string;
  fact: string;
};

export async function fetchFacilityKnowledge(): Promise<FacilityKnowledge[]> {
  const res = await fetch("/api/ai-memory/facility", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List facility knowledge failed (${res.status})`);
  const data = (await res.json()) as { knowledge: FacilityKnowledge[] };
  return data.knowledge ?? [];
}
// Conversation-memory transport was retired with broad day Q&A.
export async function saveFacilityKnowledge(
  knowledge: FacilityKnowledge[],
): Promise<FacilityKnowledge[]> {
  if (knowledge.length === 0) return [];
  const res = await fetch("/api/ai-memory/facility", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ knowledge }),
  });
  if (!res.ok) throw new Error(`Save facility knowledge failed (${res.status})`);
  const data = (await res.json()) as { knowledge: FacilityKnowledge[] };
  return data.knowledge ?? [];
}
