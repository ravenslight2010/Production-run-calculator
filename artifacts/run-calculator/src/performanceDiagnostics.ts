const MAX_ENTRIES = 40;
const SLOW_TRANSITION_MS = 250;
const SLOW_LOAD_MS = 1500;
const SLOW_CALCULATION_MS = 16;

export type PerformanceDiagnostic = {
  name: string;
  durationMs: number;
  kind: "load" | "navigation" | "render" | "calculation" | "storage" | "api";
};

const entries: PerformanceDiagnostic[] = [];
export type MemoryDiagnostic = {
  name: string;
  usedHeapBytes: number;
  totalHeapBytes: number;
};
const memoryEntries: MemoryDiagnostic[] = [];

function safePath(url: string): string {
  try {
    const origin = typeof window === "undefined" ? "http://calculator.local" : window.location.origin;
    return new URL(url, origin).pathname;
  } catch {
    return url.split("?")[0]?.split("#")[0] || "/unknown";
  }
}

function remember(entry: PerformanceDiagnostic): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("calculator-performance", { detail: entry }));
  }
  const budget = entry.kind === "load"
    ? SLOW_LOAD_MS
    : entry.kind === "api"
      ? 1000
      : entry.kind === "calculation"
        ? SLOW_CALCULATION_MS
        : entry.kind === "render"
          ? SLOW_TRANSITION_MS
          : entry.kind === "storage" ? 100 : SLOW_TRANSITION_MS;
  if (entry.durationMs > budget && typeof console !== "undefined") {
    console.warn(`[calculator-performance] ${entry.kind} exceeded budget`, {
      name: entry.name,
      durationMs: Math.round(entry.durationMs),
      budgetMs: budget,
    });
  }
}

export function recordPerformance(
  name: string,
  durationMs: number,
  kind: PerformanceDiagnostic["kind"],
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  remember({ name, durationMs, kind });
}

export function measurePerformance(
  name: string,
  startMark: string,
  endMark: string,
  kind: PerformanceDiagnostic["kind"],
): void {
  if (typeof performance === "undefined") return;
  const start = performance.getEntriesByName(startMark, "mark").at(-1);
  const end = performance.getEntriesByName(endMark, "mark").at(-1);
  if (!start || !end) return;
  recordPerformance(name, end.startTime - start.startTime, kind);
  performance.clearMarks(startMark);
  performance.clearMarks(endMark);
}

export function getPerformanceDiagnostics(): readonly PerformanceDiagnostic[] {
  return entries.slice();
}

export function clearPerformanceDiagnostics(): void {
  entries.length = 0;
  memoryEntries.length = 0;
}

/**
 * Samples the browser heap when the engine exposes the non-standard
 * performance.memory API (Chromium). The sample contains no application data
 * and is intentionally a no-op in browsers that do not expose heap metrics.
 */
export function recordMemorySample(name: string): void {
  if (typeof performance === "undefined") return;
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
  }).memory;
  const usedHeapBytes = memory?.usedJSHeapSize;
  const totalHeapBytes = memory?.totalJSHeapSize;
  if (
    !Number.isFinite(usedHeapBytes) ||
    !Number.isFinite(totalHeapBytes) ||
    usedHeapBytes! < 0 ||
    totalHeapBytes! < 0
  ) return;
  memoryEntries.push({ name, usedHeapBytes: usedHeapBytes!, totalHeapBytes: totalHeapBytes! });
  if (memoryEntries.length > MAX_ENTRIES) {
    memoryEntries.splice(0, memoryEntries.length - MAX_ENTRIES);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("calculator-memory", {
      detail: memoryEntries[memoryEntries.length - 1],
    }));
  }
}

export function getMemoryDiagnostics(): readonly MemoryDiagnostic[] {
  return memoryEntries.slice();
}

/**
 * Fetch an API request while recording only bounded, privacy-safe diagnostics.
 * The URL is reduced to its pathname and neither request nor response data is
 * logged or retained. This is the non-timeout counterpart to fetchWithTimeout.
 */
export async function fetchWithDiagnostics(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const startedAt = typeof performance === "undefined" ? null : performance.now();
  const path = safePath(url);
  try {
    const response = await fetch(url, init);
    if (startedAt !== null && typeof performance !== "undefined") {
      recordPerformance(`api:${path}:${response.status}`, performance.now() - startedAt, "api");
    }
    return response;
  } catch (err) {
    if (startedAt !== null && typeof performance !== "undefined") {
      const name = (err as { name?: unknown } | null)?.name;
      recordPerformance(
        `api-failure:${path}:${name === "TimeoutError" || name === "AbortError" ? "timeout" : "network"}`,
        performance.now() - startedAt,
        "api",
      );
    }
    throw err;
  }
}

export const PERFORMANCE_BUDGETS = {
  initialLoadMs: SLOW_LOAD_MS,
  tabTransitionMs: SLOW_TRANSITION_MS,
  renderMs: SLOW_TRANSITION_MS,
  calculationMs: SLOW_CALCULATION_MS,
  storageScanMs: 100,
  apiRequestMs: 1000,
} as const;