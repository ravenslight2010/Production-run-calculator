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
type Matcher = (input: string) => { path: string; params: Record<string, unknown> } | false;
interface RouteLike {
  path: string | string[];
  methods: Record<string, boolean>;
}
interface LayerLike {
  route?: RouteLike;
  handle?: { stack?: LayerLike[] };
  // A mounted sub-router layer carries one matcher per declared mount path. In
  // Express 5 (router@2) these replaced the old `layer.regexp`.
  matchers?: Matcher[];
  // `slash` is true for a root mount (`router.use(sub)` / `router.use("/", sub)`):
  // its matcher matches everything and strips no prefix.
  slash?: boolean;
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

// Express 5 (router@2) builds each sub-router mount layer's matcher from
// path-to-regexp and keeps the compiled regexp *inside a closure* — there is no
// longer a `layer.regexp` to read, and the matcher is an opaque function. We
// recover the underlying regexp by briefly intercepting `RegExp.prototype.exec`
// (the matcher calls `regexp.exec(input)` exactly once): the `this` of that call
// is the closed-over regexp. The patch is installed and removed synchronously
// around a single probe, so it never leaks into other code.
function captureMatcherRegExp(matcher: Matcher): RegExp | undefined {
  const original = RegExp.prototype.exec;
  let captured: RegExp | undefined;
  // eslint-disable-next-line no-extend-native
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    if (captured === undefined) captured = this;
    return original.call(this, input);
  };
  try {
    matcher("/\u0000probe\u0000");
  } catch {
    // A matcher should never throw on a string, but if it does we simply fall
    // through with whatever (if anything) was captured before the throw.
  } finally {
    // eslint-disable-next-line no-extend-native
    RegExp.prototype.exec = original;
  }
  return captured;
}

const MOUNT_LEAD = "^(?:";
const MOUNT_SUFFIX = ")(?:\\/$)?(?=\\/|$)";
const SENTINEL = "\u0000MOUNTPARAM";

// Turn a mount-layer matcher regexp into a concrete probe path, substituting a
// unique sentinel segment for each capture group (a `:param`/`*wildcard`). The
// matcher then matches the probe, handing back the concrete prefix plus the
// param *names* — which lets us rebuild the prefix pattern (e.g. `/org/:orgId`).
function buildPrefixProbe(source: string): string | undefined {
  if (!source.startsWith(MOUNT_LEAD) || !source.endsWith(MOUNT_SUFFIX)) {
    return undefined;
  }
  const body = source.slice(MOUNT_LEAD.length, source.length - MOUNT_SUFFIX.length);
  let probe = "";
  let paramIdx = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      // Escaped literal (e.g. `\/` -> `/`): emit the next char verbatim.
      probe += body[i + 1] ?? "";
      i++;
      continue;
    }
    if (c === "(") {
      // A capture group = one param/wildcard segment. Skip to its matching `)`
      // and drop in a unique sentinel that the matcher will capture back.
      let depth = 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === "\\") {
          j += 2;
          continue;
        }
        if (body[j] === "(") depth++;
        else if (body[j] === ")") depth--;
        j++;
      }
      probe += `${SENTINEL}${paramIdx}${SENTINEL}`;
      paramIdx++;
      i = j - 1;
      continue;
    }
    probe += c;
  }
  return probe;
}

// Reconstruct the mount prefix (e.g. `/admin`, `/org/:orgId`) for a sub-router
// layer, or "" when there is no prefix (root mount). Returns "" on anything we
// cannot confidently reconstruct, which preserves the prior root-only behavior.
function reconstructMountPrefix(layer: LayerLike): string {
  // Root mount: matches everything, strips nothing -> no prefix.
  if (layer.slash) return "";
  const matchers = layer.matchers;
  if (!matchers || matchers.length === 0) return "";
  // A layer may carry several matchers (array mount path); the first reflects
  // the primary mount prefix, which is all the cache guard needs.
  const matcher = matchers[0];
  const regexp = captureMatcherRegExp(matcher);
  if (!regexp) return "";
  const probe = buildPrefixProbe(regexp.source);
  if (probe === undefined) return "";
  const matched = matcher(probe);
  if (!matched) return "";
  // `matched.path` is the concrete prefix with sentinels in place of params;
  // `matched.params` maps each param *name* to the sentinel value it captured.
  // Swap each sentinel back to `:name` (longest first so `MOUNTPARAM1` can't
  // clobber a prefix of `MOUNTPARAM10`).
  let prefix = matched.path;
  const entries = Object.entries(matched.params)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of entries) {
    prefix = prefix.split(value).join(`:${name}`);
  }
  // Normalize a trailing slash so joining with nested paths can't double up.
  return prefix === "/" ? "" : prefix.replace(/\/$/, "");
}

// Join a mount prefix with a route path declared inside the sub-router. A
// sub-router's own "/" route is reachable at exactly the prefix, so it must not
// add a trailing slash.
function joinPath(prefix: string, routePath: string): string {
  if (!prefix) return routePath;
  if (routePath === "/") return prefix;
  return prefix + routePath;
}

// Walk a fully-assembled Express router's layer stack and collect every route
// path that responds to GET — including routes mounted via a sub-router, routes
// declared with a computed/variable path, and `router.all(...)` (which also
// answers GET). This sees what Express actually registered, not what the source
// literally spells out, so it can't be fooled by an unusual registration shape.
export function collectGetRoutePathsFromRouter(router: IRouter): string[] {
  const paths = new Set<string>();
  const visited = new Set<unknown>();

  const walk = (stack: LayerLike[] | undefined, prefix: string): void => {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        const methods = layer.route.methods ?? {};
        // `router.all(...)` answers GET; Express marks it with `_all` (and some
        // versions with `all`), so treat either as GET coverage.
        if (methods.get || methods._all || methods.all) {
          const declared = layer.route.path;
          for (const one of Array.isArray(declared) ? declared : [declared]) {
            if (typeof one === "string") paths.add(joinPath(prefix, one));
          }
        }
      } else if (hasStack(layer.handle) && !visited.has(layer.handle)) {
        // A mounted sub-router: recurse into its own layer stack, carrying the
        // reconstructed mount prefix so nested paths report their full path.
        visited.add(layer.handle);
        walk(layer.handle.stack, joinPath(prefix, reconstructMountPrefix(layer)));
      }
    }
  };

  walk((router as unknown as { stack?: LayerLike[] }).stack, "");
  return [...paths];
}
