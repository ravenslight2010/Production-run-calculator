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

## Run startup state in browser journeys

For slow-start journeys, verify the selected run's lifecycle state directly and
reselect that run before asserting its controls. The operational-state badge is
not a synchronization acknowledgement and may remain provisional while the
run's controls are usable.

**Why:** Treating the badge as a readiness gate caused false failures in the
isolated WebKit fixture; the run-specific `startedAt` and selected-run controls
were the reliable evidence.

**How to apply:** Before releasing held optional panels, wait for the target
run's start state, select it explicitly, and verify pause/resume plus counters.

## Permission-aware API fixtures

**Rule:** Test API fixtures must derive protected-route responses from the
active fixture user's capabilities, and cover both an authorized identity and
a denied one. Do not return a successful manager-only read just to simplify
operator startup.

**Why:** A permissive fixture can make an application authorization regression
invisible even when the production route correctly rejects the user.

**How to apply:** When a browser test server stubs a capability-gated route,
match its real status contract for reads and writes. Verify the app can still
boot after a denied read separately from verifying the manager's access.

## Reloads with held optional chunks

**Rule:** For deterministic network holds across reloads, block service workers
only in the relevant Playwright test scope; a precached response can bypass
Playwright routing. Do not change the app's service worker for this. Keep each
browser test's date-scoped sync data isolated by cleaning it in the disposable
database between tests and creating a fresh authorized fixture per test.

**Why:** The service worker can satisfy an optional chunk after reload without
reaching the route handler, and day-state rows are shared across fixture users
for the same date. Suite-level cleanup lets sequential tests contaminate one
another.

**How to apply:** When testing reload with a held chunk, verify the request is
still pending before reload, assert the original `startedAt` immediately after
reload, and compare post-release state with a snapshot taken before release.
Pause/resume may adjust `startedAt` to exclude paused time.

## Current-day fixtures after interrupted browser runs

For a journey that assumes one current-day run, delete the disposable live
day-state row under the fixture lock before seeding it, as well as cleaning it
up afterward. The sync merge is additive, so a prior interrupted test can leave
old runs in the same date row even when the new account and profile are unique.

**Why:** A fresh account does not imply a fresh facility day-state row; that row
is shared across fixture users and can survive when a browser process is
interrupted before its `finally` cleanup.

**How to apply:** In approved disposable-database browser tests that seed
`today` and assert the selected run, acquire the shared fixture lock, remove the
current live date row, then write the fixture snapshot and retain normal
`finally` cleanup. Never do this against a shared or production database.

## Reserved ingredient names in full-app browser fixtures

When checking prototype-sensitive ingredient accumulation, keep reserved names
in focused accumulator/API tests and use ordinary live-run data for responsive
full-app browser checks. Seeding `__proto__` as the initial pepperoni type caused
a live-run startup error before the deferred Mix Plan view mounted.

**Why:** The full app runs live applicator setup before the Mix Plan view is
opened, so that unrelated startup path can mask whether the accumulator and
rendered view handle a reserved ingredient key correctly.

**How to apply:** If browser-level reserved-name coverage is needed, isolate the
Mix Plan component or exercise the name through its recipe data without placing
it in the initial live-run form; investigate live-run startup separately.

## Same-origin request diagnostics

**Rule:** Determine cross-origin behavior from the request URL and page origin,
not from the mere presence of an `Origin` header. Same-origin `GET` requests
often omit it, while same-origin `PUT` requests can include it; neither alone
proves a CORS failure. Capture the method, URL origin, safe header names,
response status, and browser failure separately, and redact cookie,
authorization, and client-ID values.

**Why:** A browser can report a failed request near a fixture API route even
when the intended same-origin `GET` succeeded. Distinguishing methods and
responses exposed a fixture's generic `404` on an operator `PUT`, rather than
a cross-origin or preflight problem.

**How to apply:** For WebKit/PWA fixture errors, first check whether `OPTIONS`
was actually sent and whether the browser reached the fixture handler. Model
the endpoint's real authorization status for unsupported fixture writes;
do not add permissive CORS headers to make the test pass.
