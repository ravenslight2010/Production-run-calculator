// Voice commands — mobile platform glue.
//
// A thin client over POST /ai/command: send a single spoken utterance plus the
// live day-state (the same OptimizeInput both platforms build) and get back a
// classification — a question (route to the existing ask flow), a list of
// resolved command actions to dispatch, or "none". Mirrors the web glue in
// artifacts/run-calculator/src/aiCommand.ts (replit.md parity); the only
// difference is plumbing (mobile threads the session bearer token + client id
// through fetch, exactly like context/inventoryShared.ts).

import { getAuthToken } from "@workspace/api-client-react";
import type { VoiceCommandResponse } from "@workspace/voice-commands";
import type { OptimizeInput } from "./aiOptimize";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";

export type CommandResult = VoiceCommandResponse & { generatedAt?: number };

export async function requestCommand(
  utterance: string,
  dayState: OptimizeInput,
): Promise<CommandResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
