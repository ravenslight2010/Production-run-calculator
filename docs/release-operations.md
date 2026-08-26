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

Every run retains `release-evidence/release-check.log` and a revision-bound
`release-evidence/release-check-state.json`. If a run stops after a bounded
failure, retry with:

```bash
pnpm run release:check -- --resume
```

Resume is safe only for the same revision and mode. A fresh run discards the
old checkpoint and starts a new log.

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
`browser-full/FINAL-REPORT.md`. Do not manually mark a report GO or delete
missing artifacts. Escalate only after the documented retry/diagnostic path:
the failing gate, revision, retained log path, port owner (if applicable), and
whether the failure is product, infrastructure, or evidence-related.