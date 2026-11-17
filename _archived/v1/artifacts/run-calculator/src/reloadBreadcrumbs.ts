// Diagnostic breadcrumbs for the "page reloads during mass import" report.
// Every page load logs (a) HOW the page was loaded (navigate/reload/back_forward)
// and (b) the last recorded in-app action before the previous page went away,
// so the browser console tells us exactly what killed the page and when.
// Cheap (console + sessionStorage only) and safe to leave in production.

const KEY = "run-calc-last-breadcrumb";
const PREV_KEY = `${KEY}-prev`;

// How recent the interrupted action must be for the app to treat this load as
// "the page died mid-action" (vs. an ordinary later visit).
const INTERRUPTED_MAX_AGE_MS = 2 * 60 * 1000;

type Crumb = { action: string; t: number };

// Action recorded just before the PREVIOUS page went away, captured once at
// load (then the stored keys are cleared so it can never replay on a later,
// unrelated navigation). Only set when the action was recent.
let lastActionBeforeLoad: string | null = null;

export function getLastActionBeforeLoad(): string | null {
  return lastActionBeforeLoad;
}

export function noteBreadcrumb(action: string) {
  try {
    const prev = sessionStorage.getItem(KEY);
    if (prev) sessionStorage.setItem(PREV_KEY, prev);
    sessionStorage.setItem(KEY, JSON.stringify({ action, t: Date.now() } satisfies Crumb));
  } catch {
    // sessionStorage unavailable — breadcrumbs are best-effort only.
  }
  console.info(`[breadcrumb] ${action}`);
}

function parseCrumb(raw: string | null): Crumb | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Crumb>;
    if (typeof parsed.action !== "string" || typeof parsed.t !== "number") return null;
    return { action: parsed.action, t: parsed.t };
  } catch {
    return null;
  }
}

function reportLoad() {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    console.info(`[breadcrumb] page loaded (type: ${nav?.type ?? "unknown"})`);
    const crumb = parseCrumb(sessionStorage.getItem(KEY));
    const prevCrumb = parseCrumb(sessionStorage.getItem(PREV_KEY));
    // Consume the crumbs: a breadcrumb describes ONE page teardown and must
    // never replay into a later, unrelated navigation.
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(PREV_KEY);
    if (!crumb) return;
    const ageSec = Math.round((Date.now() - crumb.t) / 1000);
    console.info(`[breadcrumb] last action before this load: "${crumb.action}" (${ageSec}s ago)`);
    // "pagehide" overwrites the real last action as the page dies, so the
    // action BEFORE pagehide is the interesting one.
    const relevant = crumb.action.startsWith("pagehide") ? prevCrumb : crumb;
    if (relevant && relevant !== crumb) {
      console.info(`[breadcrumb] action before that: "${relevant.action}"`);
    }
    if (relevant && Date.now() - relevant.t <= INTERRUPTED_MAX_AGE_MS) {
      lastActionBeforeLoad = relevant.action;
    }
  } catch {
    // Best-effort only.
  }
}

// Module-level init: guard against double-registration (e.g. dev HMR
// re-evaluating this module) so pagehide never writes duplicate crumbs.
declare global {
  interface Window {
    __runCalcBreadcrumbsInit?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__runCalcBreadcrumbsInit) {
  window.__runCalcBreadcrumbsInit = true;
  reportLoad();
  window.addEventListener("pagehide", () => noteBreadcrumb("pagehide (page going away)"));
}
