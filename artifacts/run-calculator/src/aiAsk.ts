// "Ask the AI about the day" — web platform glue.
//
// A thin client over POST /ai/ask: send a plain-language question plus the live
// day-state (the same OptimizeInput both platforms already build) and get back a
// grounded answer plus this user's updated conversation window. Mirrors the
// mobile glue in artifacts/run-calculator-mobile/context/aiAsk.ts (replit.md
// parity); the only difference is plumbing (cookie session vs. bearer token).

import type { OptimizeInput } from "./aiOptimize";
import type { ConversationTurn } from "./aiMemory";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

export type AskResult = {
  answer: string;
  turns: ConversationTurn[];
  generatedAt: number;
  note?: string;
};

export async function requestAsk(question: string, dayState: OptimizeInput): Promise<AskResult> {
  const res = await fetch("/api/ai/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ question, dayState }),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Ask request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as AskResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const askErrorMessage = photoErrorMessage;
