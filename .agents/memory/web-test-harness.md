---
name: Web run-calculator Vitest harness
description: How the web artifact's Vitest suite is wired, and the contention rules that keep it from flaking.
---

# Run-calculator web Vitest harness

## Contention is the enemy, not logic
Validation runs alongside the development workflows, which can starve Vitest.
Concurrent workers have previously caused "Failed to start forks worker"
failures.

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

## DOM matcher boundary

The web test harness does not load `@testing-library/jest-dom`. Prefer native
DOM assertions such as `getAttribute`, `textContent`, `toBeTruthy`, and
`queryBy*` rather than jest-dom matchers.

**Why:** Jest-dom assertions fail at runtime even when the component and
Vitest transform are otherwise healthy; the suite intentionally has no matcher
setup file.

**How to apply:** When adding component coverage, keep assertions compatible
with the existing Vitest environment or add matcher setup as a deliberate,
repo-wide harness change.

## Dense review surfaces

Entity names can repeat across cards, warnings, and change summaries in import
reviews. Anchor browser assertions to the semantic card boundary before
filtering by entity text.

**Why:** Unscoped role or text locators can resolve several correct copies of
the same name and fail strict-mode checks without detecting a product defect.

**How to apply:** Select the review card collection by its stable semantic or
test-ID boundary, then narrow to the named entity and assert within that card.
