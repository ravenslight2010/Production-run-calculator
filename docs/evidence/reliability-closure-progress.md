# Consolidated reliability closure — working ledger

Task: Close Remaining Reliability Gaps. This is an in-progress ledger, not a
completion certificate or release decision.

Last refreshed: 2026-11-01 UTC. This checkpoint preserves earlier failed
attempts; it does not recast a focused rerun as a full-suite pass.

## Intake

- Owner: assigned Replit Agent. One task owns all four internal milestones.
- Repository at intake: clean application tree, Replit branch ahead of its
  remote by 18 commits. At this resumption, HEAD and the local remote-tracking
  reference both identify `024a87633`. This continuation has not pushed, reset,
  published, or changed production records; remote metadata is not serving-build
  verification.
- Supported task lookup: only this closure task is active; no competing repair
  task was found. The task register retains the planning wave's 98 metadata
  records; metadata or plan review is not review of completion evidence.
- The shared development database remains protected. Mutating checks must use
  independently fenced disposable fixtures.
- No required local check has been waived and no follow-up task created.

## Current objective and progress

Current objective: finish operational stability, then permission accountability,
bounded manager tools and integrated verification on the final source.

Completed intake: repository/task overlap, instructions and applicable memory
reviewed; 98-record task-register metadata retained. The canonical sync-health
selector/read-only calculation has 12 passing focused tests. The client suite
completed 393 files with 3,794 tests passing and one skipped. The focused
cleanup and approvals UI pass completed 22/22 after correcting an ambiguous
test query.

The role/import-operations integration rerun subsequently passed 268/268 and
the API typecheck passed. The first 266-pass/two-failure attempt remains a
failed attempt, not a pass. Its fixes preserved the optional seven-day summary
and the registered retention-verification write policy.

The later full API attempt reported 2,483 passing and 16 failing tests. Twelve
signup-related failures came from withholding the signup code instead of using
a synthetic test code. A background-diagnostic persistence failure was resolved
by initializing the disposable parent database schema. The public `/healthz`
test was corrected to assert that protected diagnostics are **not** exposed by
the public probe; no public diagnostic access was added.

That attempt also exposed a real run-handoff defect: normal server selection
preferred the new active run even while planning an older run's eligible
case-only freezer drain. The planner now explicitly targets the drain's run.
It preserves authoritative active-run selection, run-scoped application,
duplicate-claim handling, and the bounded freezer window.

A schema-initialized disposable rerun then passed 291/292 tests across five
files. Its remaining registration failure exposed omitted protected read
contracts for Gold approvals, retention, and cleanup navigation. Their actual
capability/scope policies are now recorded without changing route access.
On 2026-11-01 the final focused rerun passed **50/50** across route registration
and server auto-track claims. The drain regression covers both pending/running
next runs and both selected-run positions. This is not a new full API pass.

The 50-test checkpoint used base `024a87633` plus a bounded changed-file diff
digest `0501b46a967fa48e1ef5e61ca2fb70f83bcb47093ca88f60ae3c5d694b6a96e1`
for the route inventory, its registration test, and the expanded auto-track
test. This digest is not a full application or published-build fingerprint.
The underlying planner files were unchanged during this continuation.

Prior isolated clean-start/API/web/proxy/mockup/reload checks passed, with no
unexpected browser console/page errors. The unsigned `/api/me` rejection was
expected. Separate pure package suites passed: rules 17, inventory math 96,
spec reconciliation 33, scheduled recipe checks 19, spec export 51, corpus 12.
These outcomes retain their earlier test identities; unchanged suites were not
rerun merely to refresh their counts.

The task is **IN PROGRESS**. The final root typecheck passed, including the
generated-API and recovery checks. The complete isolated Chromium attempt was
stopped after its approved-inventory guard rejected the collected suite.
Current sync/wake behavior against a second physical device and the
remaining scheduled, inventory and operational-domain journeys have not all
passed. Full release evidence remains a separate lane; the standard release
gate correctly stopped because there is no matching published revision record.
No source imports, real customer workbooks, shared development records or live
data were used in the isolated API tests.

## Failure and decision ledger

