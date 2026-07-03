// Diagnostic breadcrumbs for the "page reloads during mass import" report.
// Every page load logs (a) HOW the page was loaded (navigate/reload/back_forward)
// and (b) the last recorded in-app action before the previous page went away,
// so the browser console tells us exactly what killed the page and when.
// Cheap (console + sessionStorage only) and safe to leave in production.

const KEY = "run-calc-last-breadcrumb";

export function noteBreadcrumb(action: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ action, t: Date.now() }));
  } catch {
    // sessionStorage unavailable — breadcrumbs are best-effort only.
  }
  console.info(`[breadcrumb] ${action}`);
}

function reportLoad() {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    console.info(`[breadcrumb] page loaded (type: ${nav?.type ?? "unknown"})`);
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const { action, t } = JSON.parse(raw) as { action: string; t: number };
      const ageSec = Math.round((Date.now() - t) / 1000);
      console.info(`[breadcrumb] last action before this load: "${action}" (${ageSec}s ago)`);
    }
  } catch {
    // Best-effort only.
  }
}

if (typeof window !== "undefined") {
  reportLoad();
  window.addEventListener("pagehide", () => noteBreadcrumb("pagehide (page going away)"));
}
