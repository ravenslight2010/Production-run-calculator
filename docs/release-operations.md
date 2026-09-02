# Release validation operator guide

This guide is the operating contract for the repository's release checks. A
release check is successful only when the command exits zero **and** the
retained evidence verifier passes for the same git revision.

## Release commands

```bash
pnpm run release:check
pnpm --filter @workspace/scripts run check:release-evidence
```

The standard run includes typechecks, security audit, recovery and operational
evidence checks, clean-start startup health, API test shards, the explicitly
listed bounded package-test gates (including `@workspace/spec-import`), and
browser smoke/accessibility checks. Full mode is an opt-in command that adds
the complete browser suite. Independent prerequisite, consumer-typecheck,
API/package-test, and browser stages have explicit dependency barriers. The
API/package-test stage runs at most four children by default, with no more than
two API/database shards at once. Each API shard remains serialized internally
and has an eight-minute hard limit with a six-minute warning. Browser stages
remain strictly serial for disposable live-day safety. The full browser suite
has a 30-minute hard limit with a 25-minute warning. This is a bounded
execution budget, not a retry or an evidence-validation bypass: all 113
enumerated cases still need to complete and the retained report must pass the
same revision-bound evidence verifier.

To run the full mode locally:

```bash
pnpm run release:check:full
```

The full browser config retains `browser-full/FINAL-REPORT.md` automatically.
It records the run revision, total/complete/pass/skip/fail/not-run counts,
wall-clock duration, and a sorted per-file duration table. The report is generated from
Playwright's completed test results; a `GO` report requires all 113 cases to be
enumerated and completed. The main config remains serial with `workers: 1`,
with no retries or reduced test-match coverage. The release report also records
total wall-clock time and per-stage wall-clock durations so the scheduler's
speedup can be compared with the existing per-gate timings.

Each complete, passing full-suite run compares matching file paths with the
prior complete, passing retained full-suite report before replacing it. An
interrupted, timed-out, or incomplete run leaves the last valid baseline
untouched. The report flags a file when it is at least 30 seconds and 25%
slower than its prior duration. This filters normal cold-environment noise
while surfacing a slowdown that can consume the 30-minute budget. New files,
removed files, faster files, and a missing or legacy baseline are not treated
as regressions.

## How to interpret a result

- `PASS` is a product or tooling gate that completed successfully.
- `FAIL` is a completed gate that found a product or validation problem. Fix it
  before retrying.
- `INFRASTRUCTURE TIMEOUT` means the runner or a bounded child exceeded its
  budget. Review the durable log before deciding whether a retry is justified.
- `INFRASTRUCTURE ERROR` means the process was killed, could not start, or the
  environment interrupted it. It is not evidence that the application
  assertion failed.
- A missing gate in the report is an incomplete run, never a pass.
- A missing, empty, stale-revision, or unexpected evidence file is an evidence
  failure, never a pass.
- A browser duration alert is an operational review signal, not a coverage or
  serial-execution bypass. It is copied into the release summary for
  investigation; the full suite still must complete all 113 cases and pass the
  revision-bound evidence verifier.

Without an explicit `RELEASE_EVIDENCE_DIR`, standard and full checks retain
their reports, logs, checkpoints, and browser artifacts independently under
`release-evidence/` and `release-evidence-full/`, respectively. If a run
stops after a bounded failure, retry with:

```bash
pnpm run release:check -- --resume
```

Resume is safe only for the same revision and mode. A parallel stage
checkpoints each completed child, so `--resume` reruns failed or not-reached
gates without rerunning passed gates, even when children finish out of order.
A fresh run discards the old checkpoint and starts a new log. An explicit
`RELEASE_EVIDENCE_DIR` continues to select one exact evidence directory for
deliberate single-run use. To reduce local resource use, set
`RELEASE_CHECK_MAX_CONCURRENCY=1` (valid values are 1 through 16); CI sets the
documented default of 4. To diagnose one surface quickly, use its focused
package command, but do not treat that partial check as release evidence. To
verify the default full-mode evidence, use
`pnpm run release:check:full -- --verify-evidence`.

The standalone verifier reads the `Mode:` field in the selected report, so it
automatically applies the full contract when pointed at a full evidence
directory. To select a directory explicitly:

```bash
pnpm --filter @workspace/scripts run check:release-evidence -- \
  --evidence-dir release-evidence-full
```

Passing `--full` forces full-mode verification. A mode mismatch is rejected
with a corrective command rather than treating the directory as valid under
the other contract.

## GitHub Actions evidence

The release-check workflow runs standard mode on pull requests and manual
dispatches. Its separate full-mode job is an explicit `workflow_dispatch`
opt-in (`Run full browser release suite and retain full evidence`) so the
longer browser budget does not extend every pull request. Each selected job
starts with its own disposable database and evidence root:

- Standard mode runs `pnpm run release:check`, verifies `release-evidence/`,
  and uploads `release-evidence-standard-<run-id>`.
- Full mode runs `pnpm run release:check:full`, verifies
  `release-evidence-full/` with the full-mode verifier (including
  `browser-full/FINAL-REPORT.md`), and uploads
  `release-evidence-full-<run-id>`.

The retained artifacts also include the release report, durable log, checkpoint,
clean-start evidence, and startup logs. The roots and artifact names are
deliberately distinct so a full run cannot overwrite or be mistaken for
standard evidence.

