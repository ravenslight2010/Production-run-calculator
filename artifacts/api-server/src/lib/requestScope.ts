import { AsyncLocalStorage } from "node:async_hooks";

// Data scope for the current request. Every signed-in user operates in exactly
// one scope:
//   • "live"    — the real production data the factory runs on.
//   • "sandbox" — an isolated copy used by the seeded `test` account so people
//                 can poke at every feature without touching live data.
//
// The scope is carried per-request via AsyncLocalStorage so the many DB helpers
// (route handlers and the shared inventory/AI-memory readers alike) can read it
// with `currentScope()` without threading a parameter through every call site.
// Outside a request (startup seeding, integration tests calling helpers
// directly) there is no store, so `currentScope()` falls back to "live" — which
// preserves the original, scope-unaware behavior exactly.
export type Scope = "live" | "sandbox";

const als = new AsyncLocalStorage<Scope>();

export function runWithScope<T>(scope: Scope, fn: () => T): T {
  return als.run(scope, fn);
}

export function currentScope(): Scope {
  return als.getStore() ?? "live";
}
