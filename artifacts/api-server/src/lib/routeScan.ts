// Lightweight source-level route scanning shared by the cache-control tests.
//
// Both the structural guard (cacheControlCoverage.test.ts) and the runtime
// integration test (cacheControl.integration.test.ts) need to discover the set
// of routes declared across the route source files. Keeping the scan logic here
// means the two tests agree on exactly which routes exist — so a brand-new GET
// is picked up by both without anyone editing a hand-maintained list.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface RouteRegistration {
  method: string;
  routePath: string;
  startIndex: number;
}

// Find every `router.<method>("<path>", …)` registration in a file, with the
// byte offset where it begins.
export function findRegistrations(source: string): RouteRegistration[] {
  const re = /router\.(get|post|put|patch|delete|all)\s*\(\s*(["'`])([^"'`]+)\2/g;
  const out: RouteRegistration[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ method: m[1], routePath: m[3], startIndex: m.index });
  }
  return out;
}

// The route source files in a routes directory: real route modules only, never
// test files or the barrel index.
export function listRouteSourceFiles(routesDir: string): string[] {
  return readdirSync(routesDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
  );
}

// Every distinct GET route pattern declared across the route source files (e.g.
// "/incidents/:id"), exactly as written in `router.get("…")`.
export function collectGetRoutePaths(routesDir: string): string[] {
  const paths = new Set<string>();
  for (const file of listRouteSourceFiles(routesDir)) {
    const source = readFileSync(path.join(routesDir, file), "utf8");
    for (const reg of findRegistrations(source)) {
      if (reg.method === "get") paths.add(reg.routePath);
    }
  }
  return [...paths];
}
