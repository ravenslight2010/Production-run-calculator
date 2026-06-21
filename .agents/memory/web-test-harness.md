---
name: web run-calculator vitest harness
description: How the web artifact's vitest suite is wired, and the contention rules that keep it from flaking.
---

# run-calculator (web) vitest harness

The web artifact (`artifacts/run-calculator`) is the home for shared web+mobile
unit tests. The mobile artifact has no vitest of its own.

## Testing the mobile module without its native import graph
The mobile copy of a shared pure-logic module (e.g.
`artifacts/run-calculator-mobile/context/fillMissing.ts`) cannot be imported
directly in node/jsdom — its React Native / Expo import graph won't load. The
parity test loads it via a **strip-imports → `typescript.transpileModule` →
temp `.mjs` import** pipeline, with a STUB_PRELUDE supplying the symbols the
stripped imports used to provide. `typescript` resolves from the web artifact
(root devDep); esbuild does not resolve directly. Use this same pattern for any
future web↔mobile parity test of a byte-identical shared module.

**Why:** lets one test drive both the real web module and the mobile source and
assert identical output, satisfying the replit.md parity rule, without standing
up a second RN-capable test runner.

### Rendering a mobile RN *component* (not just pure logic) through the harness
To exercise a mobile React-Native component's behavior in jsdom, strip its
imports, transpile to **CommonJS**, and run it via `new Function("exports",
"require", "React", PRELUDE + outputText)` — inject the test's OWN React (same
instance @testing-library/react renders with; a 2nd copy breaks the hook
dispatcher) and a PRELUDE of tiny host-element stubs for the RN/custom UI the
stripped imports used to provide (`View/Card -> div`, `Text -> span`, `Button ->
real <button>` wired to `onPress` so `fireEvent.click` drives it, the rest ->
null). Export the inner component (e.g. `SuggestionCard`) so it's reachable on
`exports`. Gotcha: every symbol referenced at **module-eval time** must be in the
prelude — `const styles = StyleSheet.create({ ... fontFamily: FONTS.x })` touches
both `StyleSheet` AND `FONTS`, so stub `FONTS` as a `new Proxy({}, { get: () =>
"System" })`. Symbols used only inside un-called functions stay harmless free
identifiers under strict mode. See `recipeAssistApply.test.tsx`.

## Contention is the enemy, not logic
Validation runs **alongside the 4 dev workflows**, which starves Vitest. With
defaults this produced two non-logic failures: a `beforeAll` hook hitting the
10s default while transpiling the mobile module, and "Failed to start forks
worker" when files spin up workers concurrently.

**How to apply:** `vitest.config.ts` sets `fileParallelism: false` (one worker
at a time — kills concurrent fork-startup starvation), `hookTimeout: 60000`,
`testTimeout: 30000`. Keep these. The full suite is legitimately slow on cold
start (~70s, mostly transform+import); a direct single-file `vitest run <file>`
is faster (~43s) but the package `test` script runs *all* files. Don't run cold
vitest inside the 120s bash limit under workflow load — use the validation
harness (`startValidationRun`) or background+poll.

## Live-sync (no-stale-view) component tests
To prove a shared, factory-wide list re-renders another user's edit without a
manual reload, drive the client's REAL refetch path against a mutable fake
server: stub `global.fetch` (route by path) + `global.EventSource` (capture
instances), render the real consumer, mutate the fake server, then fire the
client's own refresh trigger and assert the new data renders. Triggers differ
by list: inventory = an inventory SSE nudge with a FOREIGN `senderId` (a
self-echoed nudge carrying its own `clientId` must NOT refetch); React-Query
lists (production-rules, incidents, staff) = `qc.invalidateQueries`, which must
yield fresh data DESPITE the hook's `staleTime`; learned-memory pools (import/
photo aliases) = an on-demand `fetch*` that must read through every call (no
in-module/snapshot cache). `InventoryTab` reads `AuthContext`, so wrap its
render in the real `AuthProvider` + `QueryClientProvider`. See
`sharedListLiveSync.test.tsx`.

**Why:** server no-store headers can't stop a CLIENT-side cache regression
(staleTime, AsyncStorage/in-module snapshot) from re-introducing a stale view.

## Scope
Test files are excluded from `tsc` (`**/*.test.ts(x)` in tsconfig `exclude`)
repo-wide, so test type errors never break `pnpm run typecheck`; rely on vitest
(esbuild transform) for them. Validation command `test:client` =
`pnpm --filter @workspace/run-calculator run test`.
