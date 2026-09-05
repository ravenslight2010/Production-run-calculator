import { useEffect } from "react";
import { submitFieldCheckObservations } from "./inventoryShared";
import { useAuth } from "./useAuth";

export const FIELD_CHECK_VERSION = "1";
export const FIELD_CHECK_SIGNAL_EVENT = "calculator-field-check-signal";

export const FIELD_CHECK_CATALOG = [
  { name: "startup", label: "Startup", observedBy: "browser" as const },
  { name: "foreground-recovery", label: "Background / foreground recovery", observedBy: "browser" as const },
  { name: "sync-acknowledgment", label: "Sync acknowledgment", observedBy: "browser" as const },
  { name: "cross-device-convergence", label: "Cross-device convergence", observedBy: "browser" as const },
  { name: "reload-persistence", label: "Reload persistence", observedBy: "browser" as const },
  { name: "offline-recovery", label: "Offline recovery", observedBy: "browser" as const },
  { name: "pwa-update-handoff", label: "PWA update handoff", observedBy: "browser" as const },
  { name: "performance", label: "Performance", observedBy: "browser" as const },
  { name: "touch-accuracy", label: "Touch accuracy", observedBy: "hardware" as const },
  { name: "keyboard-clearance", label: "Keyboard clearance", observedBy: "hardware" as const },
  { name: "process-kill-recovery", label: "OS process-kill recovery", observedBy: "hardware" as const },
] as const;

type CheckName = (typeof FIELD_CHECK_CATALOG)[number]["name"];
type Outcome = "success" | "failure" | "incomplete";
type Signal = {
  checkName: CheckName;
  outcome: Outcome;
  metrics?: Record<string, number>;
};

const queueKey = "run-calc-field-check-queue";
const clientKey = "run-calc-field-check-client";
const bucketMs = 10 * 60 * 1000;
const maxQueue = 80;
const maxMetrics = 8;
const defaultRetryMs = 30_000;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function localClientId(): string {
  try {
    const existing = localStorage.getItem(clientKey);
    if (existing && /^[a-zA-Z0-9-]{8,80}$/.test(existing)) return existing;
    const next = randomId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 70);
    localStorage.setItem(clientKey, next);
    return next;
  } catch {
    return randomId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 70);
  }
}

function deviceCategory(): "desktop-chrome" | "desktop-safari" | "desktop-firefox" | "mobile-chrome" | "mobile-safari" | "tablet-browser" | "other-browser" {
  if (typeof navigator === "undefined") return "other-browser";
  const ua = navigator.userAgent.toLowerCase();
  const tablet = /ipad|tablet|android(?!.*mobile)/.test(ua);
  const mobile = /mobile|iphone|ipod|android/.test(ua);
  if (tablet) return "tablet-browser";
  if (mobile && ua.includes("safari") && !ua.includes("chrome")) return "mobile-safari";
  if (mobile && (ua.includes("chrome") || ua.includes("crios"))) return "mobile-chrome";
  if (!mobile && ua.includes("firefox")) return "desktop-firefox";
  if (!mobile && ua.includes("safari") && !ua.includes("chrome")) return "desktop-safari";
  if (!mobile && (ua.includes("chrome") || ua.includes("edg"))) return "desktop-chrome";
  return "other-browser";
}

function safeMetrics(metrics: Record<string, number> | undefined): Record<string, number> {
  if (!metrics) return {};
  return Object.fromEntries(
    Object.entries(metrics)
      .filter(([key, value]) => /^[a-z][a-zA-Z0-9]{0,31}$/.test(key) && Number.isFinite(value) && value >= 0 && value <= 10_000_000)
      .slice(0, maxMetrics)
      .map(([key, value]) => [key, Math.round(value * 100) / 100]),
  );
}

function loadQueue(): Array<{
  observationId: string;
  checkName: CheckName;
  checkVersion: string;
  outcome: Outcome;
  observedAt: string;
  appBuild: string;
  deviceCategory: ReturnType<typeof deviceCategory>;
  metrics: Record<string, number>;
}> {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item && typeof item.observationId === "string" &&
      typeof item.checkName === "string" &&
      FIELD_CHECK_CATALOG.some((check) => check.name === item.checkName && check.observedBy === "browser") &&
      (item.outcome === "success" || item.outcome === "failure" || item.outcome === "incomplete") &&
      typeof item.observedAt === "string" && typeof item.appBuild === "string" &&
      typeof item.deviceCategory === "string" && item.metrics && typeof item.metrics === "object",
    ).slice(-maxQueue);
  } catch {
    return [];
  }
}

