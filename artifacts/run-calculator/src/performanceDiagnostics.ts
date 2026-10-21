const MAX_ENTRIES = 40;
const SLOW_TRANSITION_MS = 250;
const SLOW_LOAD_MS = 1500;
const SLOW_CALCULATION_MS = 16;
export const DEFAULT_READ_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_ELAPSED_MS = 10_000_000;

export type ApiOperationCategory =
  | "authentication"
  | "diagnostics"
  | "import"
  | "inventory"
  | "master_data"
  | "sync"
  | "other";

export type ApiRequestRoute =
  | "authentication"
  | "sync_today_read"
  | "sync_today_write"
  | "sync_dated"
  | "sync_auto_track_claim"
  | "sync_manual_section"
  | "sync_operational_intents"
  | "sync_events"
  | "sync_scheduled"
  | "sync_other"
  | "other";

export type ApiRequestReasonCode =
  | "SYNC_VALIDATION_FAILED"
  | "SYNC_PAYLOAD_NOT_OBJECT"
  | "SYNC_PAYLOAD_TOO_LARGE";

export type ApiRequestOutcome =
  | "http_server_error"
  | "http_client_error"
  | "authentication_rejected"
  | "transport_failure"
  | "offline_failure"
  | "timeout"
  | "cancelled";

export type ApiFailureEvent = {
  operationCategory: ApiOperationCategory;
  requestRoute: ApiRequestRoute;
  requestOutcome: ApiRequestOutcome;
  cancellationClassification?: "expected_auth_lifecycle";
  elapsedMs: number;
  observedAt: string;
  backgroundObserved: boolean;
  connectivity: "online" | "offline" | "unknown";
  httpStatus?: number;
  reasonCode?: ApiRequestReasonCode;
  correlationId?: string;
};

type ApiFailureInstrumentationPolicy = {
  instrumentDeliveryFailures: boolean;
};

type DiagnosticIngestionTransport = ApiFailureInstrumentationPolicy & {
  path: `/api/${string}`;
};

/**
 * Client-owned diagnostic ingestion transports. Every new transport belongs
 * here so its delivery-failure policy is explicit and reviewable without
 * duplicating the server's route registry.
 */
export const DIAGNOSTIC_INGESTION_TRANSPORTS = {
  fieldCheckObservations: {
    path: "/api/field-checks/observations",
    instrumentDeliveryFailures: false,
  },
  hardwareConfirmations: {
    path: "/api/field-checks/hardware-confirmations",
    instrumentDeliveryFailures: false,
  },
  incidents: {
    path: "/api/incidents",
    instrumentDeliveryFailures: false,
  },
} as const satisfies Record<string, DiagnosticIngestionTransport>;

type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let apiFetchTransport: FetchTransport | null = null;
let installedApiFetchWrapper: typeof fetch | null = null;
const expectedAuthLifecycleAbortSignals = new WeakSet<AbortSignal>();

/** Mark only the signal created for a known React Query auth-probe lifecycle abort. */
export function markExpectedAuthLifecycleCancellation(signal: AbortSignal): void {
  expectedAuthLifecycleAbortSignals.add(signal);
}

export type DiagnosticIngestionTransportName = keyof typeof DIAGNOSTIC_INGESTION_TRANSPORTS;
export const IMPORT_PERFORMANCE_BUDGETS = {
  parseMs: 120_000,
  reviewOpenMs: 2_000,
  commitMs: 10_000,
  exportMs: 10_000,
} as const;

/** Reviewed budget for the first visit to the deferred staff-management surface. */
export const MANAGEMENT_PERFORMANCE_BUDGETS = {
  staffFirstVisitMs: 350,
  staffSurfaceCommitMs: 350,
} as const;

