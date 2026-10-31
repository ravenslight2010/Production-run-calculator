# Disposable multi-instance readiness workload

## Scope and execution

The bounded API workload starts two separate API processes against the same
runner-created PostgreSQL database. Each process runs the normal API entrypoint,
startup, readiness route, authentication, and sync persistence.

Run the existing isolated lane:

```sh
pnpm --filter @workspace/api-server run test:load:isolated
```

Its prerequisite is the dedicated loopback PostgreSQL service and explicit test
acknowledgements defined in `.github/workflows/api-load-workload.yml`. The runner
rejects other database identities and creates a uniquely named child database.
Do not point this lane at development application data or production.

The additional workload has:

- Two synchronized waves of six readiness probes per API process.
- One concurrent sync write per process per wave, using a common canonical
  snapshot, client date, explicit zero reset epoch, and bounded canonical retries.
- A final canonical read that checks all four synthetic runs and their values
  without duplicate IDs, followed by one drain probe per process.
- Per-process counters proving every measured request invokes the required
  database and audit checks, while each wave starts one optional diagnostic pair
  **per process**, not one shared pair across processes.
- Graceful shutdown assertions for both API processes, with bounded forced
  cleanup if the workload fails. The outer runner drops its child database.

No connection-pool settings or cross-instance caching were introduced. The
in-flight HTTP request bound is 16; this is a workload limit, not a database pool
limit. The existing single-process sync/inventory workload remains included.

## Measurement limits

`API_LOAD_READINESS_INSTRUMENTATION=1` is effective only with `NODE_ENV=test`.
The test uses a 125 ms optional-diagnostic delay to ensure overlap. Test counters
and pool samples are returned only in test headers; production and development
exposure is covered by regression tests.

The reported readiness latency **includes that artificial delay**. It proves the
bounded fixture responds before its ten-second request deadline, not a production
latency guarantee. `readinessMaxPoolWaitingCount` is the maximum of response-time
samples from the child processes, not continuous peak queue monitoring. Separate
drain samples must be zero. The original workload's pool sampler runs every 5 ms
in its own process.

The summary excludes startup baseline probes, process IDs, connection strings,
tokens, raw logs, request bodies, and recipe contents. `readinessOptionalReadsPerInstance`
counts the two measured waves plus the final drain probe, excluding startup.

## Verification record

Captured 2026-10-22 on Linux x64, Node 24.13.0, PostgreSQL 16.15, using only
synthetic fixtures in a private disposable cluster. This was a working-tree
verification, not deployment-bound or clean-release evidence. The generated
runner report records the parent checkout revision; it does not hash uncommitted
changes.

| Check | Result |
| --- | --- |
| Isolated API workload and validated sanitized summary | PASS |
| Separate API processes | 2 |
| Measured multi-instance readiness responses | 26 healthy |
| Multi-instance readiness p95, including fixture delay | 150 ms |
| Multi-instance synthetic sync writes | 4 persisted; 6 bounded attempts |
| Optional diagnostic pairs per process after startup baseline | 3 |
| Child-process response-time queue samples / final drain waiters | 0 / 0 |
| Original workload sampled peak pool waiters | 4 |
| Peak concurrent HTTP requests across the workload | 14 |
| Total counted HTTP requests | 190 |
| Both child processes exit normally | PASS |
| Disposable child databases remaining | 0 |
| Runner safety and schema-failure cleanup tests | PASS, 3 tests |
| Focused readiness route suite | PASS, 25 tests |
| `CI=true pnpm run typecheck` | PASS |
| Script syntax and patch whitespace checks | PASS |

### Failure ledger

- Initial local invocation: BLOCKED before database creation because the
  interactive shell lacked the lane's explicit test acknowledgement. Resolved by
  supplying the same disposable-only identity and flags as the CI lane.
- First complete workload: assertions passed, but the report was rejected because
  the metrics writer omitted the new readiness probes from total requests.
  Resolved in the shared metrics writer; the final lane and report both pass.
- Final measurement alignment: drain probes were counted but initially omitted
  from the latency sample array. They now contribute timings, and the workload
  checks that every counted probe has one latency sample. The final lane passes.
- A workspace restart interrupted the next invocation and removed its temporary
  PostgreSQL process. The complete lane was rerun under one shell-owned database
  lifecycle with an exit cleanup trap; it passed.
- The managed API preview was not running after restart. A visual capture was
  unavailable; no application database was started for a test-only task. Browser
  verification is not an acceptance gate for these API/CLI changes.

Desktop, phone, tablet portrait/landscape, Chromium/Chrome, WebKit/Safari,
physical Android/iOS, and PWA layout checks are **not applicable**: no UI, browser
transport, or native surface changed. Existing readiness unit tests cover
client cancellation and rejected optional-read recovery. This bounded workload
does not claim exhaustive network-failure coverage, real production Autoscale
capacity, or peer SSE delivery support. Production writes and production load
were not performed.
