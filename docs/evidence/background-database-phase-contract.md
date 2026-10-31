# Prospective database phase evidence

## Authority and scope

The owner approved this diagnostic contract for local implementation and testing.
That approval does **not** authorize Publish or production observation.

Environment: isolated development task; synthetic/in-memory fixtures and a disposable
loopback PostgreSQL database only. Revision: task working tree, not yet merged or bound
to a serving build. The existing
[published-runtime investigation](published-runtime-reliability-2026-10-24.md)
is historical evidence, not evidence that this instrumentation works in production.

The original scope is the scheduled-evaluation queue monitor's two existing database stages:
`status_aggregate` and `duplicate_group_scan`. Each stage already awaits a single
Drizzle read. The [October 26 investigation](production-stalls-2026-10-26.md)
extends observation to existing outbox drain reads; it does not authorize Publish.
No SQL, query implementation, pool settings, deadlines, retry policy,
backoff, job transitions, cancellation, leases, idempotency or single-claim effects
change. Other worker/provider failures remain unattributed; this does not claim
phase coverage of arbitrary job handlers or external push delivery.

## Contract, version 1

Dedicated Pino event: `background_database_phase`. Its `databasePhase` member contains
only the following allowlisted fields. The operation is a queue-monitor or outbox drain read;
there are no job/run/scope/user identifiers, SQL, parameters, raw errors, error codes,
provider bodies, or dynamically constructed metric labels.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `1`. |
| `stage` | `status_aggregate`, `duplicate_group_scan`, `outbox_scope_list`, `outbox_cursor_read`, or `outbox_events_read`. |
| `coverage` | `complete`, `unobserved`, `multiple_checkouts`, `incomplete`, or `shutdown`. |
| `phase` | `acquisition`, `post_checkout`, or `unknown`. On success, the last observed phase, not a failure attribution. |
| `outcome` | `success`, `cancelled`, `checkout_timeout`, `connection_timeout`, `connection_failed`, `acquisition_failed`, `query_timeout`, `failed`, `shutdown`, or `unknown`. |
| `observedFrom`, `observedUntil` | UTC observation boundaries, for window overlap only; wall clocks can move. |
| `elapsedMs` | Monotonic elapsed duration of the observation, including pre-checkout dispatch and result handling. |
| `acquisitionMs` | Existing `pool.connect` invocation to its callback/Promise settlement. Includes queueing, new-connection setup and JavaScript scheduling. `null` if unobserved/incomplete/ambiguous. |
| `postCheckoutMs` | Successful checkout settlement to completion/failure of the awaited stage. Includes dispatch, network, database work, response decoding and JavaScript scheduling. `null` if not reached, ambiguous, or unfinished at shutdown. |
| `timeoutOverrunMs` | For an exact recognized acquisition-timeout signature only: observed acquisition duration minus the existing configured pool deadline, floored at zero. Otherwise `null`. Not a new timer or proof of an event-loop cause. |

Durations are rounded nonnegative milliseconds, saturated at 600,000 ms. A value
at that limit may be clipped; it is not an exact upper bound. Unknown is `null`,
never a fabricated zero. Multiple checkout scopes deliberately do not subtract
unrelated durations. Without a captured checkout boundary (including an already-held
transaction client), phase remains unknown.

Classification inspects at most eight error causes and emits only fixed outcomes.
The exact pool-wait and new-client-timeout messages are distinguished. Pre-checkout
`ECONNREFUSED`/`ENOTFOUND` establish a connection failure; generic network timeouts
do not establish new-client attribution. PostgreSQL `57014` alone means cancelled,
not necessarily query timeout: only the exact statement-timeout message or the
driver's exact query-read-timeout message establishes `query_timeout`. No message
or code is copied to the record. Throwing error getters yield `unknown`.

### Event-loop alignment and lifecycle

`capacity_telemetry` now includes `observedFrom` and `observedUntil` for the same
window as its existing resettable event-loop histogram and counters. Queue phase
intervals can overlap these windows. Histogram quantiles are window observations,
not per-query samples, and overlap is not causation. The old stage durations keep
their existing combined-wall-time meaning.

At most 32 active phase scopes are registered. Overflow runs normally, with
unobserved phase evidence on completion. Callback and Promise pool paths retain
the original client, release callback, result and error. Checkout waiter removal
is still owned by node-postgres' existing timer; there is no competing deadline,
timer, retry or release mechanism. Diagnostic sink failures cannot fail a read.
Pool instrumentation installation is idempotent for every pool object.

Shutdown emits one terminal observation per registered active scope, then ignores
late diagnostic completions. `shutdown` means **observation ended**, not that a
query stopped or a job was cancelled. An unfinished phase duration stays null.
The existing capacity window is flushed alongside these records. Work continues
under its existing shutdown, lease and effect rules.

Existing slow/unavailable queue events carry the new evidence when available,
marked `databasePhaseVersion: 1`. Success also emits the dedicated event, so
failure-only logs do not become a misleading latency population.

### Sampled outbox reads

