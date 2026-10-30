---
name: Web run-calculator Vitest harness
description: How the web artifact's Vitest suite is wired, and the contention rules that keep it from flaking.
---

# Run-calculator web Vitest harness

## Browser trace response-body formats

Handle both `_file` and `_sha1` response-body references when inspecting
Playwright trace archives; check archive members before resolving either.
An empty inline `text` does not override a referenced body: use non-empty
inline text or resolve the archive reference. This also applies to request bodies.

**Why:** The available trace recorder used `_file` in network content metadata.
It can also emit `text: ""` alongside that reference, so testing only whether
the `text` property exists hides the actual payload.
An older `_sha1`-only inspection silently skipped all captured API responses,
which could be mistaken for missing browser evidence.

**How to apply:** Inspect the network schema first, then extract only the
needed sanitized facts. Do not dump request headers, cookies, or entire bodies.

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

## Nested modal measurements

**Rule:** Measure an outer modal's visible-layer state before opening a nested
modal. Modal accessibility behavior may mark the background dialog `aria-hidden`,
causing role-based Playwright locators to stop matching it while the child is open.

**Why:** A nested picker can be working correctly while a later role-based
measurement of the now-hidden parent hangs until the test timeout.

**How to apply:** Capture the parent layer before opening the child, then inspect
the child's visibility, viewport position, and layer while it is open.

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

## Shared factory data across browser projects

**Rule:** Restore any shared factory-data keys changed by an E2E test before
that test ends, even when the browser matrix runs only against a disposable DB.

**Why:** Browser projects in one matrix can reuse that DB sequentially, so one
variant's unique directory entries can accumulate and change what later
variants see.

**How to apply:** Snapshot the canonical value, write unique fixture entries,
and restore the snapshot in `finally` using a fresh master-data epoch.

## Focused edge cases and full-app fixtures

Use focused tests for adversarial input domains and representative valid data
for unrelated full-app journeys.

**Why:** A full-app fixture can fail an earlier invariant before the feature
under test mounts, masking which boundary actually failed.

**How to apply:** Test the target boundary directly, and investigate earlier
startup failures separately rather than counting them as target-feature proof.

## Same-origin request diagnostics

**Rule:** Determine cross-origin behavior from the request URL and page origin,
not from the mere presence of an `Origin` header. Same-origin `GET` requests
often omit it, while same-origin `PUT` requests can include it; neither alone
proves a CORS failure. Capture the method, URL origin, safe header names,
response status, and browser failure separately, and redact cookie,
authorization, and client-ID values.

**Why:** A nearby failed request does not identify a CORS failure or show that
the intended request failed. Method, response and preflight evidence matter.

**How to apply:** Check whether preflight occurred and whether the request
reached its handler. Preserve real authorization behavior in fixtures; do not
add permissive CORS headers to conceal an unrelated failure.
