// Proactive shift-alert client — mobile platform glue.
//
// Companion to the on-demand assistant (aiOptimize.ts): while a day is running,
// the app polls POST /ai/proactive-alert on a cadence and surfaces at most one
// timely, dismissible nudge (behind plan, or a break/changeover window). The
// server decides IF and WHAT to surface and returns a stable de-dup `key`; the
// client owns cooldown/de-dup so the same nudge doesn't repeat.
//
// Mirrors the web glue in artifacts/run-calculator/src/aiProactive.ts
// (replit.md parity). The only platform difference is plumbing: mobile threads
// the session bearer token + client id through fetch (no cookie jar), exactly
// like context/aiOptimize.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError } from "./inventoryShared";
import { saveFacilityKnowledge } from "./aiMemory";
import type { OptimizeInput } from "./aiOptimize";

// ── Types (mirror the OpenAPI /ai/proactive-alert contract) ──────────────────
export type ProactiveCategory = "run" | "break" | "efficiency";
export type ProactiveImpact = "high" | "medium" | "low";

export type ProactiveAlert = {
  key: string;
  category: ProactiveCategory;
  title: string;
  detail: string;
  impact: ProactiveImpact;
};

export type ProactiveAlertResult = {
  alert: ProactiveAlert | null;
  generatedAt: number;
  note?: string;
};

// Poll roughly every 4 minutes while a day is active — frequent enough to catch
// a forming break window, sparse enough to stay well under the cost cap.
export const PROACTIVE_POLL_INTERVAL_MS = 4 * 60_000;
// Once a nudge is dismissed, suppress the SAME key for 30 minutes so it doesn't
// nag. A different key (a genuinely new situation) surfaces immediately.
export const PROACTIVE_DISMISS_COOLDOWN_MS = 30 * 60_000;

export async function requestProactiveAlert(input: OptimizeInput): Promise<ProactiveAlertResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/proactive-alert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
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
      `Proactive alert request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as ProactiveAlertResult;
}

// Record a notable dismissal back through the shared facility-memory write path
// (best-effort) so the watcher's timing can improve over time. Never throws.
async function recordDismissal(alert: ProactiveAlert): Promise<void> {
  try {
    const now = new Date();
    const clock = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
    await saveFacilityKnowledge([
      {
        domain: "proactive-alerts",
        key: `dismissed:${alert.key}`,
        fact: `A manager dismissed the "${alert.title}" nudge around ${clock}.`,
      },
    ]);
  } catch {
    // best-effort; a memory-write failure must never affect the UI
  }
}

export type UseProactiveAlert = {
  alert: ProactiveAlert | null;
  dismiss: () => void;
};

// Poll while `enabled`, surfacing at most one alert at a time with client-side
// de-dup + cooldown:
//   - the currently-shown alert is never replaced by the same key;
//   - a key dismissed within the cooldown window is suppressed;
//   - any other key surfaces on the next poll.
// `buildInput` returns the live-day OptimizeInput, or null when there's nothing
// to evaluate. Identical logic lives in the web hook (replit.md parity).
export function useProactiveAlert(args: {
  enabled: boolean;
  buildInput: () => OptimizeInput | null;
}): UseProactiveAlert {
  const { enabled, buildInput } = args;
  const [alert, setAlert] = useState<ProactiveAlert | null>(null);

  // Refs so the polling closure always sees the latest values without
  // re-subscribing the interval on every render.
  const alertRef = useRef<ProactiveAlert | null>(null);
  const dismissedRef = useRef<Map<string, number>>(new Map());
  const buildInputRef = useRef(buildInput);
  buildInputRef.current = buildInput;

  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);

  const evaluate = useCallback(async () => {
    const input = buildInputRef.current();
    if (!input) return;
    let result: ProactiveAlertResult;
    try {
      result = await requestProactiveAlert(input);
    } catch {
      // best-effort poll; ignore rate-limit / network / provider errors
      return;
    }
    const next = result.alert;
    if (!next) return;
    // Don't re-trigger the alert already on screen.
    if (alertRef.current && alertRef.current.key === next.key) return;
    // Respect the per-key dismissal cooldown.
    const dismissedAt = dismissedRef.current.get(next.key);
    if (dismissedAt != null && Date.now() - dismissedAt < PROACTIVE_DISMISS_COOLDOWN_MS) return;
    setAlert(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAlert(null);
      return;
    }
    void evaluate();
    const id = setInterval(() => void evaluate(), PROACTIVE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, evaluate]);

  const dismiss = useCallback(() => {
    const current = alertRef.current;
    if (current) {
      dismissedRef.current.set(current.key, Date.now());
      void recordDismissal(current);
    }
    setAlert(null);
  }, []);

  return { alert, dismiss };
}
