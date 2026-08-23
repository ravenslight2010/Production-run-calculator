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