# Full Browser Release Run

**Result:** PASS  
**Date:** 2026-08-25  
**Application:** Production Run Calculator  
**Browser:** system Chromium, one worker  
**Database boundary:** approved disposable-test mode (`E2E_TEST_DB=1` and `E2E_APPROVED_DESTRUCTIVE_MODE=1`)

## Coverage

- 99 test cases were enumerated and covered across the main browser suite.
- 95 test cases passed in the functional batches and final targeted retries.
- 4 physical-device-only cases were skipped as expected (`@real-mobile-browser`).
- The two visual cases passed under the dedicated 1280×900 visual configuration.
- The reviewed Mix Plan and import-review snapshots were regenerated after the stable, intentional baseline drift was confirmed.

## Retained evidence

- `batch-01.log` — 19 passed
- `batch-02-mix-a.log` — 16 passed; two startup retries retained separately
- `batch-03-mix-b.log` — 15 passed; reload persistence retry retained separately
- `batch-04.log` — 21 passed, 2 expected device skips
- `batch-05.log` — 19 passed, 2 expected device skips
- `retry-mix-startup.log` — two initially flaky cases passed
- `retry-mix-reload-pass.log` — reload persistence case passed
- `visual-final-pass.log` — 2 passed

## Startup and logs

- API workflow restarted successfully and `/api/healthz` returned 200.
- Web workflow restarted successfully and Vite became ready.
- Final workflow logs show successful API requests; no web workflow errors or browser console output were reported.

## Cleanup

- Test-only `phonee2e...` accounts: 0 remaining.
- Test-only brand profiles: 0 remaining.
- Disposable current-day `daily_sync` rows: 0 remaining.
- Failure screenshots, traces, diffs, and logs remain in the Playwright output/evidence directories for auditability.