# Full Browser Release Run

Generated: 2026-08-26T16:08:23.046Z
Revision: bb47c12669bb82b9f41e37810e8cbb5b00ea5b09
Result: FAIL
Expected cases: 99
Enumerated cases: 99
Completed cases: 98
Passed cases: 89
Skipped cases: 4
Failed cases: 5
Not-run cases: 1
Coverage: INCOMPLETE
Duration: 1173854ms

## Per-file duration

| File | Cases | Completed | Passed | Skipped | Failed | Not run | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `artifacts/run-calculator/e2e/accessibility-smoke.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 24954ms |
| `artifacts/run-calculator/e2e/compact-run-strip.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 5700ms |
| `artifacts/run-calculator/e2e/cross-device-smoke.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 8300ms |
| `artifacts/run-calculator/e2e/department-workflow-navigation.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 11500ms |
| `artifacts/run-calculator/e2e/die-tunnel-defaults.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 6200ms |
| `artifacts/run-calculator/e2e/home-navigation-reload.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 15300ms |
| `artifacts/run-calculator/e2e/live-sauce-dough-phone.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 18800ms |
| `artifacts/run-calculator/e2e/management-performance.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 19267ms |
| `artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts` | 5 | 5 | 4 | 0 | 1 | 0 | 102800ms |
| `artifacts/run-calculator/e2e/mix-plan.spec.ts` | 34 | 34 | 31 | 0 | 3 | 0 | 510300ms |
| `artifacts/run-calculator/e2e/phone-layout.spec.ts` | 11 | 11 | 9 | 2 | 0 | 0 | 42430ms |
| `artifacts/run-calculator/e2e/photo-count.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 9100ms |
| `artifacts/run-calculator/e2e/photo-spec-import.spec.ts` | 5 | 5 | 5 | 0 | 0 | 0 | 51600ms |
| `artifacts/run-calculator/e2e/profile-subtab-reload.spec.ts` | 2 | 2 | 2 | 0 | 0 | 0 | 15900ms |
| `artifacts/run-calculator/e2e/pwa-handoff.spec.ts` | 1 | 1 | 1 | 0 | 0 | 0 | 25400ms |
| `artifacts/run-calculator/e2e/run-insights.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 21400ms |
| `artifacts/run-calculator/e2e/screen-off-wake.spec.ts` | 8 | 8 | 8 | 0 | 0 | 0 | 103000ms |
| `artifacts/run-calculator/e2e/sync-convergence.spec.ts` | 7 | 7 | 5 | 2 | 0 | 0 | 47600ms |
| `artifacts/run-calculator/e2e/sync-diagnostics-download.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 14400ms |
| `artifacts/run-calculator/e2e/visual-regression.spec.ts` | 2 | 1 | 0 | 0 | 1 | 1 | 5000ms |
| `artifacts/run-calculator/e2e/warehouse-coverage.spec.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 15800ms |

## Observed failures

- `manager-action-queue-stale.spec.ts:169` — stale update retry flow did not find the expected status control.
- `mix-plan.spec.ts:680` — Pull For Prep did not include a second run added while Mixes was open.
- `mix-plan.spec.ts:1206` — proportional Pull For Prep calculation failed.
- `mix-plan.spec.ts:2496` — retried already-made amount did not survive a later Mix Plan reload.
- `visual-regression.spec.ts:116` — desktop baseline dimensions/content differed; expected 1280×900, received 1280×720.

The four skipped cases are the two physical Android cases in
`phone-layout.spec.ts` and the two physical Android cases in
`sync-convergence.spec.ts`. The visual phone case was not started because the
serial visual suite stopped after the preceding desktop baseline failure.

## Historical duration comparison

Not evaluated: this failed/incomplete run is not eligible to replace or create a
passing full-browser duration baseline.

Per-file durations are the sum of Playwright test-result durations. The
suite remains serial (`workers: 1`) and retains all enumerated cases.