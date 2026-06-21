// Route discovery shared by the cache-control guards.
//
// Both the structural guard (cacheControlCoverage.test.ts) and the runtime
// integration test (cacheControl.integration.test.ts) need to discover the set
// of GET routes the API actually serves. Discovering them from the *live,
// fully-assembled Express router stack* (rather than regex-scanning source text
// for literal `router.get("…")` calls) means a GET registered in any shape —
// a mounted sub-router, a computed/variable path, or `router.all(...)` — is
// still seen by both guards, so a brand-new shared-data page can't silently ship
// cacheable.
import { readdirSync } from "node:fs";
import type { IRouter } from "express";

// The route source files in a routes directory: real route modules only, never
// test files or the barrel index. Still used by the structural guard to scan
// each handler's source for leftover hand-rolled `noStore(res)` calls.
export function listRouteSourceFiles(routesDir: string): string[] {
  return readdirSync(routesDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
  );
}

// Express Layer internals are not part of the public type surface, so we model
// just the bits we read off the assembled router stack.
interface RouteLike {
  path: string | string[];
  methods: Record<string, boolean>;
}
interface LayerLike {
  route?: RouteLike;
  handle?: { stack?: LayerLike[] };
}

function hasStack(value: unknown): value is { stack: LayerLike[] } {
  // A mounted Express router's `handle` is a *function* (the router itself) that
  // carries its own `.stack`, so we must accept both objects and functions.
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Array.isArray((value as { stack?: unknown }).stack)
  );
}

// Walk a fully-assembled Express router's layer stack and collect every route
// path that responds to GET — including routes mounted via a sub-router, routes
// declared with a computed/variable path, and `router.all(...)` (which also
// answers GET). This sees what Express actually registered, not what the source
// literally spells out, so it can't be fooled by an unusual registration shape.
export function collectGetRoutePathsFromRouter(router: IRouter): string[] {
  const paths = new Set<string>();
  const visited = new Set<unknown>();

  const walk = (stack: LayerLike[] | undefined): void => {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        const methods = layer.route.methods ?? {};
        // `router.all(...)` answers GET; Express marks it with `_all` (and some
        // versions with `all`), so treat either as GET coverage.
        if (methods.get || methods._all || methods.all) {
          const declared = layer.route.path;
          for (const one of Array.isArray(declared) ? declared : [declared]) {
            if (typeof one === "string") paths.add(one);
          }
        }
      } else if (hasStack(layer.handle) && !visited.has(layer.handle)) {
        // A mounted sub-router: recurse into its own layer stack.
        visited.add(layer.handle);
        walk(layer.handle.stack);
      }
    }
  };

  walk((router as unknown as { stack?: LayerLike[] }).stack);
  return [...paths];
}
