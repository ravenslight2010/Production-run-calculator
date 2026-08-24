# Calculator performance protection

These are client-side regression budgets, measured in the browser and emitted
through the privacy-safe `calculator-performance` event:

| Operation | Budget |
| --- | ---: |
| Initial calculator commit | 1,500 ms |
| Tab transition commit | 250 ms |
| Home render commit | 250 ms |
| HMR update | 1,500 ms |
| Live calculation | 16 ms |
| Persisted run-value storage scan | 100 ms |
| Timed API request | 1,000 ms |
| First authenticated calculator visit on slow 3G | 10,000 ms |
| Workbook parse | 120,000 ms |
| Review open after parse | 2,000 ms |
| Import commit | 10,000 ms |
| Workbook export | 10,000 ms |

The timing records contain only an operation name, duration, and kind. The
in-memory diagnostic ring retains the latest 40 records and never stores
customer names, recipes, run values, URLs, or response bodies. Chromium heap
samples are also bounded to 40 entries and contain byte counts only; browsers
without the optional heap API simply skip sampling. Slow operations also produce
a console warning with the exceeded budget so local debugging and release checks
can collect actionable evidence.

Run the deterministic protection checks with:

```sh
pnpm --filter @workspace/run-calculator run test:performance
```

The warehouse grouping benchmark uses 20,000 rows and guards the linear
grouping boundary. The large-day benchmark constructs persisted/current/summarized
snapshots for 250 runs and protects against reintroducing storage scans while an
operator edits the active run. Browser-level load, render, calculation, storage,
and navigation measurements are available to Playwright or a host page by
listening for `calculator-performance`; import parse, review-open, commit, and
export timings use `import-*` names. Heap samples use `calculator-memory`.

## Startup deferral measurement

The signed-out landing page is measured on both a cold navigation and a warm
reload by the management performance browser check. Both measurements must stay
at or below the 1,500 ms initial-load budget. The check also requires the
normal signed-out `GET /api/me` 401 response and verifies that it does not
produce a console error.

## Authenticated slow-network evidence

The management performance browser check also creates an isolated account,
throttles Chromium to 400 ms latency with 500 Kbps download/upload, and signs
in before waiting for the run tab to become usable. The deferred Home bundle
must load only on that authenticated transition and the run tab must be
visible within 10,000 ms. The attached JSON keeps only pathname, status,
bounded failure text, timing, and network-profile metadata; it never captures
request bodies, response bodies, customer data, or full URLs.

## Workbook startup split evidence

The full workbook workflow is loaded through `loadWorkbookWorkflow` only when
an operator opens or exports a workbook. The production build measured before
the split at 2,446.33 kB minified / 681.57 kB gzip for the main JavaScript
chunk; after the split it measured 2,442.21 kB / 679.40 kB gzip, with an
additional 8.78 kB run-workbook chunk (3.59 kB gzip). The build completed in
9.57 s after the change (7.55 s in the recorded baseline; build time is not a
startup budget).

Import regression coverage remains in `runExcel.test.ts`, the spec-import
tests, and cancellation coverage. Browser verification must confirm the
unauthenticated shell starts without loading the workbook chunk and that the
existing import review flow still opens after the chunk is requested.

The calculator records these additional browser-level signals:

- `browser:navigation-to-dom-content-loaded` and
  `browser:navigation-to-load` capture the full page startup milestones.
- `tab:<name>` captures tab navigation completion.
- `tab-render:<name>` captures the corresponding post-commit render time.
- `hmr:update` captures the Vite development update duration.

The current architecture keeps auth, sync, `LiveRunProvider`, form state, and
shared calculations in `Home`, while management and QC surfaces are composed
inside the same `home.tsx` module. A surface should only be deferred if it can
be extracted without moving those shared owners and if browser measurements show
a meaningful startup improvement without making tab navigation unreliable.