function saveQueue(queue: ReturnType<typeof loadQueue>): void {
  try {
    localStorage.setItem(queueKey, JSON.stringify(queue.slice(-maxQueue)));
  } catch {
    // Collection must never affect production persistence.
  }
}

export function emitFieldCheckSignal(checkName: CheckName, outcome: Outcome, metrics?: Record<string, number>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Signal>(FIELD_CHECK_SIGNAL_EVENT, {
    detail: { checkName, outcome, metrics: safeMetrics(metrics) },
  }));
}

function queueSignal(signal: Signal, appBuild: string): void {
  const now = Date.now();
  const id = `${localClientId()}:${signal.checkName}:${Math.floor(now / bucketMs)}:${signal.outcome}`;
  const queue = loadQueue();
  if (queue.some((item) => item.observationId === id)) return;
  queue.push({
    observationId: id,
    checkName: signal.checkName,
    checkVersion: FIELD_CHECK_VERSION,
    outcome: signal.outcome,
    observedAt: new Date(now).toISOString(),
    appBuild: appBuild.slice(0, 100) || "local",
    deviceCategory: deviceCategory(),
    metrics: safeMetrics(signal.metrics),
  });
  saveQueue(queue);
}

export function createFieldCheckObserver(appBuild: string): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let stopped = false;
  let wasHidden = document.visibilityState === "hidden";
  let wasOffline = navigator.onLine === false;
  let flushInFlight: Promise<void> | null = null;
  let retryTimer: number | null = null;

  const flush = async () => {
    if (stopped || flushInFlight || retryTimer !== null || !navigator.onLine) return;
    const queued = loadQueue();
    if (queued.length === 0) return;
    const batch = queued.slice(0, 20);
    flushInFlight = submitFieldCheckObservations(batch)
      .then(() => {
        const sent = new Set(batch.map((item) => item.observationId));
        saveQueue(loadQueue().filter((item) => !sent.has(item.observationId)));
      })
      .catch((error: unknown) => {
        const requestedDelay = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
        const delay = typeof requestedDelay === "number" && Number.isFinite(requestedDelay)
          ? Math.min(120_000, Math.max(1_000, requestedDelay))
          : defaultRetryMs;
        if (!stopped && retryTimer === null) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void flush();
          }, delay);
        }
      })
      .finally(() => {
        flushInFlight = null;
        if (!stopped && retryTimer === null) void flush();
      });
    await flushInFlight;
  };
  const onSignal = (event: Event) => {
    const signal = (event as CustomEvent<Signal>).detail;
    if (!signal || !FIELD_CHECK_CATALOG.some((check) => check.name === signal.checkName && check.observedBy === "browser")) return;
    queueSignal(signal, appBuild);
    void flush();
  };
  const onVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    if (!hidden && wasHidden) {
      emitFieldCheckSignal("foreground-recovery", "success");
      void flush();
    }
    wasHidden = hidden;
  };
  const onOnline = () => {
    if (wasOffline) emitFieldCheckSignal("offline-recovery", "success");
    wasOffline = false;
    void flush();
  };
  const onOffline = () => { wasOffline = true; };
  const onPerformance = (event: Event) => {
    const entry = (event as CustomEvent<{ name?: string; durationMs?: number }>).detail;
    if (!entry?.name || !Number.isFinite(entry.durationMs)) return;
    if (entry.name === "startup:home-chunk-load" || entry.name === "browser:navigation-to-load" || entry.name.startsWith("api-failure:")) {
      emitFieldCheckSignal("performance", entry.durationMs! > 1500 ? "failure" : "success", { durationMs: entry.durationMs! });
    }
  };

  window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, onSignal);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("calculator-performance", onPerformance);
  queueSignal({ checkName: "startup", outcome: "success" }, appBuild);
  const navigation = performance.getEntriesByType("navigation").at(-1) as PerformanceNavigationTiming | undefined;
  if (navigation?.type === "reload") queueSignal({ checkName: "reload-persistence", outcome: "success" }, appBuild);
  const interval = window.setInterval(() => void flush(), 120_000);
  void flush();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, onSignal);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("calculator-performance", onPerformance);
  };
}

export function FieldVerificationObserver({ appBuild }: { appBuild: string }) {
  const { isAuthenticated, isLoading } = useAuth();
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    return createFieldCheckObserver(appBuild);
  }, [appBuild, isAuthenticated, isLoading]);
  return null;
}