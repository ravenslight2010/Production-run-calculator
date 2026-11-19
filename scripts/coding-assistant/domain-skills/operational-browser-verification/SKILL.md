---
name: operational-browser-verification
description: Verify manager-facing operational workflows in a real browser, including authorization, scoped navigation, queue actions, import-review reopening, sync diagnostics, reload persistence, and startup health. Use when a request needs user-journey evidence that unit, API, integration, visual, or accessibility checks cannot provide.
---

# Operational Browser Verification

Use this skill for a bounded, evidence-driven browser check of a manager workflow. It
supplements the existing `testing` skill; it does not replace Playwright, its
testing subagent, the repository's test projects, or specialist validation skills.

## When to use

Trigger this skill when the requested verification involves one or more of:

- a manager-only queue, review, approval, assignment, or source-workflow link;
- import history, a saved review snapshot, reopening a review, or visible import errors;
- sync status, sync diagnostics, stale updates, acknowledgement, or a diagnostic
  download;
- navigation, browser back, reload, cold boot, local-storage/server reconciliation,
  or state that must survive a page refresh;
- confirming the application and its backend start cleanly before testing or release.
- live-station run switching/reload where Packaging, Sauce, or Frontline
  automatic counters must remain attached to the correct run.

Do not use it as a substitute for:

- unit or pure calculation coverage;
- direct API contract or authorization tests (route those to API/integration checks);
- database-only state checks;
- screenshot, layout, visual-regression, keyboard, or screen-reader audits;
- load, performance, real-device mobile, or production-data mutation testing.

Responsive web behavior at a specified viewport is in scope. Real mobile hardware is
out of scope unless the request explicitly requires device-only behavior.

## Boundary with general testing

Use the general `testing` skill for a focused browser flow whose evidence is
limited to user-visible behavior. Use this skill when the flow also needs
manager/capability authorization, facility scoping, source-workflow
navigation, import-review reopening, sync diagnostics, reload persistence, or
startup/log evidence. It supplements rather than replaces ordinary Playwright
coverage and API/integration tests.

## Required test-plan contract

Before asking the browser tester to run, write a plan with every field below. A plan
missing a concrete fixture, role, scope, navigation path, or evidence expectation is
not ready.

```text
Goal: one user journey and the operational risk it covers
Application/artifact: preview path and relevant workflow name
Setup data:
  - unique fixture names/IDs (generate with nanoid or the repository's uid helper)
  - how each record is created (UI, [API], or [DB])
  - cleanup, if the fixture is mutable
Authentication:
  - login/sign-up method and test account
  - required role/capabilities
Facility scope:
  - facility/customer/scope value
  - how the account and fixture are constrained to that scope
Viewport: explicit width × height when responsive layout matters; otherwise desktop
Navigation:
  - exact starting route
  - visible labels, roles, or data-testid selectors for each transition
  - dialogs, menus, downloads, and back/reload actions
Expected evidence:
  - visible text/state after each meaningful action
  - URL/tab/selection and persisted state after reload
  - DB/API result only when it corroborates the browser result
  - screenshots at the key before/after state
  - browser console and backend log outcome
```

Keep one user journey per tester request. Use `[New Context]`, `[Browser]`,
`[API]`, `[DB]`, and `[Verify]` steps understood by the existing `testing` skill.
Keep `[Verify]` blocks read-only, and batch checks only when no action occurs
between them. Read `testing/database-testing.md` when direct database setup or
assertion is needed. Read the appropriate auth testing skill when the application
uses Clerk or another special authentication path.

## Authentication and scoped fixtures

1. Start with a fresh browser context unless continuing a tester is specifically
   useful. A persistent tester may lose its browser/session, so a follow-up must say
   how to sign in again.
2. Use a unique username, email, title, brand, customer, import label, and IDs.
   Never assume counts or rely on pre-existing development data.
3. Establish the role and capability required by the UI, not merely a role label.
   Verify the manager account can see the manager-only surface before testing its
   actions. Also run a non-manager denial check when authorization is part of the
   request.
4. Set a concrete facility/customer scope and use the same scope in all fixture
   records. Check that a record from another scope is not exposed if isolation is
   part of the risk.
5. Prefer API or DB setup for deterministic state, then use the browser for the
   user journey. Do not use setup shortcuts to claim that a browser action worked.
6. Do not mutate production data. Clean up created development fixtures and test
   users when the repository's e2e conventions allow it.

## Core operational checks

### Live-station switch and reload

Use one bounded journey, not a broad production simulation:

1. Use the repository's reusable authenticated browser fixture when available;
   otherwise document deterministic API/DB setup, manager capability, scope,
   and cleanup in the required plan. Do not invent a second auth harness.
2. Seed two same-day runs: A running with known Packaging, Sauce, and one
   Frontline applicator counter; B pending with staged Dough but zero completion.
3. Open A at one live station, wait for one eligible automatic acknowledgement,
   then switch to B while a controlled A acknowledgement is delayed.
