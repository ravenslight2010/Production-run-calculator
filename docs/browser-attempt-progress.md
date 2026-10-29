# Browser attempt progress

The full Chromium verification runner keeps private, metadata-only checkpoints in
`.local/browser-verification-attempts/<random-attempt-id>/`. This directory is
excluded from Git and Replit deployment input. It is outside Playwright's output
directory and the isolated runner's temporary PostgreSQL/server directories.

This is diagnostic tooling, not a release certification run or a replacement
for release evidence. Existing failures and missing release checks remain
unresolved until the release owner verifies them.

## Lifecycle and interpretation

- Before the release gate spawns its isolated runner, it writes `start.json`
  with the captured production-source and test/verification identity, start
  time, and original runner timeout/warning budgets. Standalone runs through
  `run-isolated-browser-suite.sh` also create a start record before runtime
  setup; absent external budgets are explicitly `null`, not inferred.
- The reporter claims that startup record once. Direct Playwright invocation
  creates its record when the reporter begins; use the isolated runner to
  retain evidence of failures before reporter initialization. Inventory
  listing (`--list`) is not an execution attempt.
- `onBegin` records exact reviewed case identities and configured per-case and
  project timeouts/retries, global timeout, and workers. Case begin/end events
  checkpoint status, timestamps, worker/retry identity, and measured durations.
  Reporter errors are counted without retaining their messages or stacks.
- `progress.json` is replaced atomically using a same-directory, exclusive
  pending file that is flushed before rename. If execution disappears without
  `onEnd`, its last checkpoint stays `INCOMPLETE` and its result stays `null`.
  Elapsed time is measured at the last persisted event; an active case's start
  time is recorded, not a fabricated end time or duration.
- `onEnd` can record the observed Playwright result, including interruption or
  timeout. It is **not** a process exit code. Incomplete inventory, reporter
  errors, interrupted/timed-out results, or a changed source/test identity
  cannot become complete release evidence.
- `start.json` is create-only and always `INCOMPLETE`. It remains the readable
  fallback if a checkpoint fails. A checkpoint error closes persistence and
  prevents final report promotion; a failed atomic replacement leaves the
  previous file intact. If storage is unavailable before even the first start
  record can be written, the runner refuses to start tests. No implementation
  can promise a durable record on wholly unavailable storage.

No attempt reads previous case passes, resumes execution, or merges results
across attempts or revisions. A startup record cannot be claimed a second time.
Changing verification inputs invalidates identity even if production source is
unchanged. The existing case-inventory, worker, retry, timeout and final-report
retention rules are unchanged. Final report/count-summary writes also use
atomic replacement instead of truncating a retained file.

## Privacy and bounds

Only allowlisted fields are copied from reporter events. Raw errors, standard
output, request bodies, credentials, attachments, screenshots, and traces are
not checkpointed. Existing raw Playwright output stays private and excluded from
Git/deployment; HTML reports are also excluded from deployment input.

Each snapshot is capped at 2 MiB, with at most 2,000 cases, 32 result events per
case, and 4,096 characters per identity field. These are persistence limits,
not increases to any execution budget. Pending files can remain after an I/O
failure and contain the same allowlisted metadata only. There is no automatic
deletion of old attempts or user evidence.

## Focused verification

No browser suite is needed to verify this capability:

```sh
node --test scripts/src/browser-attempt-progress.test.mjs
node scripts/node_modules/tsx/dist/cli.mjs --test \
  artifacts/run-calculator/e2e/release-duration-progress.unit.mts
```

These use isolated filesystem fixtures and fake reporter events, including
startup-only abandonment, missing `onEnd`, completion, interruption, stale
verification identity, retry/worker metadata, failed writes, and preservation
of a prior complete report. They make no production, physical-device, or
browser-flow certification claim.

### Verification ledger

The persistence filesystem fixtures, fake reporter lifecycle checks, existing
release-evidence contracts, and workspace-wide `pnpm run typecheck` passed.
No browser execution or certification was performed.

The additional command
`bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts exec tsx ../artifacts/run-calculator/e2e/release-duration-reporter.unit.mts`
failed at the existing inventory assertion: discovery returned **219** cases
against the unchanged **216**-case contract. No browser spec, Playwright
configuration, or case contract was changed by this tooling work. That guard
remains strict, and its current failure stays with the existing release
verification work; it is not reclassified as passing or repaired here.

Desktop/phone/tablet, Chromium/WebKit runtime flows and physical-device checks
are not applicable to this reporter/filesystem change. This ledger is not a
release GO/NO-GO decision.