/** Reviewed budget for the first authenticated calculator visit on slow 3G. */
export const AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS = {
  runReadyMs: 10_000,
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

const SAFE_CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function operationCategory(url: string): ApiOperationCategory {
  const path = safePath(url);
  if (/^\/api\/(?:me|auth)(?:\/|$)/.test(path)) return "authentication";
  if (/^\/api\/(?:incidents|field-checks)(?:\/|$)/.test(path)) return "diagnostics";
  if (/^\/api\/(?:spec-import|premix-import|cheese-import|shipping-guide-import|import-operations)(?:\/|$)/.test(path)) return "import";
  if (/^\/api\/(?:sync)(?:\/|$)/.test(path)) return "sync";
  if (/^\/api\/(?:inventory|ingredients)(?:\/|$)/.test(path)) return "inventory";
  if (/^\/api\/(?:mixes|cheese-recipes|dough-recipes|sauce-recipes|named-recipes)(?:\/|$)/.test(path)) return "master_data";
  return "other";
}

function requestRoute(url: string, method: string): ApiRequestRoute {
  const path = safePath(url);
  if (/^\/api\/(?:me|auth)(?:\/|$)/.test(path)) return "authentication";
  if (path === "/api/sync/today") return method === "GET" ? "sync_today_read" : "sync_today_write";
  if (/^\/api\/sync\/\d{4}-\d{2}-\d{2}$/.test(path)) return "sync_dated";
  if (path === "/api/sync/auto-track/claim") return "sync_auto_track_claim";
  if (path === "/api/sync/manual-section") return "sync_manual_section";
  if (path === "/api/sync/operational-intents") return "sync_operational_intents";
  if (path === "/api/sync/events") return "sync_events";
  if (path === "/api/sync/scheduled") return "sync_scheduled";
  if (path.startsWith("/api/sync/")) return "sync_other";
  return "other";
}

async function responseReasonCode(
  response: Response,
  route: ApiRequestRoute,
): Promise<ApiRequestReasonCode | undefined> {
  if (!route.startsWith("sync_") || response.status < 400) return undefined;
  const genericValidationCode = response.status === 400
    ? "SYNC_VALIDATION_FAILED"
    : undefined;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return genericValidationCode;
  }
  const reader = response.clone().body?.getReader();
  if (!reader) return genericValidationCode;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 2048) {
        await reader.cancel();
        return genericValidationCode;
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(
      chunks.reduce((all, chunk) => {
        const joined = new Uint8Array(all.length + chunk.length);
        joined.set(all);
        joined.set(chunk, all.length);
        return joined;
      }, new Uint8Array()),
    );
    const reasonCode = (JSON.parse(text) as { reasonCode?: unknown } | null)?.reasonCode;
    return reasonCode === "SYNC_PAYLOAD_NOT_OBJECT" || reasonCode === "SYNC_PAYLOAD_TOO_LARGE"
      ? reasonCode
      : genericValidationCode;
  } catch {
    // Diagnostics must never change whether the caller receives its response.
    return genericValidationCode;
  } finally {
    reader.releaseLock();
  }
}

function correlationIdFrom(response: Response): string | undefined {
  const value = response.headers.get("x-correlation-id");
  return value && SAFE_CORRELATION_ID.test(value) ? value : undefined;
}

function connectivity(): ApiFailureEvent["connectivity"] {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return "unknown";
  return navigator.onLine ? "online" : "offline";
}

