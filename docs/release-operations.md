# Release validation operator guide

This guide is the operating contract for the repository's release checks. A
release check is successful only when the command exits zero **and** the
retained evidence verifier passes for the same git revision.

## Standard commands

```bash
pnpm run release:check
pnpm run release:check:full
pnpm --filter @workspace/scripts run check:release-evidence
```

The standard run includes typechecks, security audit, recovery and operational
evidence checks, clean-start startup health, API test shards, package tests,
and browser smoke/accessibility checks. Full mode adds the complete browser
suite. API shards are serialized and have an eight-minute hard limit with a
six-minute warning. The full browser suite is also serialized for disposable
live-day safety and has a 20-minute hard limit with a 15-minute warning. This
is a bounded execution budget, not a retry or an evidence-validation bypass:
all 99 enumerated cases still need to complete and the retained report must
pass the same revision-bound evidence verifier.

The full browser config retains `browser-full/FINAL-REPORT.md` automatically.
It records the run revision, total/complete/pass/skip/fail/not-run counts,
wall-clock duration, and a sorted per-file duration table. The report is generated from
Playwright's completed test results; a `GO` report requires all 99 cases to be
enumerated and completed. The main config remains serial with `workers: 1`,
with no retries or reduced test-match coverage.

Each complete, passing full-suite run compares matching file paths with the
prior complete, passing retained full-suite report before replacing it. An
interrupted, timed-out, or incomplete run leaves the last valid baseline
untouched. The report flags a file when it is at least 30 seconds and 25%
slower than its prior duration. This filters normal cold-environment noise
while surfacing a slowdown that can consume the 20-minute budget. New files,
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
  investigation; the full suite still must complete all 99 cases and pass the
  revision-bound evidence verifier.

Without an explicit `RELEASE_EVIDENCE_DIR`, standard and full checks retain
their reports, logs, checkpoints, and browser artifacts independently under
`release-evidence/` and `release-evidence-full/`, respectively. If a run
stops after a bounded failure, retry with:

```bash
pnpm run release:check -- --resume
```

Resume is safe only for the same revision and mode. A fresh run discards the
old checkpoint and starts a new log. An explicit `RELEASE_EVIDENCE_DIR`
continues to select one exact evidence directory for deliberate single-run
use. To verify the default full-mode evidence, use
`pnpm run release:check:full -- --verify-evidence`.

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