| Finding | State | Evidence / owner / next action |
| --- | --- | --- |
| Manager sync-health uses device selection while shared calculations follow lifecycle | FOCUSED PASS | Shared selector/calculator identity has 12 passing focused tests, including no-mutation checks. Final integrated browser evidence remains separate. Owner: this task. |
| Production database aggregate measurement unavailable | BLOCKED | Supported production aggregate SELECT rejected with `Production database access requires an authenticated user.` No result or direct-connection workaround. Owner: supported production-access authority; next action is an authenticated read-only session, not credentials in chat. |
| Published stalls' causal attribution | INVESTIGATING | Read-only SRE investigation running against the supported deployment. Historical pool and loop-delay overlap remains correlation, not root cause. Owner: this task/platform measurement authority. |
| Required local integrated verification | IN PROGRESS; FULL CHROMIUM INVENTORY BLOCKED | Final root typecheck passed. Runtime discovered 240 cases against an approved 227-case contract; the attempt was stopped and preserved. No case, retry, or duration gate was changed. |
| Role/Gold API integration rerun | FOCUSED PASS | Role/import-operations rerun 268/268 and API typecheck passed. The later five-file run passed 291/292 before the final route inventory fix; that failure is preserved. |
| New active run hides eligible ended-run drain | REPAIRED; FOCUSED PASS | Explicit run identity prevents the newer active lifecycle from stealing the bounded case-only drain. Final server-claim/registration rerun: 50/50. No Sauce, applicator, or Dough cadence formula changed. |
| Missing protected Gold read inventory | REPAIRED; FOCUSED PASS | Approvals/retention use either manage-staff or manage-qc; cleanup uses manage-staff. All remain scoped and retain their existing role middleware. The mounted-router registration test passes. |
| Full API attempt | FAILED ATTEMPT; AFFECTED FILES RECHECKED | 2,483 passed/16 failed. Synthetic signup code and schema initialization repaired fixture setup; the public-health assertion now preserves privacy. The five-file and final two-file outcomes above are not a full-suite pass. |
| Current same-day published-runtime signals | CONTRIBUTING SYMPTOMS OBSERVED; ROOT CAUSE OPEN | Sanitized ten-minute serving-log rollup is appended to `reliability-closure-production-window.md`. Pool pressure, outbox timeouts and long queue snapshots occurred together; initiating workload, database execution time and sync-intent outcome remain unresolved. No capacity or retry setting changed. |
| Owner policy choices | RECORDED; DELIVERY STILL OWNED HERE | Packaging factual status only; approval-expiry reminders seven days before expiry; verified offline runtime-tool handoff approved for isolated testing. These decisions do not authorize publication, provider sends, real-source Gold, or production trials. |
| Production trial/publication and real-source Gold | APPROVAL-GATED | No production mutation or real-source permission is inferred from this task. Provider/host measurements and exact device/run correlation remain unavailable. |

## Next local checkpoint

- Root command completed with exit 0:
  `CI=true bash scripts/src/run-release-node.sh pnpm run typecheck`, using
  the installed project-pinned Node 24.21.0 selected first on PATH.
- Establish the current complete browser inventory and execute the approved
  isolated runtime lane with unchanged case identities and duration limits.
  The Chromium attempt began at 2026-11-01 07:05 UTC through the canonical
  isolated runner, retaining the list and release-duration reporters, zero
  retries, and an external 90-minute hard stop. An 80-minute warning is armed.
  The isolated app startup/build completed, but the reporter rejected 240
  collected cases against the approved 227-case inventory. Playwright continued
  invoking callbacks after the reporter's startup error, producing secondary
  `Unknown browser attempt case` errors. The attempt was explicitly stopped.
  Its partial runtime results are not complete-suite certification.
  Raw fixture results and its report are under the ignored, deployment-excluded
  `artifacts/run-calculator/generated-artifacts/reliability-closure.8qY3Wy/`.
  That directory is private by local file mode, not a secret-storage boundary.
  Earlier reports are not overwritten. No shared database or real credentials
  are supplied to this attempt.
- Read-only collection comparison confirmed **13 additions, zero missing
  approved identities**: six sync/reconnect/first-baseline cases, one repeated
  saved-copy-removal case, five Gold approval/retention cases, and one Schedule
  dialog case. Approval is needed before changing the reviewed inventory.
  The comparison is discovery evidence only, not a browser pass.
- Continue the remaining lifecycle, inventory/stock/history, importer recovery,
  and break/report/notification journeys inside this owning task. The 98-record
  register still distinguishes metadata review from completion-content review;
  its generic dispositions are not yet an evidence-backed closure of every item.
- Finish documentation/reference validation and the owner-readable handoff.
  No milestone or task is complete merely because the focused batch passed.

The three closure plan/progress/production-window documents passed a bounded
local-path check: 35 literal relative links/rooted file references, zero missing.
This does not validate external URLs, symbol references, or all research
documentation. Whitespace validation also passed before the final ledger update.

## Compatibility and trust lanes

The first repair is a server-side, read-only diagnostic calculation. Pure report
tests apply independently of viewport. Changed manager web controls later require
desktop, phone and tablet portrait/landscape Chromium/WebKit checks. Physical
Android/iOS/PWA and actual provider delivery remain NOT RUN without authorized
device/provider access; emulation is not a substitute.

Production observations are read-only and do not certify the repaired local
source. Local passing tests cannot certify an unmatched published build. The
development database remains unmodified. The captured production SQL gateway
still denies aggregate access without an authenticated user.
