// Shared AI memory — web platform glue.
//
// Two server-backed stores every AI feature can lean on:
//   1. Facility knowledge — durable, factory-wide operational facts (domain +
//      key + fact), shared across all signed-in users. The single shared write
//      path AI features use to record observations back into memory.
//   2. Conversation history — the current user's recent AI turns (rolling,
//      capped), scoped to the caller only.
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

export type ConversationRole = "user" | "assistant";

export type ConversationTurn = {
  role: ConversationRole;
  text: string;
};

export async function fetchFacilityKnowledge(): Promise<FacilityKnowledge[]> {
  const res = await fetch("/api/ai-memory/facility", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List facility knowledge failed (${res.status})`);
  const data = (await res.json()) as { knowledge: FacilityKnowledge[] };
  return data.knowledge ?? [];
}

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

export async function fetchConversationHistory(): Promise<ConversationTurn[]> {
  const res = await fetch("/api/ai-memory/conversation", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Get conversation history failed (${res.status})`);
  const data = (await res.json()) as { turns: ConversationTurn[] };
  return data.turns ?? [];
}

export async function appendConversationTurns(
  turns: ConversationTurn[],
): Promise<ConversationTurn[]> {
  if (turns.length === 0) return [];
  const res = await fetch("/api/ai-memory/conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ turns }),
  });
  if (!res.ok) throw new Error(`Append conversation turns failed (${res.status})`);
  const data = (await res.json()) as { turns: ConversationTurn[] };
  return data.turns ?? [];
}
