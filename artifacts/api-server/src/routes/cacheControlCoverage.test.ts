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
import { collectGetRoutePathsFromRouter, listRouteSourceFiles } from "../lib/routeScan";
import router from "./index";

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
  // Discover the real GET routes from the live, assembled router stack (not
  // source text), so an exclusion that points at a GET registered via a
  // sub-router / computed path / router.all is still recognized as valid.
  const allGetPaths = new Set<string>(collectGetRoutePathsFromRouter(router));

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

// Guard the exclusion list against *additions*. The structural guard above only
// checks the forward direction (every exclusion maps to a real route); it does
// NOT stop someone from quietly adding a NEW shared-list GET to the allow-list
// to silence a failing test, which would silently reintroduce the original
// stale-data bug. These two checks make any change to the allow-list a
// deliberate, reviewed act.
describe("no-store exclusion list cannot grow without review", () => {
  // 1. Every exclusion must carry a non-empty, human-readable justification.
  //    A blank/whitespace reason means an undocumented exception slipped in.
  for (const [excludedPath, reason] of Object.entries(CACHE_CONTROL_EXCLUSIONS)) {
    it(`excluded path ${excludedPath} carries a non-empty reason`, () => {
      expect(
        typeof reason === "string" && reason.trim().length > 0,
        `${excludedPath} is in CACHE_CONTROL_EXCLUSIONS without a justification. ` +
          `Every cache exception must document WHY it is safe to serve cacheable ` +
          `(e.g. it is not shared mutable list data, or edits arrive via full-payload SSE).`,
      ).toBe(true);
    });
  }

  // 2. Snapshot the known-safe set of excluded paths. Adding a new exclusion is
  //    exactly how the stale-data bug would be reintroduced, so it must be a
  //    deliberate edit to this list — reviewed alongside the cacheControl.ts
  //    change. If you intentionally add/remove an exclusion, update this array.
  // The sync DATA GETs (/sync/today, /sync/scheduled, /sync/:date) were
  // intentionally REMOVED from the exclusion list: caching them caused a
  // production bug where a live user's schedule rendered empty (stale/304) and
  // risked cross-scope contamination (URL cache key carries no scope). They are
  // no-store now. Only the SSE streams and the two genuinely-cacheable public
  // GETs remain excluded. See `.agents/memory/no-store-cache-headers.md`.
  const KNOWN_SAFE_EXCLUSIONS = [
    "/healthz",
    "/auth/username-available",
    "/sync/events",
    "/inventory/events",
  ].sort();

  it("the set of excluded paths matches the reviewed known-safe set", () => {
    const actual = Object.keys(CACHE_CONTROL_EXCLUSIONS).sort();
    expect(
      actual,
      `CACHE_CONTROL_EXCLUSIONS changed. Adding an exclusion suppresses no-store ` +
        `for that GET — if it serves shared mutable data, this reintroduces the ` +
        `stale-data bug other clients see until a full reload. Confirm the new ` +
        `route is genuinely safe to cache, then update KNOWN_SAFE_EXCLUSIONS in ` +
        `this test to record the reviewed decision.`,
    ).toEqual(KNOWN_SAFE_EXCLUSIONS);
  });
});