function emitApiFailure(detail: ApiFailureEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ApiFailureEvent>("app:api-failure", { detail }));
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
    : entry.name === "management:staff-surface-commit"
      ? MANAGEMENT_PERFORMANCE_BUDGETS.staffSurfaceCommitMs
    : undefined;
  const authenticatedStartupBudget = entry.name === "startup:home-chunk-load"
    ? AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs
    : undefined;
  const budget = importBudget ?? managementBudget ?? authenticatedStartupBudget ?? (entry.kind === "load"
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
  installApiRequestInstrumentation();

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
 * Raw paths, request/response bodies, and query values are never retained; only
 * a fixed route family and an allowlisted response reason code may be recorded.
 * This is the non-timeout counterpart to fetchWithTimeout.
 */
async function fetchWithFailurePolicy(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  failurePolicy: ApiFailureInstrumentationPolicy,
  transport?: FetchTransport,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const startedAt = typeof performance === "undefined" ? null : performance.now();
  const startedWallTime = Date.now();
  const operation = operationCategory(url);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const route = requestRoute(url, method);
  const callerSignal = init?.signal ?? request?.signal;
  const mayBoundRead = failurePolicy.instrumentDeliveryFailures &&
    (method === "GET" || method === "HEAD") && !callerSignal;
  const timeoutController = mayBoundRead ? new AbortController() : null;
  const requestInit = timeoutController
    ? { ...init, signal: timeoutController.signal }
    : init;
  let hiddenObserved = typeof document !== "undefined" && document.visibilityState === "hidden";
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") hiddenObserved = true;
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  const timeoutId = timeoutController
    ? setTimeout(() => timeoutController.abort(new DOMException("Request timed out", "TimeoutError")), DEFAULT_READ_REQUEST_TIMEOUT_MS)
    : undefined;
  const elapsedMs = () => Math.max(0, Math.min(MAX_REQUEST_ELAPSED_MS, Date.now() - startedWallTime));
  const reportFailure = (
    requestOutcome: ApiRequestOutcome,
    fields: {
      httpStatus?: number;
      reasonCode?: ApiRequestReasonCode;
      correlationId?: string;
      cancellationClassification?: ApiFailureEvent["cancellationClassification"];
    } = {},
  ) => {
    const duration = elapsedMs();
    emitApiFailure({
      operationCategory: operation,
      requestRoute: route,
      requestOutcome,
      elapsedMs: duration,
      observedAt: new Date().toISOString(),
      backgroundObserved: hiddenObserved,
      connectivity: connectivity(),
      ...(fields.cancellationClassification
        ? { cancellationClassification: fields.cancellationClassification }
        : {}),
      ...(fields.httpStatus === undefined ? {} : { httpStatus: fields.httpStatus }),
      ...(fields.reasonCode === undefined ? {} : { reasonCode: fields.reasonCode }),
      ...(fields.correlationId === undefined ? {} : { correlationId: fields.correlationId }),
    });
    if (startedAt !== null && typeof performance !== "undefined") {
      recordPerformance(`api-request-failure:${operation}:${requestOutcome}`, duration, "api");
    }
  };
  try {
    const send = transport ?? apiFetchTransport ?? globalThis.fetch.bind(globalThis);
    const response = await send(input, requestInit);
    if (startedAt !== null && typeof performance !== "undefined") {
      recordPerformance(`api:${operation}:${response.status}`, performance.now() - startedAt, "api");
    }
    if (failurePolicy.instrumentDeliveryFailures && !response.ok) {
      const reasonCode = await responseReasonCode(response, route);
      const requestOutcome = response.status >= 500
        ? "http_server_error"
        : response.status === 401 || response.status === 403
          ? "authentication_rejected"
          : "http_client_error";
      reportFailure(requestOutcome, {
        httpStatus: response.status,
        reasonCode,
        correlationId: correlationIdFrom(response),
      });
    }
    return response;
  } catch (err) {
    // Diagnostic ingestion must not observe its own transport failures. Doing
    // so can feed an ingestion outage back into the same passive field-check
    // stream and amplify retries. Successful delivery remains measurable.
    if (failurePolicy.instrumentDeliveryFailures) {
      const errorName = (err as { name?: unknown } | null)?.name;
      const activeSignal = timeoutController?.signal ?? callerSignal;
      const signalReasonName = activeSignal?.reason?.name;
      const requestOutcome: ApiRequestOutcome =
        errorName === "TimeoutError" || signalReasonName === "TimeoutError"
          ? "timeout"
          : errorName === "AbortError" || activeSignal?.aborted
            ? "cancelled"
            : connectivity() === "offline"
              ? "offline_failure"
              : "transport_failure";
      reportFailure(requestOutcome, {
        ...(requestOutcome === "cancelled" && operation === "authentication" &&
            route === "authentication" && activeSignal &&
            expectedAuthLifecycleAbortSignals.has(activeSignal)
          ? { cancellationClassification: "expected_auth_lifecycle" as const }
          : {}),
      });
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  }
}

export function fetchWithDiagnostics(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithFailurePolicy(url, init, { instrumentDeliveryFailures: true });
}

export function fetchDiagnosticIngestion(
  transportName: DiagnosticIngestionTransportName,
  init?: RequestInit,
): Promise<Response> {
  const transport = DIAGNOSTIC_INGESTION_TRANSPORTS[transportName];
  return fetchWithFailurePolicy(transport.path, init, transport);
}

function sameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && /^\/api(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function isDiagnosticDelivery(input: RequestInfo | URL, init?: RequestInit): boolean {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method !== "POST") return false;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, window.location.origin).pathname;
    return path === "/api/incidents" ||
      path === "/api/field-checks/observations" ||
      path === "/api/field-checks/hardware-confirmations";
  } catch {
    return false;
  }
}

/** Instrument same-origin API calls that still use the browser's raw fetch API. */
export function installApiRequestInstrumentation(): () => void {
  if (typeof window === "undefined" || installedApiFetchWrapper) return () => {};
  const original = window.fetch.bind(window);
  apiFetchTransport = original;
  const wrapper: typeof fetch = (input, init) => {
    if (!sameOriginApiRequest(input) || isDiagnosticDelivery(input, init)) {
      return original(input, init);
    }
    return fetchWithFailurePolicy(input, init, { instrumentDeliveryFailures: true }, original);
  };
  installedApiFetchWrapper = wrapper;
  window.fetch = wrapper;
  return () => {
    if (window.fetch === wrapper) window.fetch = original;
    if (installedApiFetchWrapper === wrapper) {
      installedApiFetchWrapper = null;
      apiFetchTransport = null;
    }
  };
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