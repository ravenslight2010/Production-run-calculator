// Structural guard that makes the no-store rule self-enforcing.
//
// The companion runtime suite (cacheControl.integration.test.ts) asserts the
// `Cache-Control: no-store` header on a *hand-maintained* list of known
// endpoints. That catches a header being *dropped* from an existing route, but
// it is blind to a brand-new shared-list GET added later: nobody adds it to the
// list, so it can ship with no cache header at all and silently reintroduce the
// original "stale list" bug.
//
// This test closes that gap WITHOUT a database or a running server: it parses
// every route source file, finds every `router.get(...)` registration, and
// asserts each handler body either calls `noStore(res)` or is named in an
// explicit, reasoned exclusion list below. Adding a new GET that forgets
// `noStore` (and isn't deliberately excluded) fails here automatically — the
// rule no longer depends on someone remembering to update a list.
//
// See `.agents/memory/no-store-cache-headers.md` for the sync-vs-inventory
// (full-payload-SSE vs nudge-SSE) exclusion rationale.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const routesDir = path.dirname(fileURLToPath(import.meta.url));

// GET endpoints that intentionally do NOT send no-store. Each entry must carry
// a reason so the exception stays auditable. Keyed by the exact route path
// string as written in `router.get("…")`.
const ALLOWED_WITHOUT_NO_STORE: Record<string, string> = {
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

interface RouteRegistration {
  method: string;
  routePath: string;
  startIndex: number;
}

// Find every `router.<method>("<path>", …)` registration in a file, with the
// byte offset where it begins so we can delimit each handler's body.
function findRegistrations(source: string): RouteRegistration[] {
  const re = /router\.(get|post|put|patch|delete|all)\s*\(\s*(["'`])([^"'`]+)\2/g;
  const out: RouteRegistration[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ method: m[1], routePath: m[3], startIndex: m.index });
  }
  return out;
}

// A GET handler "calls noStore" if `noStore(` appears anywhere between this
// registration and the next one (or end of file) — i.e. inside its body.
function bodyCallsNoStore(
  source: string,
  reg: RouteRegistration,
  nextStartIndex: number,
): boolean {
  const body = source.slice(reg.startIndex, nextStartIndex);
  return /\bnoStore\s*\(/.test(body);
}

const routeFiles = readdirSync(routesDir).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
);

describe("every shared-list GET is no-store (structural guard)", () => {
  // Sanity check: the scan actually found the route files. If this ever reads 0
  // files (e.g. the directory moved), the guard would be silently vacuous.
  it("found route source files to scan", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    const source = readFileSync(path.join(routesDir, file), "utf8");
    const regs = findRegistrations(source);
    const gets = regs.filter((r) => r.method === "get");

    for (const reg of gets) {
      it(`GET ${reg.routePath} (${file}) sends no-store or is explicitly excluded`, () => {
        const later = regs
          .map((r) => r.startIndex)
          .filter((idx) => idx > reg.startIndex);
        const nextStartIndex = later.length > 0 ? Math.min(...later) : source.length;

        const callsNoStore = bodyCallsNoStore(source, reg, nextStartIndex);
        const excluded = Object.prototype.hasOwnProperty.call(
          ALLOWED_WITHOUT_NO_STORE,
          reg.routePath,
        );

        if (excluded) {
          // An excluded endpoint must NOT call noStore — if it grows a noStore
          // call, the exclusion is stale and should be removed from the list.
          expect(
            callsNoStore,
            `GET ${reg.routePath} is in the no-store exclusion list (reason: ` +
              `${ALLOWED_WITHOUT_NO_STORE[reg.routePath]}) but now calls noStore(). ` +
              `Remove it from ALLOWED_WITHOUT_NO_STORE.`,
          ).toBe(false);
          return;
        }

        expect(
          callsNoStore,
          `GET ${reg.routePath} in ${file} serves data without calling noStore(res). ` +
            `Shared, frequently-edited JSON GETs must send no-store (see ` +
            `src/lib/cacheControl.ts). If this endpoint is intentionally cacheable ` +
            `(e.g. SSE stream, full-payload sync GET, public probe), add it to ` +
            `ALLOWED_WITHOUT_NO_STORE in this file with a reason.`,
        ).toBe(true);
      });
    }
  }
});

// Guard the exclusion list itself: every excluded path must still correspond to
// a real GET route. A stale entry (route renamed/removed) would silently widen
// the allow-list, so fail if an exclusion no longer matches any GET.
describe("no-store exclusion list has no stale entries", () => {
  const allGetPaths = new Set<string>();
  for (const file of routeFiles) {
    const source = readFileSync(path.join(routesDir, file), "utf8");
    for (const reg of findRegistrations(source)) {
      if (reg.method === "get") allGetPaths.add(reg.routePath);
    }
  }

  for (const excludedPath of Object.keys(ALLOWED_WITHOUT_NO_STORE)) {
    it(`excluded path ${excludedPath} still maps to a real GET route`, () => {
      expect(
        allGetPaths.has(excludedPath),
        `${excludedPath} is in ALLOWED_WITHOUT_NO_STORE but no GET route declares it. ` +
          `Remove the stale exclusion.`,
      ).toBe(true);
    });
  }
});
