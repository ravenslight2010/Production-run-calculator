# Import review-open timing verification

Environment: isolated development workspace, 2026-10-23.
Data: synthetic fixtures only; no customer workbooks, production data, or Apply writes.

## Change boundary

Spec, premix, and cheese workbook preparation now start a separate review-open
timer after the existing parse measurement and generation guard. The timer ends
on the first animation frame scheduled by the committed ready review branch,
after its deferred module has loaded and React has initialized the review.
The loading and error branches do not mount the timing marker. Unmounting cancels
the pending frame; a prepared result is recorded once, including StrictMode and
reopening. Timing state is held outside the prepared import object in a WeakMap.

The existing 2,000 ms budget, event names, render classification, parse timing,
prepared data, confirmation, Apply, and persistence behavior are unchanged.
Memory sampling now occurs at the same ready-review boundary as the timing.

## Input and lifecycle inventory

- Existing instrumented workbook paths: spec (single and multiple files),
  premix, and cheese (single and multiple files). Timing starts after their
  shared preparation result, independent of workbook format, layout, locale,
  row contents, deterministic parsing, or AI assistance.
- Normal opening, delayed rendering/deferred loading, threshold equality,
  over-budget opening, replacement, close before frame, rerender, StrictMode,
  and previously measured/untracked result reopening are covered by unit tests.
- Existing spec wizard and premix/cheese merge-reimport tests remain passing.
- Browser fixtures mount the real three dialogs with synthetic empty prepared
  results, without parsing or applying. Normal and injected 2,100 ms waits test
  browser scheduling and warning delivery, not parser throughput.
- Cancelled pickers, failed/stale preparation, and history-only reopening do not
  create new review-open timers. Existing photo/AI retry/history pathways that
  did not emit these three workbook timing events remain unchanged.
- No parser/format/locale or import outcome changes; this is not an exhaustive
  workbook compatibility audit or physical-device performance measurement.

## Results

| Check | Result |
| --- | --- |
| Focused timing, performance diagnostics, spec wizard, premix/cheese merge-reimport suites | PASS: 77 tests across 5 files |
| Deferred Home and workbook boundary tests | PASS: 97 tests |
| Calculator TypeScript check | PASS |
| `CI=true pnpm run typecheck` via the pinned release runner | PASS, including libraries, API, calculator, sandbox, scripts and generated-contract checks |
| Focused Playwright suite | PASS: 24 tests, all three importers per browser/viewport |
| `git diff --check` | PASS |
| Managed calculator workflow restart and fixture screenshot | PASS, using the workflow's actual assigned port |

Browser matrix (emulation, not physical-device proof):

| Viewport | Chromium | WebKit/Safari engine |
| --- | --- | --- |
| Desktop 1280 × 800 | PASS | PASS |
| Phone 390 × 844 | PASS | PASS |
| Tablet portrait 768 × 1024 | PASS | PASS |
| Tablet landscape 1024 × 768 | PASS | PASS |
| Physical Android Chrome | Not applicable: web-only instrumentation | — |
| Physical iOS Safari/PWA | — | Not applicable: web-only instrumentation |

Focused commands, from `artifacts/run-calculator`, with the repository's pinned
Node and pnpm selected:

```sh
pnpm exec vitest run src/importReviewTiming.test.tsx src/performanceDiagnostics.test.ts src/components/__tests__/SpecImportDialog.steps.test.tsx src/components/__tests__/PremixImportDialog.mergeReimport.test.tsx src/components/__tests__/CheeseImportDialog.mergeReimport.test.tsx
pnpm exec playwright test --config playwright.import-review-timing.config.ts
```

The focused browser configuration serves a development-only fixture and requires
no API, credentials, database, or production build. Under the HTTPS-only release
runner, permit readiness probes only through loopback `NO_PROXY` values in its
child command; keep package acquisition guards and offline package mode enabled.
The focused `.browser.ts` filename keeps this dev-only fixture out of the
production full-browser lanes' default `.spec.ts` discovery.

## Failure ledger and closure

1. **Closed:** inherited pnpm version-switch recursion exhausted process limits
   and prevented shell/app/check startup. Stopped only confirmed recursive
   installers; provisioned the exact pinned manager from integrity-verified HTTPS
   packages in ignored local tooling and repaired its legacy cache-bin entry.
   Bare `pnpm --version` now resolves correctly. Restored calculator, API, and
   sandbox workflows. Earlier client/release workflow attempts did not reach
   project checks; they are not reported as successful full-suite/release runs.
2. **Closed:** three initial unit source-wiring assertions used Vite-transformed
   file URLs. Switched to the repository's package-working-directory convention;
   all focused suites pass.
3. **Closed:** first calculator typecheck used stale local library declarations
   and reported missing existing QC/live-calculation exports. Refreshed those
   declarations; both the calculator and full root typechecks pass without
   changing their source/contracts.
4. **Closed:** the first browser launch blocked its HTTP loopback readiness probe
   behind the package acquisition proxy. Allowed loopback only in the child
   command; retained HTTPS acquisition protection.
5. **Closed:** the initial synthetic spec browser fixture omitted required
   skipped-row metadata, causing the first browser pass to fail/time out.
   Completed and typed all prepared fixtures; added page-error assertions.
   The subsequent entire browser matrix passes.
6. **Closed:** the extra deferred-boundary check initially timed out enumerating
   workspaces through the same broken pnpm bootstrap. With the verified pinned
   manager, all 97 boundary tests pass.
7. **Closed:** initial screenshot used the default port instead of the managed
   workflow's assigned port. The corrected-port screenshot renders successfully.

No unresolved implementation or required verification failures remain.
No follow-ups proposed: the already-listed downstream speed-target and routine
validation tasks cover remaining independent work; no import timing variants
were deferred to another task. No production readiness or release claim is made.
