# Browser attempt progress

The full Chromium verification runner and dedicated WebKit lanes keep private, metadata-only checkpoints in
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

## Dedicated WebKit lanes

Each reporter has its own attempt: `webkit-smoke` for the dedicated smoke
evidence reporter, `webkit-compatibility` for compatibility evidence, and
`webkit-compatibility-debug` for the phone/tablet diagnostic reporter. No
WebKit reporter can claim a Chromium attempt or another WebKit lane's attempt.
Legacy records without a lane remain Chromium-only.

The release gate creates these records before spawning the isolated runner,
with the original gate timeout/warning budgets. Standalone isolated invocation
creates them before port selection, PostgreSQL, or server setup, with unknown
outer budgets explicitly null. Direct Playwright execution starts at reporter
initialization. `--list` does not create attempts. The evidence and debug
reporters never share a claim, even when observing the same compatibility run.

At `onBegin`, each records the exact discovered project/case identities and
unchanged workers, retries, global, project, and per-case timeouts. The debug
observer records only its existing phone/tablet project scope; other compatibility
projects are not relabeled as reviewed phone/tablet evidence. A subset or changed
inventory remains diagnostic and incomplete. Reviewed inventories are unchanged.

Case begin/end, reporter errors, and finalization use the same bounded,
allowlisted metadata and atomic writes as Chromium. No errors, attachments,
screenshots, steps, or raw output enter checkpoints. Existing end-of-run sanitized
debug artifacts retain their separate CI authorization and screenshot policy.
Progress does not authorize their upload or replace them.

The WebKit evidence reporter replaces a final report atomically only after
reviewed inventory has completed, persistence remains healthy, and the source
and verification identity is unchanged. Interruption, timeout, missing events,
or reporter errors cannot overwrite a prior complete report. A fully completed
failed run can still retain failure evidence; complete never means passing.
Final-report write faults are explicit and leave the prior target intact.

Additional metadata-only checks:

```sh
node scripts/node_modules/tsx/dist/cli.mjs --test \
  artifacts/run-calculator/e2e/webkit-attempt-progress.unit.mts \
  artifacts/run-calculator/e2e/compatibility-debug-reporter.unit.mts
```

### Verification ledger

Dedicated WebKit extension verification (metadata fixtures only):

- PASS: fake smoke and responsive evidence/debug lifecycle events, including
  missing `onEnd`, interruption, timeout, reporter errors, unreviewed inventory,
  independent lane claims, startup-only failure, source/test identity changes,
  checkpoint/final-report filesystem faults, and prior-report preservation.
- PASS: real release-gate startup exercised with fake child processes for smoke
  and responsive lanes; original budgets survive child failure before any reporter.
- PASS: existing sanitized debug artifact and Chromium progress fixtures,
  release-evidence contracts, shell syntax/inventory, and workspace typecheck.
- PASS: focused strict compilation of touched Playwright reporters and fixtures.
  Initial checks found the missing lane declaration and previously unchecked
  Playwright type mismatches (optional error names/messages, timeout status casing,
  and per-project output directories). All were repaired and rechecked here.
- PASS: compatibility fixtures use the real configuration's entire project list
  with only the reviewed phone/tablet cases executed. Playwright retains
  unselected projects in `FullConfig.projects`; promotion is fenced by exact
  discovered case identities, while checkpoints preserve every configured budget.
  The initial configuration-list guard blocked this valid selection; it was
  replaced with the discovered-suite guard. Executing an additional Chromium
  case still prevents compatibility evidence promotion.
- NOT RUN: browser certification, application runtime/device journeys, publishing,
  and production writes. Desktop/phone/tablet portrait/landscape and physical
  Android Chrome/iOS Safari/PWA proof are not applicable to metadata fixtures.

Historical Chromium persistence verification:

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
