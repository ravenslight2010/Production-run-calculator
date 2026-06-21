// Unit test for the live-router GET discovery used by the cache-control guards.
//
// The whole point of introspecting the assembled router stack (instead of
// regex-scanning source text) is to catch GETs registered in unusual ways — a
// mounted sub-router, a computed/variable path, or `router.all(...)`. This test
// builds a router using exactly those shapes and asserts every GET is found, so
// a regression in discovery (which would let a shared page ship cacheable) fails
// here without needing a database or a running server.
import { Router } from "express";
import { describe, it, expect } from "vitest";
import { collectGetRoutePathsFromRouter } from "./routeScan";

describe("collectGetRoutePathsFromRouter", () => {
  it("finds GETs registered in unusual ways and ignores non-GETs", () => {
    const root = Router();

    // 1. A plain literal GET.
    root.get("/plain", (_req, res) => res.end());

    // 2. A GET whose path is a computed/variable value (invisible to a regex
    //    source scan that only matches string literals).
    const computed = "/" + ["computed", "path"].join("-");
    root.get(computed, (_req, res) => res.end());

    // 3. `router.all(...)` — answers every method including GET.
    root.all("/all-methods", (_req, res) => res.end());

    // 4. A GET inside a mounted sub-router.
    const sub = Router();
    sub.get("/nested/:id", (_req, res) => res.end());
    root.use(sub);

    // Non-GETs and middleware must NOT be reported.
    root.post("/write-only", (_req, res) => res.end());
    root.use((_req, _res, next) => next());

    const found = collectGetRoutePathsFromRouter(root).sort();

    expect(found).toContain("/plain");
    expect(found).toContain("/computed-path");
    expect(found).toContain("/all-methods");
    expect(found).toContain("/nested/:id");
    expect(found).not.toContain("/write-only");
  });

  it("returns an empty list for a router with no routes", () => {
    expect(collectGetRoutePathsFromRouter(Router())).toEqual([]);
  });
});
