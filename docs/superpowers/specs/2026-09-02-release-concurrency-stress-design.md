# Release concurrency stress design

## Goal

Validate that the documented two-shard API/database concurrency limit remains
safe under the same disposable Postgres setup and teardown pressure used by CI,
without adding a new production release gate.

## Interface

`pnpm run check:release-concurrency` runs the six API release shards at the
fixed documented cap of two. It requires a disposable `DATABASE_URL` and writes
standalone JSON, Markdown, and per-shard log files outside the release-evidence
directories. An optional `RELEASE_CONCURRENCY_EVIDENCE_DIR` selects a retained
output path. The command also requires an explicit disposable-database
acknowledgement and a CI/test environment marker.

## Metrics and decision

The report records the CI-style base schema setup time, peak active shards,
timeout and lock/setup failure counts, per-shard durations and results, and
total wall-clock time. Any failed setup or shard, timeout, lock/setup symptom,
missing child startup, or cap violation marks the lane unsafe and exits nonzero
with a corrective diagnostic. The real shard commands still perform their
normal temporary-database create, schema push, and teardown work.

## Isolation

The runner reuses the release checker’s API shard definitions and timeout
budgets. It is not included in the standard or full release step list, does not
write to retained release evidence, and does not change Vitest worker counts.
Deterministic fixtures verify the cap and failure classification without
requiring Postgres.