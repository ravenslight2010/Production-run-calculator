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

// Defaults used when the server settings can't be loaded (best-effort). Managers
// can tune these per facility via the proactive-alert settings (see the manager
// settings panel); these mirror the server-side defaults and the bounds used
// when persisting them.
export const DEFAULT_PROACTIVE_POLL_SECONDS = 240; // 4 min — catch a forming break window, stay under the cost cap
export const DEFAULT_PROACTIVE_COOLDOWN_SECONDS = 1800; // 30 min — a dismissed nudge stays suppressed this long
export const PROACTIVE_POLL_SECONDS_MIN = 30;
export const PROACTIVE_POLL_SECONDS_MAX = 3600;
export const PROACTIVE_COOLDOWN_SECONDS_MIN = 0;
export const PROACTIVE_COOLDOWN_SECONDS_MAX = 86_400;

// Back-compat ms aliases (the hook now uses the per-facility settings instead).
export const PROACTIVE_POLL_INTERVAL_MS = DEFAULT_PROACTIVE_POLL_SECONDS * 1000;
export const PROACTIVE_DISMISS_COOLDOWN_MS = DEFAULT_PROACTIVE_COOLDOWN_SECONDS * 1000;

// Factory-wide, manager-tunable knobs for how aggressive the watcher is.
export type ProactiveSettings = {
  enabled: boolean;
  pollSeconds: number;
  cooldownSeconds: number;
};

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  pollSeconds: DEFAULT_PROACTIVE_POLL_SECONDS,
  cooldownSeconds: DEFAULT_PROACTIVE_COOLDOWN_SECONDS,
};

// Coerce + clamp an untrusted settings payload into safe bounds. Mirrors the
// server-side clamping so the client never acts on an out-of-range cadence.
export function normalizeProactiveSettings(
  raw: Partial<ProactiveSettings> | null | undefined,
): ProactiveSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PROACTIVE_SETTINGS;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_PROACTIVE_SETTINGS.enabled;
  const pollRaw = Number(raw.pollSeconds);
  const cooldownRaw = Number(raw.cooldownSeconds);
  const pollSeconds = Number.isFinite(pollRaw)
    ? Math.round(pollRaw)
    : DEFAULT_PROACTIVE_POLL_SECONDS;
  const cooldownSeconds = Number.isFinite(cooldownRaw)
    ? Math.round(cooldownRaw)
    : DEFAULT_PROACTIVE_COOLDOWN_SECONDS;
  return {
    enabled,
    pollSeconds: Math.min(PROACTIVE_POLL_SECONDS_MAX, Math.max(PROACTIVE_POLL_SECONDS_MIN, pollSeconds)),
    cooldownSeconds: Math.min(
      PROACTIVE_COOLDOWN_SECONDS_MAX,
      Math.max(PROACTIVE_COOLDOWN_SECONDS_MIN, cooldownSeconds),
    ),
  };
}

// Read the factory-wide proactive-alert settings. Best-effort: any failure falls
// back to the defaults so the watcher keeps working. Mobile threads the session
// bearer token + client id through fetch, like requestProactiveAlert above.
export async function fetchProactiveSettings(): Promise<ProactiveSettings> {
  try {
    const base = getApiBaseUrl();
    if (!base) return DEFAULT_PROACTIVE_SETTINGS;
    const clientId = await getOrCreateClientId();
    const token = await getAuthToken();
    const res = await fetch(`${base}/api/ai/proactive-settings`, {
      headers: {
        "x-client-id": clientId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return DEFAULT_PROACTIVE_SETTINGS;
    return normalizeProactiveSettings((await res.json()) as Partial<ProactiveSettings>);
  } catch {
    return DEFAULT_PROACTIVE_SETTINGS;
  }
}

// Persist new settings (manager only on the server). Throws on failure so the
// settings UI can surface an error.
export async function updateProactiveSettings(body: ProactiveSettings): Promise<ProactiveSettings> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/proactive-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let serverMessage: string | null = null;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (data && typeof data.error === "string") serverMessage = data.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Update proactive settings failed (${res.status})`,
      null,
      serverMessage,
    );
  }
  return normalizeProactiveSettings((await res.json()) as Partial<ProactiveSettings>);
}

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
  // Per-key dismissal cooldown in ms; refreshed from the live settings each cycle.
  const cooldownMsRef = useRef<number>(DEFAULT_PROACTIVE_COOLDOWN_SECONDS * 1000);

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
    // Respect the per-key dismissal cooldown (manager-tunable).
    const dismissedAt = dismissedRef.current.get(next.key);
    if (dismissedAt != null && Date.now() - dismissedAt < cooldownMsRef.current) return;
    setAlert(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAlert(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Recursive timer (not setInterval) so each cycle re-reads the live, manager-
    // tunable settings: changing cadence/cooldown or turning alerts off takes
    // effect on the next cycle, no reload needed. When disabled we keep checking
    // on the default cadence so a re-enable is picked up too.
    const tick = async () => {
      const settings = await fetchProactiveSettings();
      if (cancelled) return;
      cooldownMsRef.current = settings.cooldownSeconds * 1000;
      if (settings.enabled) {
        await evaluate();
      } else {
        setAlert(null);
      }
      if (cancelled) return;
      const delayMs =
        (settings.enabled ? settings.pollSeconds : DEFAULT_PROACTIVE_POLL_SECONDS) * 1000;
      timer = setTimeout(() => void tick(), delayMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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