Outbox observations surround only the drain's existing scope-list, cursor
(including seed), and event-batch SQL reads. They do not surround delivery
callbacks, canonical gap reconciliation, LISTEN/reconnect, registration, or
retention cleanup. A successful read followed by a failed delivery therefore
remains a successful read, not a fabricated database failure.

Each listener emits at most one sample per stage/category in a rolling 60-second
interval. Categories are success below 900 ms, success at least 900 ms, and
non-success. This is at most nine records per minute per listener, with nine
fixed in-memory sampling keys and no new timers. The 900 ms cutoff selects
diagnostic samples only; it is not a new timeout, SLO, or retry threshold.
The log envelope marks `sampling: outbox-stage-category-first-per-minute`.
Sampling does not alter the evidence contract. The offline summary accepts the
additional fixed stage values, but its record counts are sampled observations,
not operation counts, failure rates, or comparable queue/outbox populations.
Shutdown/late completions cannot emit outbox records after the listener stops.

## Offline summary

For an already authorized, sanitized Pino JSONL capture:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts exec tsx \
  ./src/summarize-database-phases.mts /absolute/path/to/sanitized.jsonl
```

This command performs no network requests or database access and writes only a
fixed-shape aggregate to stdout. It reads at most 16 MiB, 100,000 nonempty lines,
and 64 KiB per line. Malformed JSON is counted, never printed, and yields a nonzero
exit status. Read/size failures print a generic message, not a path or record.

The summary counts dedicated phase records, known coverage/outcomes, observed
duration counts and clipped maxima. Legacy queue-monitor records and invalid or
unsupported phase contracts remain **unknown**, regardless of their old combined
durations or normalized error labels. Modern queue-monitor copies marked version 1
are excluded to avoid counting the same phase evidence twice. These are log-record
counts, not unique job counts or failure rates; old monitor events and new per-stage
records are not comparable populations. Environment/revision provenance is
explicitly unverified by the summary. Preserve separately authorized build and
capture-window evidence; this utility cannot certify production attribution.

## Controlled operator handoff — not executed

Production effectiveness remains **UNVERIFIED**. If the operator chooses to
proceed, separately approve a build-bound publication and a read-only observation
window, for example ten minutes with a 200-record capture cap. Do not start a load
test, change a setting, query operational rows, replay work or broaden retention.

Bind the capture to independently verified serving-build identity and explicit UTC
start/end times. Collect only complete, nontruncated targeted phase and capacity
events. Preserve unknowns and clipping, distinguish complete from shutdown evidence,
and compare only overlapping local windows. Stop at the agreed duration/cap or any
unexpected overhead. If build binding, event coverage or provider/server-side timing
is unavailable, say so rather than attributing client-observed time to PostgreSQL.
Any provider-side correlation remains a separate operator-controlled decision.

## Verification and failure ledger

Backend-only: desktop, phone, tablet portrait/landscape, Chromium/Chrome,
WebKit/Safari, physical Android/iOS/PWA and native-mobile checks are not applicable.
No browser journey, schema change, dependency change, production write, provider/load
test or release gate is part of this task.

- Initial focused run: **102 passed, 1 failed**. All six instrumentation/queue suites
  passed; the existing background-recovery test
  `retains sustained degradation after process-local diagnostics are cleared`
  could not recover shared diagnostic state in the unprepared workspace database.
  Owning repair: run the unchanged assertion against a schema-prepared disposable
  local PostgreSQL fixture. This was not classified as a production defect.
- Queue adoption follow-up: **59 passed** across phase telemetry, queue-phase
  adoption and push-scheduler unit suites, including failure sanitization.
- **PASS:** final disposable-database pass: eight focused API suites, **108 tests**.
  The previously failing shared-diagnostic assertion passed unchanged after schema
  preparation on the disposable loopback fixture. The fixture stopped afterward.
- **PASS:** direct API and scripts typechecks after fixing test-double annotations
  and loading the offline summarizer through the scripts runtime boundary.
- **PASS:** API workflow restart, clean development startup and successful
  `background_database_phase` records for both queue stages. `/api/healthz` returned
  `status: ok` with database and background workers `ok`; a proxied development
  GET independently returned HTTP 200. The browser capture also reported a resource
  404 without identifying its URL; this is not a failure of the successful health
  response and is not used as application-journey evidence.
- **LOCAL SETUP REPAIR:** the first full `pnpm run typecheck` was blocked before
  completion by `Invalid prepared build-source record.` from the Vite config loader.
  An ignored, obsolete `production-source-v3` web-stage-start cache was still active.
  Preserved only that stale intermediate under a non-active filename; authoritative
  prepared/expected publish records and validation guards were not changed.
- **PASS:** full `bash scripts/src/run-release-node.sh pnpm run typecheck` after
  the local cache repair, including API route, scripts, shared-library, calculator
  and mockup typechecks and the existing generated-contract/config-loader checks.
- **PASS:** two offline CLI tests, exercising a synthetic capture, legacy unknowns,
  malformed JSON, oversized lines and unreadable paths without echoing private
  fixture strings or paths.
- **PASS:** `git diff --check`. No production observation or remediation was
  performed, and production effectiveness remains unverified.