When a job stops before all gates complete, the workflow writes a separate
NO-GO summary with the uploaded checkpoint-artifact link, the matching resume
command, and the matching fresh-run command. If GitHub does not provide an
artifact URL, the summary says `The checkpoint artifact was not uploaded successfully.`
instead of showing a broken link; the recovery commands and the
non-retained-evidence warning are still included. GitHub may not expose that
Markdown for cancelled jobs through an unauthenticated page or check-run API.
The summary contract can therefore be checked without GitHub access:

```bash
pnpm --filter @workspace/scripts run test:release-stopped-summary
```

This is a bounded, fixture-only contract check. It writes only to temporary
files, prints a `non-retained verification only` marker, and must never be
treated as retained release evidence or a GO decision. It verifies the exact
standard and full Markdown with both an artifact URL and an empty artifact URL,
including the explicit upload-failure message, the non-retained-evidence
warning, and each mode's resume/regenerate commands.

The workflow-lint job runs a separate workflow guard that checks both standard
and full jobs keep their `always()` stopped-summary step after the matching
evidence upload and pass the matching artifact URL and recovery commands. This
workflow-level check is distinct from retained release evidence validation.

## Disposable API concurrency calibration

The release gate inventory does not include the database-pressure calibration
lane. Run it manually when API integration coverage or the CI Postgres service
changes:

```bash
RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1 NODE_ENV=test \
  pnpm run check:release-concurrency
```

The command requires `DATABASE_URL` to point at a disposable CI-style Postgres
service, the explicit `RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1`
acknowledgement, and either CI or a test-environment marker. It runs the same
six API release shards used by the release gate at the documented cap of two
active database shards. Each shard remains internally serialized by
`artifacts/api-server/vitest.config.ts`; the lane does not raise Vitest workers
or reuse release evidence.

The lane writes `release-concurrency-stress.json` and
`release-concurrency-stress.md` under a disposable `tmp/` directory. Set
`RELEASE_CONCURRENCY_EVIDENCE_DIR` to retain them at a chosen path. When
`RELEASE_CONCURRENCY_BASELINE_JSON` points at a prior healthy report, it also
writes `release-concurrency-comparison.json` and
`release-concurrency-comparison.md`. When
`RELEASE_CONCURRENCY_HISTORY_JSON` points at a JSON array of prior healthy
artifacts, it additionally writes `release-concurrency-trend.json` and
`release-concurrency-trend.md`. Reports record:

- setup time: the elapsed time for the same schema push that prepares the
  disposable CI database (the shards then perform their normal per-fixture
  database create, schema push, and teardown);
- peak active shards and the documented cap;
- per-shard result and elapsed time;
- timeout failures and lock/setup failures, including deadlocks, duplicate
  markers, connection exhaustion, and related Postgres symptoms; and
- total wall-clock time.

The manual GitHub Actions workflow
`.github/workflows/release-concurrency-calibration.yml` provisions disposable
Postgres, sets the explicit disposable-database acknowledgement, and retains
the JSON, Markdown, database-setup log, and per-shard logs in the separate
`release-concurrency-calibration-<run-id>` artifact. It looks through prior
successful calibration runs for up to five non-expired healthy reports. Missing,
expired, malformed, unsafe, and unsafe-path artifacts are logged and ignored.
The newest accepted report remains the single baseline, so setup and total
wall-clock time are still compared with the existing alert rule: a slowdown is
meaningful when it is both at least 30 seconds and at least 25% slower than that
baseline. The workflow summary also includes an informational chronological
trend with first/latest/minimum/maximum/average values and the change across
the retained healthy samples. The trend never changes the alert status or
release gates. The workflow is manual-only and is not a release gate.

The archive selection and validation step is implemented in
`scripts/src/fetch-release-concurrency-history.sh`, rather than being kept
inline in the workflow, so it can be exercised with representative fixtures.
Run its fixture-driven regression test with:

```bash
pnpm --filter @workspace/scripts run test:release-concurrency
```

The test covers healthy baseline/history retention, malformed and unsafe
reports, expired artifacts, unsafe archive paths, and the invariant that the
calibration lane does not change the release-gate inventory.

Any non-passing shard, timeout, lock/setup failure, missing shard startup, or
observed cap violation fails the lane with a clear `Concurrency cap unsafe`
diagnostic. This is a calibration signal, not a release GO/NO-GO decision:
never add its output to `release-evidence/` or treat it as retained release
evidence. The normal `release:check` and `release:check:full` commands and
their workflow inventory remain unchanged.

## Startup and port recovery

Clean-start uses disposable ports (`18081`, `18082`, `18180` in release
checks). It performs a preflight ownership check and does not kill unrelated
processes. If it reports a port conflict, record the owner, stop that specific
stale process using the normal workflow controls, or choose unused
`CLEAN_START_*_PORT` values. Do not loop restarts: after two
`DIDNT_OPEN_A_PORT` attempts, inspect the workflow logs, listener address, and
`curl` response, then escalate if the expected `0.0.0.0` port is healthy but
forwarding still fails.

## Evidence and escalation boundary

Evidence is allowlisted and revision-linked. Standard mode requires all
clean-start artifacts; full mode additionally requires
`browser-full/FINAL-REPORT.md`, including its revision-bound duration summary.
Do not manually mark a report GO or delete missing artifacts. Escalate only
after the documented retry/diagnostic path:
the failing gate, revision, retained log path, port owner (if applicable), and
whether the failure is product, infrastructure, or evidence-related.
