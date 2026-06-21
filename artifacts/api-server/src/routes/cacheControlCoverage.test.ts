// Structural guard that keeps the no-store rule self-enforcing.
//
// Stale-data protection is now applied by `noStoreMiddleware` (src/lib/
// cacheControl.ts): it stamps the no-store triplet on EVERY GET response whose
// route is not listed in `CACHE_CONTROL_EXCLUSIONS`. So the rule is on by
// default — a brand-new shared-list GET is protected automatically without
// anyone remembering to call `noStore(res)`.
//
// What still needs guarding is the exclusion list. This test (no database, no
// running server) parses every route source file, finds every `router.get(...)`
// registration, and asserts two things:
//   1. No handler still calls `noStore(res)` by hand — the middleware owns this
//      now, and a leftover call signals a half-finished refactor.
//   2. Every entry in `CACHE_CONTROL_EXCLUSIONS` still maps to a real GET route,
//      so a renamed/removed route can't silently leave a stale (over-broad)
//      exclusion behind.
//
// See `.agents/memory/no-store-cache-headers.md` for the sync-vs-inventory
// (full-payload-SSE vs nudge-SSE) exclusion rationale.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { CACHE_CONTROL_EXCLUSIONS } from "../lib/cacheControl";
import { findRegistrations, listRouteSourceFiles } from "../lib/routeScan";

const routesDir = path.dirname(fileURLToPath(import.meta.url));

const routeFiles = listRouteSourceFiles(routesDir);

describe("no-store is middleware-owned (structural guard)", () => {
  // Sanity check: the scan actually found the route files. If this ever reads 0
  // files (e.g. the directory moved), the guard would be silently vacuous.
  it("found route source files to scan", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  // Handlers must no longer call noStore() — noStoreMiddleware applies it for
  // them. A lingering call means the middleware migration was left incomplete.
  for (const file of routeFiles) {
    it(`no handler in ${file} calls noStore() (the middleware owns it)`, () => {
      const source = readFileSync(path.join(routesDir, file), "utf8");
      expect(
        /\bnoStore\s*\(/.test(source),
        `${file} still calls noStore() in a handler. Stale-data protection is now ` +
          `applied by noStoreMiddleware in routes/index.ts — remove the per-handler ` +
          `call (and its import). If this GET should be cacheable instead, add its ` +
          `route path to CACHE_CONTROL_EXCLUSIONS in src/lib/cacheControl.ts.`,
      ).toBe(false);
    });
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

  for (const excludedPath of Object.keys(CACHE_CONTROL_EXCLUSIONS)) {
    it(`excluded path ${excludedPath} still maps to a real GET route`, () => {
      expect(
        allGetPaths.has(excludedPath),
        `${excludedPath} is in CACHE_CONTROL_EXCLUSIONS but no GET route declares it. ` +
          `Remove the stale exclusion.`,
      ).toBe(true);
    });
  }
});
