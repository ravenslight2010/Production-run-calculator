---
name: v2-browser-regression
description: "Runs or extends signed-in Production Run Calculator (Lucia V2) browser regressions. Use for workbook and schedule imports, product-name changes, run creation, or role-specific production screens."
---

# Production Run Calculator browser regression

Use the existing browser harness before adding a new test. Read
[`artifacts/run-calculator/e2e/README.md`](../../../artifacts/run-calculator/e2e/README.md)
for the current suites, data-safety boundaries, and supported commands.

## Choose the existing check

- Use the `@workspace/run-calculator` test suite for client logic and UI
  contracts:
  `pnpm --filter @workspace/run-calculator run test`.
- Use existing browser specs for user journeys, including
  `artifacts/run-calculator/e2e/import-gold-apply.spec.ts` for workbook Apply
  and persistence, `artifacts/run-calculator/e2e/task3494-audited-import.spec.ts`
  for manager review, apply, history, and reload,
  `artifacts/run-calculator/e2e/workbook-auto-ai-fallback.spec.ts` for workbook
  parsing fallback, `artifacts/run-calculator/e2e/merge-alias-retarget.spec.ts`
  for product-name changes,
  `artifacts/run-calculator/e2e/schedule-dialog-layering.spec.ts` for saved
  schedule date, brand, and cases across reload, and
  `artifacts/run-calculator/e2e/run-startup-slow-network.spec.ts` for run
  startup. Use the relevant role-specific spec for production flows. Follow the
  README's suite/configuration guidance instead of inventing a second harness.
- Use API-server tests for route or database behavior:
  `pnpm --filter @workspace/api-server run test`.
- Use `pnpm --filter @workspace/run-calculator run check:e2e:syntax` for a
  non-destructive browser-spec syntax check; it does not verify runtime behavior.
- Prefer the focused suite that owns the behavior. The full browser command
  resets today's live-day row and must use the approved disposable-database
  setup described in the README.

Browser scenarios must use the project's existing authentication and fixtures.
Do not add another Playwright installation or create an authentication bypass.
Keep test sessions and storage state outside Git.

## Keep test data isolated

- Use a disposable development database and synthetic names or workbooks.
  Never write to production, V1, or a real facility.
- Generate unique data for each run. Remove only fixtures created by that test;
  do not delete unrelated records to reset a test.
- Do not put customer workbooks, personal data, credentials, or session state
  into fixtures, logs, screenshots, or commits.
- Do not mock the API in an end-to-end test whose purpose is to verify
  persistence or shared state.

## Make browser checks reliable

- Prefer accessible role and label locators; use a stable test id only when a
  control has no reliable accessible name. Avoid selectors tied to layout or
  CSS classes.
- Use auto-waiting actions and web-first assertions. Do not add fixed sleeps or
  force clicks to hide a synchronization problem.
- After a consequential save, reload the relevant view and verify persisted
  state. For import and rename/merge flows, inspect the resulting profiles,
  recipe pools, or history as appropriate; for schedule edits, verify the saved
  date, brand, and cases. For stale edits, verify the conflict response and that
  the winning revision remains after reload. Assert the saved data, not only a
  success message.
- Keep expected values independent of the implementation.

## Separate visual previews from signed-in proof

Development-only `__visual-preview` routes use synthetic data and may disable
API writes. Use them for layout checks, but never count them as proof of
authenticated behavior. Report signed-in UI as unverified unless an authenticated
browser scenario actually exercised it.

## Source

This guide adapts selected stable-locator, auto-waiting, and test-isolation
practices from
[`petrkindlmann/qa-skills` `playwright-automation`](https://github.com/petrkindlmann/qa-skills/tree/main/skills/playwright-automation),
licensed under MIT. The upstream license notice is included beside this file.
