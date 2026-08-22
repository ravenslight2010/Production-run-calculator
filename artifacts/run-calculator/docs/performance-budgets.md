# Calculator performance protection

These are client-side regression budgets, measured in the browser and emitted
through the privacy-safe `calculator-performance` event:

| Operation | Budget |
| --- | ---: |
| Initial calculator commit | 1,500 ms |
| Tab transition commit | 250 ms |
| Timed API request | 1,000 ms |

The timing records contain only an operation name, duration, and kind. The
in-memory diagnostic ring retains the latest 40 records and never stores
customer names, recipes, run values, URLs, or response bodies. Slow operations
also produce a console warning with the exceeded budget so local debugging and
release checks can collect actionable evidence.

Run the deterministic protection checks with:

```sh
pnpm --filter @workspace/run-calculator run test:performance
```

The warehouse grouping benchmark uses 20,000 rows and guards the linear
grouping boundary. Browser-level load and navigation measurements are available
to Playwright or a host page by listening for `calculator-performance`.