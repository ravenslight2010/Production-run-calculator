const MAX_ENTRIES = 40;
const SLOW_TRANSITION_MS = 250;
const SLOW_LOAD_MS = 1500;

export type PerformanceDiagnostic = {
  name: string;
  durationMs: number;
  kind: "load" | "navigation" | "api";
};

const entries: PerformanceDiagnostic[] = [];

function remember(entry: PerformanceDiagnostic): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("calculator-performance", { detail: entry }));
  }
  const budget = entry.kind === "load"
    ? SLOW_LOAD_MS
    : entry.kind === "api" ? 1000 : SLOW_TRANSITION_MS;
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
}

export const PERFORMANCE_BUDGETS = {
  initialLoadMs: SLOW_LOAD_MS,
  tabTransitionMs: SLOW_TRANSITION_MS,
  apiRequestMs: 1000,
} as const;