4. Verify B displays zero Packaging/Sauce/applicator completion while preserving
   its staged Dough. Start B and verify its cadence begins from B's own anchors,
   with no immediate pre-Start catch-up.
5. Reload at the explicit desktop or 390×844 viewport under assessment. Verify
   the selected run, counters, and lifecycle remain canonical. Corroborate with
   the date-scoped sync response; inspect browser and backend logs.

This browser journey proves observable handoff and reload behavior. Server
claim ownership and delayed-promise fencing still require their focused
unit/integration tests.

### Manager action queue

Use a seeded open action with a unique title and known category/severity.

1. Sign in as a manager with the capability that exposes the queue and navigate to
   the manager/setup surface using its visible menu or tab.
2. Verify the queue is visible, the fixture title/description/source category and
   current status are visible, and the non-manager state is restricted when needed.
3. Exercise one action at a time: open the source link, claim or assign the item,
   change status, and add a note where relevant. Confirm the destination is the
   source workflow, not just that an anchor exists.
4. Refresh the queue and verify the saved status/assignee/note remains visible.
5. Include the expected conflict/error state if the request concerns stale versions:
   use two contexts or a controlled version mismatch, expect a visible error, then
   refresh before retrying. Do not call a stale-write rejection a silent success.

Useful current selectors include `data-testid="manager-action-queue"`, the
`Status for <title>` and `Owner for <title>` selects, `Claim`, `Add note`, `Save`,
and `Open source`. Confirm selectors against current source before using them.

### Import-history reopening

Seed or create one import-history record with a saved review snapshot and a unique
source label; also cover a committed record without a snapshot if that distinction
matters.

1. Navigate to the import/review surface and verify the panel and fixture label.
2. Filter by customer scope, import type, and outcome; verify the fixture remains
   and unrelated fixture records are excluded.
3. Expand the record and verify counts, phases, warnings, unresolved/skipped items,
   and follow-up text as applicable.
4. Click `Reopen saved review`. Verify the correct import type and snapshot open in
   the review UI, rather than merely checking that a callback fired.
5. Reload the page or revisit the review route. Verify the reopened review still
   identifies the same snapshot and that a committed/no-snapshot record presents the
   explicit no-saved-review message.

Useful current selectors include `data-testid="import-history-panel"`,
`data-testid="import-history-<id>"`, and the visible `Reopen saved review` button.
Use the current import/reconcile components to identify the destination assertion.

### Sync diagnostics and stale updates

1. Use the current production date and current facility scope. If local diagnostics
   are seeded, include both a current-date event and an older-date event.
2. Open the sync status control, verify its visible status, and download diagnostics.
3. Assert the download is parseable and contains the expected report type, scope,
   production date, status/counters, affected run IDs, and current-date events.
   Assert older-date events are absent when the report is date-bound.
4. For stale-update coverage, use two browser contexts or a controlled stale stamp:
   make the older write, verify it is rejected/ignored visibly, and verify the
   newer value remains after reload. Check that the UI does not show a false success.
5. Record whether the action was local-only, server-persisted, or synchronized; do
   not infer persistence from React state alone.

The sync status button title begins with `Sync:` and the diagnostics action is
`Download sync diagnostics` in the current app. Confirm the live labels before use.

## Validation examples

These are deliberately small plans that demonstrate the required contract without
creating a second test harness. Run them through the existing Playwright testing
subagent and adapt selectors to the current source before execution.

### Example A: manager queue claim and source navigation

```text
Goal: prove a manager can claim a scoped queue item and reach its source workflow.
Application/artifact: Production Run Calculator, preview path `/`, configured web workflow.
Setup data:
  - create `<queue_title>` with a unique suffix, category `sync`, severity `warning`,
    status `open`, and a valid source path using [DB] or the action-queue API
  - retain the item ID and remove the item and test user during cleanup
Authentication:
  - sign in as a newly created manager account with `manage-staff`
  - separately verify a staff account sees the restricted queue message
Facility scope:
  - use `<facility_scope>` for the account and queue item; do not assert global counts
Viewport: 1440 × 1000
Navigation:
  - [Browser] open `/`, dismiss onboarding if shown, use the visible More/menu control
    to reach the manager/setup surface
  - [Verify] `data-testid="manager-action-queue"` and `<queue_title>` are visible
  - [Browser] click `Claim`, then open `Open source`
  - [Verify] the source destination is the expected sync/setup surface
  - [Browser] reload the queue surface
Expected evidence:
  - [Verify] status is `in progress`, assignee is the manager, and the item remains
    after reload; capture before-claim and after-reload screenshots
  - review browser console and backend/workflow logs; report the result using the
    concise report format below
```

### Example B: saved import review survives reopen and reload

