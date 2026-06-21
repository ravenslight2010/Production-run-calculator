import type { Request, Response, NextFunction } from "express";

// Defense-in-depth stale-data protection for shared, frequently-edited JSON GETs.
//
// Several endpoints serve shared data — settings, staff rosters, password-reset
// requests, learned aliases/corrections, denied-merge pairs, inventory,
// incidents, runs — that one user edits and others read. Without explicit cache
// headers, browsers (and intermediaries) apply heuristic freshness and serve a
// stale copy, so even a periodic refetch or an SSE-nudged refetch keeps
// returning the old data until a full reload. Sending no-store guarantees edits
// propagate to other clients within seconds.
//
// Rather than rely on each handler remembering to call `noStore(res)` (easy to
// forget on a brand-new route), `noStoreMiddleware` applies the no-store triplet
// automatically to every GET response EXCEPT the explicitly excluded routes
// below. The rule is therefore on-by-default and can't be forgotten.

// Mark a JSON GET response as never-cacheable.
export function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

// GET routes that intentionally do NOT send no-store. Keyed by the exact route
// path string as written in `router.get("…")`; each entry carries a reason so
// the exception stays auditable. This is the single source of truth — both the
// middleware (runtime) and the structural guard test consume it.
//
// See `.agents/memory/no-store-cache-headers.md` for the sync-vs-inventory
// (full-payload-SSE vs nudge-SSE) exclusion rationale.
export const CACHE_CONTROL_EXCLUSIONS: Record<string, string> = {
  "/healthz": "Public platform health probe — must stay freely cacheable.",
  "/auth/username-available":
    "Transient public availability lookup, not shared mutable list data — not subject to the stale-list bug.",
  // Live-sync SSE pushes the FULL day-state payload to clients, so they never
  // rely on a cached GET refetch to observe another user's edit. (Contrast with
  // inventory's SSE, which only nudges, so /inventory IS no-store.)
  "/sync/today": "Live-sync GET; edits arrive via the full-payload SSE push, not a refetch.",
  "/sync/scheduled": "Live-sync GET; edits arrive via the full-payload SSE push, not a refetch.",
  "/sync/:date": "Live-sync GET; edits arrive via the full-payload SSE push, not a refetch.",
  // SSE streams set their own streaming headers; applying noStore would be wrong.
  "/sync/events": "SSE stream — sets its own streaming headers.",
  "/inventory/events": "SSE stream — sets its own streaming headers.",
};

// Convert an Express route pattern ("/sync/:date") into a matcher against a
// concrete request path ("/sync/2026-06-21"): each segment must match, and a
// `:param` segment matches any single non-slash segment.
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}/?$`);
}

const EXCLUSION_MATCHERS: RegExp[] = Object.keys(CACHE_CONTROL_EXCLUSIONS).map(patternToRegExp);

// True if a concrete request path corresponds to an excluded route pattern.
export function isExcludedFromNoStore(pathname: string): boolean {
  return EXCLUSION_MATCHERS.some((re) => re.test(pathname));
}

// Router-level middleware: stamps the no-store triplet on every GET response
// whose path is not in CACHE_CONTROL_EXCLUSIONS. Setting the headers up front
// (before the handler runs) means they're present even on 404s and error paths,
// and handlers no longer need to call `noStore(res)` themselves.
export function noStoreMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" && !isExcludedFromNoStore(req.path)) {
    noStore(res);
  }
  next();
}
