# Browser test isolation

For ownership, release relevance, required checks by change category, failure
classification, and bounded coverage gaps, see
[`docs/test-release-matrix.md`](../../../docs/test-release-matrix.md).

## Suite boundaries

| Suite/config | Classification | Database behavior |
| --- | --- | --- |
| `playwright.config.ts` | destructive/live-day | `global-setup.ts` deletes today’s `daily_sync` row once; `screen-off-wake.spec.ts` repeats that reset before each test |
| `playwright.phone.config.ts` | isolated account, non-destructive | no global setup; each account name is unique and created accounts are removed in `afterAll` |
| `playwright.a11y.config.ts` | isolated sandbox, non-destructive | no global setup; axe scans public and sandbox-authenticated screens without deleting live-day data |
| `playwright.visual.config.ts` | isolated account, non-destructive | no global setup; the visual suite creates unique accounts and removes them in `afterAll` |
| `playwright.management-performance.config.ts` | isolated account, non-destructive | authenticated startup and deferred staff-management budgets; created accounts are removed in `afterAll` |
| `playwright.pwa.config.ts` | read-only filesystem fixture | builds two temporary sites, serves them on a temporary localhost port, and removes the directory and server in `finally` |
| `playwright.pwa-morning.config.ts` | isolated account, disposable database | tablet-sized stale-day → one sign-in → mount-time rollover smoke; attaches request and browser-log evidence |
| `playwright.smoke.config.ts` | cross-device release signal | runs the compact sign-in → start/pause/resume → reload → one failed sync pull → online recovery journey at desktop and phone sizes |
| `playwright.multi-device.config.ts` | two-context convergence lane | one throwaway account is cloned into independent desktop and phone contexts for simultaneous edits, offline wake, deletion, reset, reload, and canonical-state checks |

The phone and PWA configs intentionally do not extend the main config. This
prevents destructive live-day setup from being inherited by independent layout
and service-worker checks.

Run the tablet-sized PWA morning-login smoke with an approved disposable
database:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:pwa-morning
```

The smoke captures the single sign-in, authenticated Home result, relevant
auth/sync responses, and browser errors in
`pwa-morning-login-evidence.json`. It does not replace the physical iPad
follow-up: launch the app from the iPad Home Screen after a stale local-day
rollover, confirm one sign-in reaches Home and stays there, then separately
confirm an already-active session still requires the next day's sign-in.

## Database safety

Any fixture that deletes or resets live-day data must call the shared safety
guard. It only permits:

- a local PostgreSQL host;
- a database whose name contains an explicit `e2e`, `test`, or `tmp` marker; or
- the two explicit approved-mode variables:
  `E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1`.

`REPLIT_DEV_DOMAIN` is not a database safety signal. Never point these tests at
production or a shared operational database. A rejected run fails before a
connection or delete is attempted.

## Test data lifecycle

Browser-created users are unique per test and are tracked for cleanup. Tests
that verify reload or a fresh browser session keep their account until the
suite finishes; cleanup happens afterward. Server-created profiles, mixes, and
suggestions are removed by the owning suite using their unique IDs/names.
PWA fixture directories and HTTP servers are always closed in `finally`.

## Supported commands and order

Run the independent suites in either order; they do not share Playwright
global setup:

```sh
pnpm --filter @workspace/run-calculator run test:pwa-handoff
pnpm --filter @workspace/run-calculator run test:e2e:phone
pnpm --filter @workspace/run-calculator run test:e2e:a11y
```

Run the authenticated startup budget guard separately from the destructive
main config:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:management-performance
```

Run the recurring cross-device smoke matrix before release checks. It is a
small lifecycle signal, not a replacement for the focused wake, timer, mobile
layout, or failed-write suites:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:smoke
```

Run the two-browser sleep/offline/wake/reset convergence matrix with the same
disposable-database boundary:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:sync-convergence
```

This matrix verifies deletion tombstones, reload persistence, reset epochs,
client-date-scoped reads, and conditional unchanged responses in both desktop
and phone-sized Chromium contexts.

Run the standard two-context convergence lane when a change can be affected by
independent client state, shared counters/timers, collaborative actions,
offline recovery, or reset/deletion ordering:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:multi-device
```

The lane is serialized and has a 180-second suite budget. Device A is a
desktop-sized Chromium context and device B is a phone-sized Chromium context,
both using the same throwaway account, facility scope, local date, and run.
The contexts retain separate cookies/localStorage, and the harness can hold a
specific sync write, toggle one device offline, and coordinate wake/reload from
observable state. Every scenario checks both device views/local state and the
canonical `/api/sync/today` response. Failures retain labeled diagnostics and
one screenshot per device.

Use focused unit/API tests first for pure math, merge, or endpoint contracts;
add this lane when the risk is independent client convergence. It is not a
responsive-layout substitute (one context at two widths), a multi-user
authorization test, a load test, or a replacement for the existing
`test:e2e:sync-convergence` suite.

The smoke config uses the same disposable-database safety guard as the
destructive browser suite. It runs one test in each project: Desktop Chrome
and a 390×844 phone-sized Chromium layout. The test creates and removes its
own account, and clears only today's disposable live-day row before each
project run.

Run destructive browser coverage only with an approved disposable database:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e
```

The main suite uses one worker to keep its factory-wide live-day reset
deterministic. A failed test may leave its own temporary server data behind;
rerun the suite only after confirming the disposable database boundary. The
global reset removes today’s live-day row before the next run, while per-suite
cleanup removes tracked accounts and entity fixtures.

The main config enumerates 100 cases and retains
`release-evidence/browser-full/FINAL-REPORT.md` after a real full-suite run.
The report includes the revision, completion counts, total duration, and
per-file test-result durations. Discovery (`--list`) and focused runs do not
overwrite a retained full-suite report. The release checker supplies the
revision-bound output path and verifies the report before accepting `GO`.


## Visual regression baselines

The visual suite is intentionally small: it covers a live production run, Mix
Plan, the Excel import review, the ended-run compact strip, and a phone stop
dialog. It uses a unique account, a generated workbook, and masks clocks,
timestamps, and date controls so snapshots describe layout rather than test
data or wall-clock time.

Run the comparisons with a disposable or explicitly approved test database:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:visual
```

To intentionally update baselines, review the resulting images locally and
rerun with Playwright's explicit update flag:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator exec playwright test \
  --config playwright.visual.config.ts --update-snapshots
```

Never add `--update-snapshots` to CI. A failed comparison leaves the actual
image, expected image, and diff in `test-results/`; inspect all three before
accepting a baseline change. If the suite cannot reach the app, first start
the API and web workflows and verify `PLAYWRIGHT_BASE_URL`.

Run destructive browser coverage only with an approved disposable database:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e
```

The main suite uses one worker to keep its factory-wide live-day reset
deterministic. A failed test may leave its own temporary server data behind;
rerun the suite only after confirming the disposable database boundary. The
global reset removes today’s live-day row before the next run, while per-suite
cleanup removes tracked accounts and entity fixtures.

## Accessibility smoke gate

Run `pnpm --filter @workspace/run-calculator run test:e2e:a11y` against the
artifact-managed app. It runs the sign-in, live run, manager setup, and import
review states at desktop and phone sizes without `global-setup.ts`, so it does
not clear `daily_sync`. Failures include the screen name, axe rule, affected
selector, and remediation summary. The suite is intentionally a separate gate;
it is not part of the client unit-test command.
