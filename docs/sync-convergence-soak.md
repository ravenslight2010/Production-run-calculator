# Multi-client sync convergence soak

The API-server integration suite
`artifacts/api-server/src/routes/sync.convergence.integration.test.ts` runs a
small, repeatable simulation of three browser clients against the real sync
router. It creates a disposable Postgres database, so it is safe to run without
deleting live-day data.

The focused sync integration suite also includes a large-day wire benchmark:
`artifacts/api-server/src/routes/sync.integration.test.ts`. It sends the same
representative 32-run production day through the complete (pre-optimization)
and partial (optimized) PUT paths and prints comparable request bytes, response
bytes, latency, merge time, retries, and convergence.

## Run it

From the repository root:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/sync.convergence.integration.test.ts
```

Run the large-day comparison with:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/sync.integration.test.ts
```

Look for the `[sync large-day benchmark]` object in the test output. `complete`
is the baseline where every run value is sent; `partial` sends only the changed
run against the returned `snapshotId`. Byte counts are UTF-8 wire payload
lengths, `latencyMs` is the PUT wall-clock time, `mergeMs` is response parsing
and canonical-state adoption time, and `retries` counts additional attempts.
`converged` is true only when the returned canonical snapshot matches the
complete fixture. Compare the `requestSavingsPercent` and
`responseSavingsPercent` fields over repeated runs; server load can make
latencies noisier than the deterministic byte savings.

The test requires the same development `DATABASE_URL` used by the other API
integration suites. The database is created, schema-pushed, used, and dropped
with `WITH (FORCE)` during teardown.

## What it exercises

- Three clients repeatedly edit representative run, recipe, progress, and
  facility data.
- One client goes offline, queues writes, reconnects, pulls the canonical row,
  and flushes its stale queue.
- A stale lifecycle/value snapshot and blank run value are pushed after newer
  edits.
- Wake-style pull/re-adoption brings every client to the same canonical state.
- A future date remains separate from the client-local current date.
- A manager reset clears both dates; a pre-reset client push is rejected by the
  reset epoch, and an epoch-adopted empty client can write again.

## Interpreting the report

The test prints a `[sync convergence soak]` object containing:

- `requests`: all HTTP requests made by the simulated clients; this has a
  bounded assertion to catch request storms.
- `retries`: queued reconnect writes and reset-stale responses; unexpected
  growth usually indicates a failed adoption or retry loop.
- `conflicts`: server-side protective-merge conflict records; the soak expects
  at least one because stale and blank writes are intentional.
- `convergenceMs`: time from initial seed through all clients' final pull.
- `divergentFields`: JSON paths that differ from the canonical client after
  convergence; this must be empty.

If the test fails, inspect the first divergent path and whether requests or
retries crossed their bounds. A reset failure should show a stale response with
the new epoch and an empty current-date row; a date failure usually presents as
the future run appearing in the current-date row.