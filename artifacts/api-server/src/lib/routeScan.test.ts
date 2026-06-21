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

  it("prepends the mount prefix for a sub-router mounted under a path", () => {
    const root = Router();

    // A sub-router mounted under a *static* prefix: the reported path must be
    // the full `/admin/...` path, not the prefix-less `/...` the sub-router
    // declares internally. Without prefix reconstruction the cache guard would
    // check the wrong path.
    const admin = Router();
    admin.get("/incidents", (_req, res) => res.end());
    admin.get("/incidents/:id", (_req, res) => res.end());
    root.use("/admin", admin);

    // A sub-router's own "/" route is reachable at exactly the prefix.
    const status = Router();
    status.get("/", (_req, res) => res.end());
    root.use("/status", status);

    // A sub-router mounted under a *parametric* prefix: the param name must be
    // preserved in the reconstructed path.
    const org = Router();
    org.get("/members", (_req, res) => res.end());
    root.use("/org/:orgId", org);

    // A nested mount (prefix on prefix) must accumulate both segments.
    const outer = Router();
    const inner = Router();
    inner.get("/leaf", (_req, res) => res.end());
    outer.use("/inner", inner);
    root.use("/outer", outer);

    const found = collectGetRoutePathsFromRouter(root).sort();

    expect(found).toContain("/admin/incidents");
    expect(found).toContain("/admin/incidents/:id");
    expect(found).toContain("/status");
    expect(found).toContain("/org/:orgId/members");
    expect(found).toContain("/outer/inner/leaf");
  });

  it("still reports root-mounted sub-router paths without a spurious prefix", () => {
    const root = Router();
    const sub = Router();
    sub.get("/nested/:id", (_req, res) => res.end());
    // Mounted at root (no prefix) — the path must be reported unchanged.
    root.use(sub);

    expect(collectGetRoutePathsFromRouter(root)).toContain("/nested/:id");
  });

  it("returns an empty list for a router with no routes", () => {
    expect(collectGetRoutePathsFromRouter(Router())).toEqual([]);
  });
});
