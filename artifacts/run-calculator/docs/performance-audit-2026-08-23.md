# Production Run Calculator efficiency audit

Date: 2026-08-23

## Scope and safety bar

This audit measured the calculator before making changes, inspected the
ownership boundaries around `Home` and `LiveRunProvider`, and retained only
changes that improved a shipped metric without moving ownership of live
calculations, auto-tracking, synchronization, or workbook import behavior.

## Before/after measurements

The current checkout already contains the safe deferrals introduced during the
startup/management-loading work. A candidate change was evaluated during this
audit: moving the run-history Excel export's `xlsx` import behind its click
handler. The candidate was reverted because `xlsx` is also statically imported
by the spec importer/exporter and run-workbook parser, so the production graph
did not materially change.

| Measure | Before | Candidate result / final | Result |
| --- | ---: | ---: | --- |
| Vite production build | 7.55 s | 7.68 s | No improvement; reverted |
| Main JS chunk | 2,446.33 kB / 681.57 kB gzip | 2,446.64 kB / 681.72 kB gzip | No improvement; reverted |
| Largest optional HEIC chunk | 1,352.90 kB / 341.41 kB gzip | unchanged | Already deferred at the call site |
| CSS | 184.49 kB / 26.35 kB gzip | unchanged | Unchanged |
| Precache payload | 4,039.04 KiB | 4,039.34 KiB | No improvement; reverted |
| Calculator unit tests | 2,265 passed / 213 files | 2,265 passed / 213 files | Passed |
| Performance protection tests | not separately run in baseline | 15 passed / 3 files | Passed |
| Typecheck | not separately run in baseline | passed | Passed |

The small candidate-size difference is build/minifier variance and is not a
user-visible win. It was intentionally not retained.

Browser preview evidence on the final build reached the sign-in shell at the
calculator workflow port (1280×720). Its unauthenticated navigation timing was
2,156 ms to DOM content loaded and 2,192 ms to load. The local development
session also recorded HMR updates of 3,694–4,252 ms; these are development
measurements only and are not treated as a shipped optimization target.

## Ownership and dependency findings

- `LiveRunProvider` owns the one live clock, calculation result, timer
  countdowns, and auto-track integration. It must remain a shared provider.
- `Home` owns form state, persistence, sync, and import orchestration. Moving
  those across deferred boundaries would risk stale forms, lost writes, or
  duplicate stores.
- Management staff and management AI/review surfaces are deferred and have
  explicit load timing and error fallbacks.
- Warehouse-only polling and QC surfaces are already deferred by their
  department boundaries.
- HEIC conversion is already dynamically imported only for HEIC/HEIF files.
- Workbook parsing and spec import/export share `xlsx` in the startup graph.
  Removing it from startup requires splitting the complete workbook workflow,
  not a single export call.

## Retained safe improvements

The audit retains the existing measured startup improvements:

1. Staff management is loaded only when its management surface is opened.
2. Management AI/review code is loaded only when its tab is opened.
3. QC and warehouse-only work is deferred from the calculator startup path.
4. Browser diagnostics cover navigation, tab transitions, render commits, HMR,
   API timings, calculation timings, storage scans, deferred work, and optional
   Chromium heap samples.

These changes preserve the shared operational owners and have dedicated
performance/browser protection coverage.

## Regression coverage

Run during this audit:

- `pnpm --filter @workspace/run-calculator run build`
- `pnpm --filter @workspace/run-calculator run typecheck`
- `pnpm --filter @workspace/run-calculator run test -- --run`
- `pnpm --filter @workspace/run-calculator run test:performance`

The full calculator suite passed: 213 files and 2,265 tests. The focused
performance suite passed: 3 files and 15 tests.

The existing browser performance journey
(`e2e/management-performance.spec.ts`) remains the required evidence for
authenticated startup, deferred staff loading, API request capture, timing
budgets, and desktop manager navigation. An attempted run during this audit
was correctly blocked by the destructive-database safety guard because the
current task database was not an approved isolated test database. It was not
forced with an override. Production, sync, phone, accessibility, and import
journeys remain protected by the existing Playwright suites and should be run
in the approved isolated test environment before a publish.

## Known bottlenecks and next bounded opportunity

- The main JS chunk remains about 2.45 MB minified because shared `Home`
  orchestration, workbook parsing, spec import/export, and their dependencies
  are coupled in the startup graph.
- The HEIC converter is large, but it is already an optional chunk and should
  not be moved into the initial bundle.
- A future workbook-boundary project could dynamically load the full run
  workbook and spec workbook workflow together, with an explicit loading state,
  retry, cancellation, and browser evidence. That is broader than this audit
  and should be measured as its own change.
