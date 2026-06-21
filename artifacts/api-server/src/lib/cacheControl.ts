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

// The cache-control header names noStore() owns. Used to strip any cacheable
// directive a handler tries to pass through `res.writeHead(status, headers)`
// before we re-stamp our own (see installNoStoreGuard).
const CACHE_HEADER_NAMES = new Set(["cache-control", "pragma", "expires"]);

// Wrap `res.writeHead` so the no-store triplet is (re)applied at the very last
// moment before headers flush — even if a handler set its OWN cacheable
// Cache-Control afterwards. Up-front `noStore(res)` alone is not enough: it runs
// before the handler, so a brand-new GET whose handler does
// `res.setHeader("Cache-Control", "max-age=…")` would silently override it and
// ship cacheable. Node routes every response (incl. res.json/res.send, 404s and
// error paths) through writeHead, so this is the single chokepoint that makes
// "non-excluded GET ⇒ no-store" impossible to forget or accidentally undo.
function installNoStoreGuard(res: Response): void {
  const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => Response;
  res.writeHead = function patchedWriteHead(this: Response, ...args: unknown[]): Response {
    // A handler may pass a headers object as the last writeHead arg that re-sets
    // a cacheable Cache-Control; drop any cache directives from it so the
    // noStore() values we set next are authoritative.
    const last = args[args.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last)) {
      const headers = last as Record<string, unknown>;
      for (const key of Object.keys(headers)) {
        if (CACHE_HEADER_NAMES.has(key.toLowerCase())) delete headers[key];
      }
    }
    noStore(res);
    return originalWriteHead(...args);
  } as Response["writeHead"];
}

// Router-level middleware: guarantees the no-store triplet on every GET response
// whose path is not in CACHE_CONTROL_EXCLUSIONS. We set the headers up front (so
// they're observable mid-handler) AND re-stamp them at flush time via
// installNoStoreGuard (so a handler that sets its own cacheable Cache-Control
// can't silently override the guard). Handlers therefore never need to call
// `noStore(res)` themselves, and a brand-new shared GET can't ship cacheable
// unless its route is deliberately added to CACHE_CONTROL_EXCLUSIONS.
export function noStoreMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" && !isExcludedFromNoStore(req.path)) {
    noStore(res);
    installNoStoreGuard(res);
  }
  next();
}