```text
Goal: prove a manager can find a scoped import record, reopen its saved review,
and retain the same snapshot identity after reload.
Application/artifact: Production Run Calculator, preview path `/`, configured web workflow.
Setup data:
  - create `<import_label>` and `<customer_scope>` with one completed `spec` history
    record and a saved snapshot using [DB] or the import-history API
  - do not make assertions depend on unrelated pre-existing records; clean up fixtures
Authentication:
  - sign in as a manager with the import/review capability required by the current app
Facility scope:
  - set `<customer_scope>` on the account/fixture and use it in the history filter
Viewport: 1280 × 900
Navigation:
  - [Browser] open `/`, use the visible menu/tab to reach import review history
  - [Browser] fill `Customer scope` with `<customer_scope>`, select `Spec sheets`
    and `Complete`
  - [Verify] `data-testid="import-history-panel"` and
    `data-testid="import-history-<id>"` show `<import_label>`
  - [Browser] expand the record and click `Reopen saved review`
  - [Verify] the review identifies the same `spec` type and snapshot ID
  - [Browser] reload, wait for the authenticated shell and saved-review data
  - [Verify] the same review remains open or is recoverable with the same snapshot ID
Expected evidence:
  - capture the filtered history, reopened review, and post-reload screenshots
  - record visible warnings/unresolved items, browser console, and backend/workflow logs
  - if the record has no snapshot, expect the explicit no-saved-review message instead
```

### Reload, reopen, and navigation persistence

Test persistence as a separate browser action, not as a continuation of an in-memory
assertion:

1. Select a non-default tab or edit a persisted value.
2. Verify it immediately, then call `page.reload({ waitUntil: "domcontentloaded" })`.
3. Wait for the authenticated shell and baseline data, then verify the same tab/value
   is restored and no blank/default state overwrote it.
4. Exercise browser Back where navigation owns history: it should unwind tab history
   before leaving the app. Invalid stored navigation values should fall back safely.
5. For a receiving-device scenario, seed server data before opening the app, then
   reload after hydration. Do not seed after mount and mistake an SSE baseline race
   for a persistence failure.

### Workflow startup

Before browser assertions, ensure the relevant configured workflow is running and
the preview is reachable. After code, package, or run-command changes, restart the
existing workflow rather than creating a duplicate. Check startup logs and browser
console logs before declaring the app testable. If the configured workflow cannot
open its expected port, classify the run as environment-blocked until that is fixed.

## Routing to the right check

| Question | Primary check | Browser skill's role |
| --- | --- | --- |
| Does a route accept/reject a payload or status correctly? | API/integration test | Add browser coverage only for the user-visible consequence |
| Do two devices merge or reject stale state correctly? | Sync/integration test | Verify visible state, reload, and error messaging |
| Does an import parse/link data correctly? | Import/corpus/unit test | Verify manager navigation, review reopening, and visible warnings |
| Is a release/startup configuration healthy? | Release/workflow checklist | Start/restart, inspect logs, then run a small smoke journey |
| Is layout, contrast, focus, or screen-reader behavior correct? | Visual/accessibility specialist | Include viewport only when it affects the operational journey |
| Does responsive web cover the phone/tablet layout? | Browser check at explicit viewport | Do not create real-mobile testing unless device-only behavior is required |
| Is data correct in storage? | DB/integration check | Use DB as corroborating evidence, not as proof of browser behavior |

If a check belongs primarily to another specialist, route it there and keep this
skill focused on the browser-observable operational outcome.

## Evidence and reporting

Every run ends with a concise report in this format:

```text
Result: PASS | FAIL | BLOCKED
Journey: <one sentence>
Auth/scope/viewport: <role>, <facility scope>, <width × height>
Checks:
  - PASS/FAIL/BLOCKED — <observable expectation>
Evidence:
  - <screenshot description or download/report artifact>
  - <URL/tab/visible message and persistence result>
Logs:
  - Browser console: clean | relevant entries
  - Backend/workflow: clean | relevant entries
Failure classification: application defect | test/setup defect | environment blocked
Cleanup: <fixtures/users removed, or why not>
```

Capture screenshots at the meaningful before/after states, not every click. Include
the downloaded diagnostic or review identity when it is the evidence. Review both
browser and backend/workflow logs even on a passing run.

## Failure classification

- **Application defect:** The workflow starts and the planned fixture/auth/scope are
  valid, but the UI shows the wrong state, loses persisted data, exposes restricted
  data, silently accepts a stale action, opens the wrong review/source, or lacks the
  required visible error.
- **Test/setup defect:** The plan used an ambiguous selector, missing capability,
  invalid fixture, wrong scope, non-unique data, or an assertion that depended on
  pre-existing counts. Fix the plan/setup and rerun; do not report this as a product
  bug.
- **Environment blocked:** The workflow cannot start/open its port, preview/auth
  service is unavailable, the database is unavailable, a required secret/integration
  is missing, or the browser/tester cannot reach the artifact. Preserve the logs and
  report `BLOCKED` rather than converting infrastructure symptoms into an app defect.
- **Specialist gap:** The browser journey passes but a route contract, sync invariant,
  import parser, visual/accessibility rule, or release check remains unverified.
  Route that work instead of overclaiming browser coverage.

When a run is blocked, record the first actionable error and stop mutating fixtures.
Retry only after changing the underlying setup or environment, not by repeating the
same browser steps.
