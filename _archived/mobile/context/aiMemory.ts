// Shared AI memory — mobile platform glue.
//
// Two server-backed stores every AI feature can lean on:
//   1. Facility knowledge — durable, factory-wide operational facts (domain +
//      key + fact), shared across all signed-in users. The single shared write
//      path AI features use to record observations back into memory.
//   2. Conversation history — the current user's recent AI turns (rolling,
//      capped), scoped to the caller only.
//
// Best-effort: on any failure (sync disabled, network) callers should treat the
// memory as empty and proceed. Mirrors the web glue in
// artifacts/run-calculator/src/aiMemory.ts (replit.md parity).

import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

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

async function authHeaders(): Promise<Record<string, string>> {
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  return {
    "x-client-id": clientId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchFacilityKnowledge(): Promise<FacilityKnowledge[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const res = await fetch(`${base}/api/ai-memory/facility`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`List facility knowledge failed (${res.status})`);
  const data = (await res.json()) as { knowledge: FacilityKnowledge[] };
  return data.knowledge ?? [];
}

export async function saveFacilityKnowledge(
  knowledge: FacilityKnowledge[],
): Promise<FacilityKnowledge[]> {
  if (knowledge.length === 0) return [];
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const res = await fetch(`${base}/api/ai-memory/facility`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ knowledge }),
  });
  if (!res.ok) throw new Error(`Save facility knowledge failed (${res.status})`);
  const data = (await res.json()) as { knowledge: FacilityKnowledge[] };
  return data.knowledge ?? [];
}

export async function fetchConversationHistory(): Promise<ConversationTurn[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const res = await fetch(`${base}/api/ai-memory/conversation`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Get conversation history failed (${res.status})`);
  const data = (await res.json()) as { turns: ConversationTurn[] };
  return data.turns ?? [];
}

export async function appendConversationTurns(
  turns: ConversationTurn[],
): Promise<ConversationTurn[]> {
  if (turns.length === 0) return [];
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const res = await fetch(`${base}/api/ai-memory/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ turns }),
  });
  if (!res.ok) throw new Error(`Append conversation turns failed (${res.status})`);
  const data = (await res.json()) as { turns: ConversationTurn[] };
  return data.turns ?? [];
}
