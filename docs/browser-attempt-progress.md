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
failure and contain the same allowlisted metadata only. The owner approved
automatic **30-day** diagnostic retention on October 29, 2026, replacing the
initial manual-cleanup proposal. User evidence is not included in that approval.

## Inventory, preview and approved cleanup

From the repository root, without running tests:

```sh
# Read-only age/size inventory and candidate preview; no files are changed.
node scripts/src/browser-attempt-retention.mjs

# Apply the same owner-approved policy now rather than waiting for startup.
node scripts/src/browser-attempt-retention.mjs --apply
```

Cleanup also runs whenever `startBrowserAttempt` creates a new browser attempt
(isolated runner and direct reporter invocation). It is **not** a periodic
background service: nothing runs while no browser checks are starting. Startup
summaries go to stderr, leaving stdout's attempt-ID contract unchanged. Cleanup
failures are reported but do not bypass the normal durable-start requirement or
change any diagnostic result, case inventory, source identity, budget, or release
conclusion. There are no production database writes.

The preview includes logical file bytes, file counts, pending-write bytes/counts,
per-attempt ages and protection reasons, candidate bytes/counts, and byte buckets
under 7, 7–30, 30–90, and over 90 days. Age is measured from the newest file or
directory modification, not merely the original start date. The exact 30-day
boundary stays protected. Inventory output includes no case payloads, owner PIDs,
raw errors, or user-provided filenames. Unreadable entries, symlinks and entries
beyond inspection limits are not followed or included in byte totals: those
totals are measured logical bytes, not a claim about total allocated disk usage.

### What is protected

- Live launcher/reporter processes; permission-denied process probes, malformed
  ownership records and different-host ownership are treated as potentially active.
  PID reuse may conservatively retain a record; it never authorizes deletion.
- Legacy unfinished records without ownership information. Age alone cannot prove
  they are inactive. Legacy ended records with the expected reporter claim and
  diagnostic metadata can expire.
- Each lane's newest complete diagnostic snapshot, plus **every explicitly retained
  attempt**. To retain any chosen attempt as a baseline, put a file named `retain`
  inside its UUID directory *before* cleanup starts. Remove that pin only when its
  owner no longer needs the baseline. There is no size-pressure override for pins.
- User evidence: an unexpected file or subdirectory protects the entire attempt.
  Symlinks, hard links, malformed/oversized records and unknown directories are
  not deletion targets.
- All release duration reports, count summaries, HTML reports, screenshots,
  traces, uploads, and other evidence outside the attempt store. This tool never
  traverses those locations and does not infer that retained diagnostics are
  release certification.

New attempts record private launcher and reporter ownership sidecars. Only known
diagnostic files in recognized UUID directories are candidates. Cleanup never
edits a saved result to make it eligible and never adopts, resumes or merges case
passes. If protection prevents sufficient space recovery, the preview identifies
the reason; the tool does not silently expand its deletion scope.

### Bounds and interruption handling

Each pass inspects at most 10,000 store entries, 512 files per attempt, 2 MiB per
JSON record, and 64 MiB of JSON metadata across the inventory. A truncated store
or exhausted inventory-read budget disables deletion for that pass, since a
missing entry might be a retained baseline. A per-attempt file-limit violation
protects that attempt. Each cleanup pass attempts at most 100 attempts and
64 MiB of candidate data; excess candidates are deferred, not deleted by age
exceptions. Pins, active records and other protected files can exceed those
limits: this policy is not a hard disk quota.

Before removal, candidates are checked again and get an exclusive `cleanup.json`
marker. An atomic rename to `.cleanup-<attempt-id>` separates them from the writer
path. Reporter claiming refuses attempts marked for cleanup. Only allowlisted
regular files are unlinked, never recursive directory deletion. The cleanup
marker is removed last. A later pass can resume a partial quarantine (including
an empty directory left by interruption), or a marked attempt interrupted before
rename. Newly added unrecognized files or `retain` pins stop removal.

Manual `--apply` returns a nonzero exit code for partial failures or a truncated
inventory, with safe per-attempt failure/action codes. Successful removals are
reported separately from failures and deferrals; retry is safe. If inspection
itself fails, the command exits nonzero rather than claiming an empty inventory.

### Initial inventory and approval evidence

The read-only inventory on October 29, 2026 in the isolated task workspace found
no attempt-store directory: 0 attempts, 0 files, 0 pending files and 0 logical
bytes across all age buckets. The 30-day dry-run candidate count was 0. Ignored
main-workspace records are not copied into the task environment, so this is **not**
an inventory of the main workspace or production. The owner explicitly selected
“Approve automatic 30-day cleanup” after reviewing the automatic-startup proposal.
No real retained attempt was deleted during implementation; deletion checks use
disposable filesystem fixtures.

## Focused verification

No browser suite is needed to verify this capability:

```sh
node --test scripts/src/browser-attempt-progress.test.mjs
node --test scripts/src/browser-attempt-retention.test.mjs
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
### Retention verification ledger

For the approved retention addition, the plain-Node persistence/retention
fixtures, fake-reporter lifecycle fixtures and workspace-wide
`pnpm run typecheck` passed. Retention coverage includes read-only accounting,
live/uncertain ownership, retained/latest baselines, user evidence, exact age
cutoffs, pending-file freshness, active/pinned changes after preview, malformed
records, symlinks, bounded inspection/deletion, startup integration and resuming
partial cleanup. All deletion verification used disposable folders. No app
workflow restart was needed for these standalone tooling changes.

After integrating the separate WebKit lanes, the combined metadata fixture
command initially reached its 60-second shell limit after printing all 21
passing WebKit assertions. This was a command-duration limit, not a failed
assertion; the fixture command was rerun with a larger shell allowance. Retention
also preserves the latest complete snapshot independently for each lane.
The retry exited successfully with all 21 WebKit metadata fixtures passing;
the merged persistence/retention fixtures also passed all 26 checks.
