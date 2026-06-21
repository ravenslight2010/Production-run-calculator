// Voice commands — web platform glue.
//
// A thin client over POST /ai/command: send a single spoken utterance plus the
// live day-state (the same OptimizeInput both platforms build) and get back a
// classification — a question (route to the existing ask flow), a list of
// resolved command actions to dispatch, or "none". Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/aiCommand.ts (replit.md parity); the
// only difference is plumbing (cookie session vs. bearer token).

import type { VoiceCommandResponse } from "@workspace/voice-commands";
import type { OptimizeInput } from "./aiOptimize";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

export type CommandResult = VoiceCommandResponse & { generatedAt?: number };

export async function requestCommand(
  utterance: string,
  dayState: OptimizeInput,
): Promise<CommandResult> {
  const res = await fetch("/api/ai/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ utterance, dayState }),
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
      `Command request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as CommandResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const commandErrorMessage = photoErrorMessage;
