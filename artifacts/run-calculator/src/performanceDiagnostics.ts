const MAX_ENTRIES = 40;
const SLOW_TRANSITION_MS = 250;
const SLOW_LOAD_MS = 1500;
const SLOW_CALCULATION_MS = 16;
export const IMPORT_PERFORMANCE_BUDGETS = {
  parseMs: 120_000,
  reviewOpenMs: 2_000,
  commitMs: 10_000,
  exportMs: 10_000,
} as const;

/** Reviewed budget for the first visit to the deferred staff-management surface. */
export const MANAGEMENT_PERFORMANCE_BUDGETS = {
  staffFirstVisitMs: 350,
} as const;

export type PerformanceDiagnostic = {
  name: string;
  durationMs: number;
  kind: "load" | "navigation" | "render" | "calculation" | "storage" | "api" | "hmr" | "deferred";
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
  const importBudget = entry.name.startsWith("import-")
    ? entry.name.endsWith("-parse") ? IMPORT_PERFORMANCE_BUDGETS.parseMs
      : entry.name.endsWith("-review-open") ? IMPORT_PERFORMANCE_BUDGETS.reviewOpenMs
        : entry.name.endsWith("-commit") ? IMPORT_PERFORMANCE_BUDGETS.commitMs
          : entry.name.endsWith("-export") ? IMPORT_PERFORMANCE_BUDGETS.exportMs
            : undefined
    : undefined;
  const managementBudget = entry.name === "management:staff-first-visit"
    ? MANAGEMENT_PERFORMANCE_BUDGETS.staffFirstVisitMs
    : undefined;
  const budget = importBudget ?? managementBudget ?? (entry.kind === "load"
    ? SLOW_LOAD_MS
    : entry.kind === "api"
      ? 1000
      : entry.kind === "hmr"
        ? SLOW_LOAD_MS
      : entry.kind === "calculation"
        ? SLOW_CALCULATION_MS
        : entry.kind === "render"
          ? SLOW_TRANSITION_MS
        : entry.kind === "storage" ? 100 : SLOW_TRANSITION_MS);
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
 * Records browser-level navigation milestones once the document has finished
 * loading. React commit timings are useful for the calculator itself, but
 * these milestones capture the full page cost (HTML, scripts, styles, and
 * application boot) without retaining URLs or resource details.
 */
export function recordBrowserLoadTimings(): void {
  if (typeof performance === "undefined") return;
  const navigation = performance
    .getEntriesByType("navigation")
    .at(-1) as PerformanceNavigationTiming | undefined;
  if (!navigation) return;

  if (Number.isFinite(navigation.domContentLoadedEventEnd) && navigation.domContentLoadedEventEnd > 0) {
    recordPerformance(
      "browser:navigation-to-dom-content-loaded",
      navigation.domContentLoadedEventEnd - navigation.startTime,
      "load",
    );
  }
  if (Number.isFinite(navigation.loadEventEnd) && navigation.loadEventEnd > 0) {
    recordPerformance(
      "browser:navigation-to-load",
      navigation.loadEventEnd - navigation.startTime,
      "load",
    );
  }
}

/**
 * Installs dev-only Vite HMR timing diagnostics. HMR events are intentionally
 * summarized to one duration; module names and update payloads are not
 * retained, since they can contain customer-specific source paths.
 */
export function installBrowserPerformanceDiagnostics(): void {
  if (typeof window === "undefined") return;

  const recordWhenLoaded = () => recordBrowserLoadTimings();
  if (document.readyState === "complete") {
    queueMicrotask(recordWhenLoaded);
  } else {
    // `loadEventEnd` is finalized only after all load listeners have run.
    // Defer one task so the navigation entry includes both requested load
    // milestones rather than recording a zero/incomplete load-event value.
    window.addEventListener("load", () => window.setTimeout(recordWhenLoaded, 0), { once: true });
  }

  if (!import.meta.hot) return;
  let updateStartedAt: number | null = null;
  import.meta.hot.on("vite:beforeUpdate", () => {
    updateStartedAt = typeof performance === "undefined" ? null : performance.now();
  });
  import.meta.hot.on("vite:afterUpdate", () => {
    if (updateStartedAt === null || typeof performance === "undefined") return;
    recordPerformance("hmr:update", performance.now() - updateStartedAt, "hmr");
    updateStartedAt = null;
  });
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

/**
 * Records an intentional startup deferral without pretending it was a failed
 * request. This lets performance tooling distinguish less startup work from a
 * missing operational refresh.
 */
export function recordDeferredStartup(name: string): void {
  recordPerformance(`startup-deferred:${name}`, 0, "deferred");
}