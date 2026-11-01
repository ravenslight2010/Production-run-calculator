# Consolidated reliability closure — working ledger

Task: Close Remaining Reliability Gaps. This is an in-progress ledger, not a
completion certificate or release decision.

Last refreshed: 2026-11-01 UTC. This checkpoint preserves earlier failed
attempts; it does not recast a focused rerun as a full-suite pass.

Current source-boundary checkpoint: synthetic local coverage is implemented.
The actual preparation/snapshot regression file passed 23/23, including the two
new eligibility checks, and the root workspace typecheck passed. The focused
browser attempt remains one pass/three failures; its identified fixture cause
was corrected and checked at the preparation layer, not replayed in a browser.
The wider task and its unresolved app-wide browser evidence remain open.

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

The task is **IN PROGRESS**. The root typecheck passed, including the
generated-API and recovery checks, before the inventory-only update. The
scripts typecheck subsequently passed for the approved 240-case contract.
Fresh default-suite discovery, Chromium-only selection, and exact identity
checks passed. The first combined reporter regression failed on a separate
standalone-diagnostic mismatch (293 collected, 278 recorded). That failed
attempt is preserved. Following owner-approved exact review, the updated
combined regression passed both current collections and the original-set
retention fence; see the ledger and inventory document.

The earlier invalid Chromium attempt remains stopped/preserved. The approved
240-case main attempt subsequently ended with 187 passed, 43 failed, one
interrupted and nine not run. It is a failed attempt, not an executing run or
a passing-duration certificate. Subsequent bounded repairs and the selected
Warehouse recheck are recorded separately below.
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
| Required local integrated verification | FAILED MAIN ATTEMPT; REPAIR BATCHES IN PROGRESS | The approved 240-case attempt ended with 187 passed, 43 failed, one interrupted and nine not run. Focused repairs do not replace that result. No full-browser pass, certified duration, retry or duration-gate change is claimed. |
| Standalone diagnostic inventory | RECONCILED; REPORTER REGRESSION PASS | Owner-approved exact review established 15 additions and zero removals: 13 already-approved main cases plus focused saved-schedule and synthetic-import journeys. Updated 293-case digest retains a second fence for every original 278-case identity. Combined reporter regression exited 0 with fresh main 240 and standalone 293 collections and the original-set fence. No matcher, retry, timeout or browser assertion changed; no browser launched. See `docs/full-browser-inventory.md`. The previous failed attempt remains preserved, not relabeled. |
| Warehouse/local day-overlay queue | FOCUSED PASS; SELECTED WAREHOUSE BROWSER PASS | The staging, substitution/log and prep producers advance their synchronous local reference before the queue's acknowledged-snapshot comparison. The original nine regressions and 84 existing checks passed (93), with root typecheck. One exact, preflighted Warehouse staging/database/reload follow-up then passed 1/1 on disposable local fixtures. Other overlays are unit-verified, not browser-certified. The old main failure remains preserved. |
| Run ordering and suggested-order Undo | SOURCE REPAIR; CURRENT FOCUSED PASS | Manual/suggested ordering and Undo now queue the intended current snapshot. Forward actions preserve newer rows/values; positional moves refuse stale lists. Order-only Undo retains current fields and selection, and refuses changed membership/order, day, reset or operational scope. Final actual-source producer suite passed 27/27 with client typecheck and diff check. Earlier combined 105/root-typecheck evidence is recorded separately below. No run-order browser or physical-device pass is claimed. |
| Dough speed-change/wake fixture | CLOCK-DOMAIN ASSERTION REPAIR; RUNTIME RECHECK OPEN | The failed trace's simulated tick projected 8 trays about 159 seconds ahead of wall time; both subsequent wake GETs and the form showed 9. The test now binds adoption to that received wake projection and separately requires the simulated consumption interval to reduce batch stock. Exact one-case collection passed; this is not a browser pass or a production counter-formula repair. |
| Role/Gold API integration rerun | FOCUSED PASS | Role/import-operations rerun 268/268 and API typecheck passed. The later five-file run passed 291/292 before the final route inventory fix; that failure is preserved. |
| New active run hides eligible ended-run drain | REPAIRED; FOCUSED PASS | Explicit run identity prevents the newer active lifecycle from stealing the bounded case-only drain. Final server-claim/registration rerun: 50/50. No Sauce, applicator, or Dough cadence formula changed. |
| Missing protected Gold read inventory | REPAIRED; FOCUSED PASS | Approvals/retention use either manage-staff or manage-qc; cleanup uses manage-staff. All remain scoped and retain their existing role middleware. The mounted-router registration test passes. |
| Full API attempt | FAILED ATTEMPT; AFFECTED FILES RECHECKED | 2,483 passed/16 failed. Synthetic signup code and schema initialization repaired fixture setup; the public-health assertion now preserves privacy. The five-file and final two-file outcomes above are not a full-suite pass. |
| Current same-day published-runtime signals | CONTRIBUTING SYMPTOMS OBSERVED; ROOT CAUSE OPEN | Sanitized ten-minute serving-log rollup is appended to `reliability-closure-production-window.md`. Pool pressure, outbox timeouts and long queue snapshots occurred together; initiating workload, database execution time and sync-intent outcome remain unresolved. No capacity or retry setting changed. |
| Owner policy choices | RECORDED; DELIVERY STILL OWNED HERE | Packaging factual status only; approval-expiry reminders seven days before expiry; verified offline runtime-tool handoff approved for isolated testing. These decisions do not authorize publication, provider sends, real-source Gold, or production trials. |
| Production trial/publication and real-source Gold | APPROVAL-GATED | No production mutation or real-source permission is inferred from this task. Provider/host measurements and exact device/run correlation remain unavailable. |

## Additional local delivery gaps confirmed during the runtime freeze

These remain work in this task, not new follow-up tasks. The current browser
attempt cannot establish a feature that has not been delivered.

| Required outcome | Bounded current-source observation | Remaining work |
| --- | --- | --- |
| Audit event-type navigation | The freeze-time inspection found date/limit controls but no action filter. | Implemented bounded list/CSV/PDF filtering and committed UI selection; isolated API 20/20, UI 4/4 and leaf typechecks passed. Integrated browser certification remains open. |
| Device-only history comparison | The freeze-time inspection found retry/removal but no selected comparison. | Implemented the five read-only outcomes with exact date/run identity, bounded reads and ownership/late-result fences. First focused batch 20/20; the added selected-byte/access regression passed in the subsequent 11/11 migration-file run. Integrated verification remains open. |
| No-install startup diagnostic | The freeze-time inspection found no exposed diagnostic command. | Delivered direct Node command and root script with four passing tests. Live inspection found the shell/runtime pin mismatch and missing/unreadable expected cache metadata without executing tools. Integrity/offline handoff remain unverified. |
| Isolated background-concurrency trial | The worker already has bounded concurrency options; monitoring alone did not establish a measured trial. | The guarded baseline-2/trial-1 experiment passed its protected-job checks but **rejected** the candidate because synthetic queue age worsened and throughput fell. Existing source fallback remains 2; no app setting changed. Cross-scheduler/outbox and production behavior remain unverified. |

Application/test inputs were frozen during the approved runtime attempt;
that attempt has ended and bounded repair batches have resumed. This table is
a delivery-gap record, not a claim of comprehensive source
review or a conclusion that these omissions caused the published stalls.

## Approved runtime attempt: ten-minute checkpoint

The runner is not stalled: subsequent cases continued after failures. The
observed passing journeys include account recovery/session fencing, scoped Data
Health/guarded Undo, desktop/phone-layout lifecycle recovery, split-timer
pause/reload/independent-browser behavior, and Dough correction/Resume. These
are isolated browser-emulation observations on this attempt, not physical-device
or production results. They are not a final count or complete-run certificate.

Four saved failure traces were inspected for bounded assertion messages only;
network payloads, headers, cookies, and raw archives were not exported or shared:

| Case | Observed failure | Investigation state |
| --- | --- | --- |
| Supervisor break planning | Schedule menu item not found | Canonical role/capability hydration and current navigation contract remain to be checked. No permission change or conclusion that the denial is incorrect. |
| Touch break planning/reload | Diagnostic assertion includes aborted same-origin reads during reload/summary navigation | Distinguish deliberate navigation cancellation from unexpected transport failure; do not suppress all aborted requests or remove the clean-network assertion. |
| Department navigation | QC workflows menu item not found before the case timeout | Current navigation and isolated account promotion/identity refresh remain unattributed. No longer deadline is authorized. |
| Field-check diagnostics/local-copy removal | Facility-review panel remains after the removal click | Initial missing-confirmation hypothesis was incorrect: the call site already accepts confirmation. The panel intentionally retains the removal success receipt. The fixture now checks that the item/details are gone, the receipt is readable, and the selected local key is absent; confirmation and unsent-edit protection remain unchanged. Browser repair not yet reverified. |

The main run continues with zero retries. Repairs and targeted cheaper checks
remain inside this task after the assessed inputs are released; these failures
do not authorize another broad browser pass merely for mid-task confidence.

## Approved runtime attempt: eighty-minute checkpoint

The runner reached case 203 of 240 at its unchanged eighty-minute warning
boundary. It was still advancing; no deadline extension or input change was
made. Observed passing cases include paired Packaging correction through
wake/reload, explicit retry of a failed phone-layout correction, downward skid
correction against a stale automatic write, offline reconnect acknowledgement,
and sleeping-peer adoption of Stop. These remain isolated emulation results,
not physical-device or production certification.

Two additional saved wake traces were inspected for assertion messages only:

- Dough speed adjustment through wake: the expected subsequent acknowledgement
  did not advance from `"5"`; the cadence assertion expected eight trays and
  observed nine, with batches equal at 1.5. This is an unresolved functional
  result, not grounds to increase timing allowances or change production math.
- Recovered Stop: the case expected “Stop applied after recovery” but observed
  the generic latest-snapshot message. Whether the operation or only its
  displayed outcome is wrong remains unverified; a generic snapshot receipt
  must not be treated as proof that Stop was applied.

The full attempt remains running at this checkpoint. These inspected failures
are not a final failure count, and no complete-suite pass is claimed.

## Approved runtime attempt: final interrupted outcome and first repair batch

The runner exited **124** at its original ninety-minute boundary. Its console
summary records **187 passed, 43 failed, 1 interrupted, and 9 not run** (240
total). The runner reported successful disposal of the test database. The
requested final report and count-summary files were not produced; console and
per-case evidence are retained in the ignored attempt directory. This is not a
complete run, a passing runtime baseline, or a certification.

The first source inspection after the attempt found fixture defects:

- The shared “full manager” capability list omitted `manage-allergens`,
  `record-qc`, and `manage-qc` from the server's current canonical capability
  list. Fixture role assignment writes that incomplete list into disposable
  PostgreSQL, which can remove QC surfaces from later tests. The fixture list
  now includes all current capabilities, and the accessibility fixture reuses
  it rather than maintaining another incomplete list. This explains a
  concrete authorization-fixture mismatch; it does not prove that every QC
  failure has the same cause. Real roles and application authorization are
  unchanged.
- The supervisor scheduling journey now explicitly grants its isolated role
  `manage-factory-settings`, the capability required by the Schedule surface.
  Its role still lacks staff management and remains distinct from manager.
  No production/starter-role permission was changed.
- The removal test already accepts native confirmation. Its expectation that
  the entire review panel disappears conflicts with the retained success
  receipt. It now checks disappearance of the review details, a readable
  removal receipt, and the existing local-key deletion assertion. The earlier
  missing-confirmation hypothesis is withdrawn.

These are fixture repairs, not passing browser reruns. The other failures,
interrupted/unrun cases, and independent local deliverable gaps remain open in
this owning task. No duration limit, retry policy, or case inventory was changed.

The next repair batch corrected a client/server authorization mismatch: Home
queried retention reminders, offered retention navigation, and mounted the
retention panel based on capability alone although the API also requires
manager or QC Manager role. Those entry points now share the role-plus-capability
predicate; reminder cache identity also includes role/access state. The API
gate and real account permissions were not changed. The new pure regression
covers approved roles with/without each permitted capability and rejects
operator, supervisor, custom-role, and missing-role cases even when capability
is present.

Five Mix Plan navigation call sites used `/prev/i`, which also matched the
development-preview update button. Their locators now require a leading
`Prev` word, preserving the intended run button without matching preview.

Post-repair checks: canonical manager-fixture capability parity **11/11**;
FactoryDirectoryStatus, role-surface access, and retention-reminder unit checks
**20/20 across three files**; client `tsc --noEmit` **PASS**; locator distinction
sanity check **PASS**; `git diff --check` **PASS** before this ledger update.
These checks do not reclassify the original failed browser cases as passing.
Managed app workflows remain stopped; no shared-development database startup
or data changes were authorized by these fixture/client repairs.

### Failure coverage retained for the interrupted attempt

The saved assertion review also identified the following unresolved groups.
These are investigation categories, not a claim that all failures within a
group share a cause or have been fixed:

- Deferred-panel and department QC navigation; supervisor Schedule access.
  Fixture capability mismatches are repaired locally; browser results remain
  failed until independently reverified.
- Reload/navigation cancellation classification in break planning and repeated
  local-copy removal. Genuine transport failures must remain visible; no
  blanket suppression was added.
- Facility reconnect acknowledgement, malformed acknowledgement, and stale
  acknowledgement cases: one observed no successful acknowledgement; two
  observed an additional independent pending setting. Queue delivery and
  preservation need separate attribution.
- Startup tab restoration: the settling-session helper matched two status
  regions. It now scopes the assertion to the startup surface and releases its
  deliberately held auth request in `finally`, including assertion failure.
- Gold approval initial-error rendering, retention row/status rendering, and
  daily reminders. The role/capability mismatch fix does not establish their
  individual outcomes.
- Manager attention: Setup Profiles destination/focus, incident review action,
  and an unattributed 403. Staff issue review also has an overbroad incident-row
  match; target identity must remain exact rather than selecting an arbitrary row.
- Five Mix Plan previous-run navigation cases: their preview/Prev ambiguity is
  corrected in locators only, with browser evidence still failed.
- Phone operational calendar disabled-date expectation and premade-crust Start
  availability. Neither business rules nor date limits were changed.
- Prior-run drain and daily allergen-report unexpected retention 403s. Client
  retention gating is repaired; neither full journey is yet reverified.
- Three PWA update/chunk recovery cases; two Run Insights cases with destroyed
  execution contexts. No reload policy or update safeguards were weakened.
- Shared mix/cheese recipe component-refresh expectations. Actual versus
  fixture-only refresh behavior remains unresolved.
- Two wake cases described above, and stale-base recovery/no-op snapshot
  assertions in sync convergence. No snapshot/acknowledgement fence was removed.
- Visual regression mismatch and Warehouse staging persistence. No baseline
  was regenerated or comparison tolerance changed.
- Real-workbook parser returned 502 in one existing workbook test; the next
  deterministic-workbook case was interrupted by the deadline. No real source
  was inspected or retried during repairs; further real-source use remains
  subject to the task's source/privacy approval boundary.
- The authenticated QC workflow failure remains unattributed; the available
  assertion-only extraction did not establish its root cause.

### Audit event navigation repair

Added the optional bounded exact `action` query to audit list, CSV, and PDF
contracts. All three use the same validation, retain live-scope/capability
authorization, and apply the parameterized database condition before limits
or cursor pagination. Unknown valid event names return an empty result;
duplicate/nested/malformed names are rejected. No database schema or retention
policy changed.

The manager audit card now offers an event-type field with suggestions, commits
it only on Apply, includes it in cache identity and PDF downloads, and retains
explicit non-submitting buttons. The existing page-size control is aligned to
the server's 200-row limit rather than offering requests the server rejects.
Generated API client and Zod outputs were regenerated from OpenAPI.

Verification: isolated audit API/unit checks **20/20**, including tied-timestamp
filtered continuation, filtering before limits, cross-scope exclusion, list/
CSV/PDF consistency, invalid repeated filters, and denied operator access.
The disposable parent/child databases were cleaned up. Audit UI checks **4/4**
passed after correcting the extended test's expected PDF arguments and stubbing
its fixture-only download. The first root typecheck failed on unknown JSON
types in the new integration test; after adding response types, the next server
check identified a nullable cursor argument. A runtime cursor guard now narrows
that test value. The final server/client typechecks are running separately;
the earlier root command is not reported as passing. No full browser rerun was
started.

### Read-only device-history comparison

Added selected-item comparison against the existing authenticated completed-
history GET route, restricted to the exact reviewed local bytes. The control
compares date/run identities and run details, explicitly does not establish
ownership, and never uploads, restores, deletes, or rewrites either version.
It distinguishes matching details, differing details, no complete match,
ambiguous identities, and unavailable comparison. Protected pending/conflict
records do not become comparison/upload inputs.

Reads are limited to the selected date, bounded pages and response bytes;
repeated cursors, incomplete pagination, malformed responses, and permission/
network failures remain unavailable rather than “no match.” Account/scope,
capability, selected-source changes and unmount fence late results; request
ownership prevents duplicate taps from overwriting a newer comparison.

The first comparison/migration/status batch passed **20/20 across three files**,
including all five outcomes, exact identities, property-order independence,
bounded pagination, denial/offline failure, oversized responses, no mutations,
and account-change fencing. The client typecheck and whitespace check passed
after those changes. A further selected-byte/access regression was then added
to the existing migration test; that file subsequently passed **11/11**. Counts
overlap and are not combined into a new full-suite result.

The earlier separate server/client typecheck task also exited 0 after the audit
test JSON/cursor typing repairs. That does not turn the earlier failed root
command or interrupted browser attempt into passing results.

### No-install startup inspection

The direct command is `node scripts/src/startup-tools-diagnostic.mjs`, also
available as `diagnose:startup` when the manager already works. Its four Node
tests passed. The command checks filesystem presence and bounded metadata only:
no discovered executable, registry, provisioning command, cache writer, or
startup process is invoked. Unsafe workspace/symlink cache targets are reported.
Missing or stale entries are not executed as fallback managers.

The actual shell inspection exited 1 with findings: running Node **24.22.1**
versus selector **24.21.0**, and expected pnpm **12.8.1** Corepack metadata
missing or unreadable. Validation has continued to use the already available
pinned runtime runner; this inspection does not establish that app startup is
broken or that every alternative cache is absent. Cache presence is explicitly
unverified integrity, not proof of offline startup. The separate approved
build-to-runtime/offline handoff remains required.

### Concurrency experiment underway

Added a test-only opt-in experiment using the existing protected worker's
options, with a disposable-parent-name, loopback, test-mode, actual child-
database identity and four-slot pool fence. Ordinary route tests retain their
one-slot fixture. The production worker entrypoint, environment, fallback
concurrency and other schedulers/outboxes are unchanged.

The comparison uses synthetic work only: duplicate enqueue, queued cancellation,
one retry, a commit longer than its lease, bounded synthetic checkout/foreground
probes and clean shutdown. Planned measurements are acquisition wait/failures,
waiting count, queue age, event-loop delay, throughput and synthetic reminder
latency. No actual reminder is sent. Worsened backlog/starvation or other measured
regressions reject the candidate; even a synthetic improvement is not permission
for a production trial. The test-only scope does not establish all cross-
scheduler/outbox ordering or published capacity.

The pure opt-in/assessment checks passed **3/3**. The first isolated integration
attempt passed its one selected experiment (**16 other cases not run by the
name filter**) and cleaned up its child/parent cluster. Vitest suppressed its
console metrics, so that first pass does not establish a retained numeric
comparison. The test now emits a bounded explicit stdout marker, and the
experiment is being repeated solely to collect that missing measurement.
The server typecheck found an evolving `any[]` in the new trial's submitted-job
list; its type is now explicit and revalidation is running. No concurrency
setting was applied to an app service.

### Additional bounded browser repair and unresolved Stop attribution

The issue-review fixture now identifies the reported incident by both the
synthetic staff username **and** the returned correlation reference, including
after reload. It no longer treats every diagnostic from that account as the
same issue. Existing review/actor/reload assertions remain; no arbitrary first
matching incident was selected. This locator repair is not browser-reverified.

The wake/Stop failure reaches its expected **Ended** UI before failing the
specific outcome-message assertion. The inspected recovery code can show a
later generic snapshot notice when no retained Stop intent remains, but this
does not by itself prove the failing run's server acknowledgement or a display
race. No message assertion was weakened and no lifecycle fence was changed.

### Retained concurrency measurements

The output-marker rerun passed its one selected case, preserved **16 other
cases as not run**, emitted numeric measurements, and confirmed disposable-
cluster cleanup. The server leaf typecheck then passed after the explicit
submitted-list type repair; `git diff --check` passed. The earlier typecheck
failure remains recorded.

| Synthetic measure | Baseline concurrency 2 | Trial concurrency 1 |
| --- | ---: | ---: |
| Successful / cancelled / failed / pending jobs | 10 / 1 / 0 / 0 | 10 / 1 / 0 / 0 |
| Duplicate / mismatched effects | 0 / 0 | 0 / 0 |
| Acquisition failures / maximum waiters | 0 / 0 | 0 / 0 |
| Acquisition p95, ms | 0.0902 | 0.0612 |
| Queue-age p95, ms | 1,584 | 1,937 |
| Event-loop maximum, ms | 12.9516 | 11.0510 |
| Synthetic reminder latency, ms | 62.2097 | 51.0115 |
| Successful jobs per second | 5.7664 | 4.8245 |
| Retry-job attempts / clean shutdown | 2 / yes | 2 / yes |

Assessment: **REJECT** the candidate for this workload. Some latencies improved,
but queue age worsened and throughput fell. This is one synthetic measurement,
not production contention, physical notification delivery, or a safe production
concurrency recommendation. Actual configured production concurrency was not
read; 2 is the unchanged source fallback used for this comparison.

Bounded input digest:
`ddd60645f532673842d22fffa9790e5b9c275b8273dbe5ff557aa1ffce7c5295`.
It hashes the SHA-256 lines for the worker, trial helper, integration fixture,
trial unit test, root manifest and Node selector. It is not a full application
or serving-build fingerprint. The run used Node 24.21.0 and a four-slot private
loopback fixture pool. The input files were not changed during the rerun.

### Offline isolation preflight

Both user/network namespace creation and a same-UID loopback-only namespace
preflight succeeded. No shared network configuration was changed. This proves
that an OS-isolated offline check is possible here, not that an application or
retained startup tools have passed it. The actual built-runtime handoff/offline
startup check is still required.

### Offline handoff investigation — not certified or enabled

The existing launcher, copied with a fresh HOME/cache into an OS-isolated
network namespace, failed explicitly because its missing Corepack manager
required npm access. This is a synthetic cold-cache dependency observation,
not an observation of the published deployment.

An initial retained Corepack archive restored the dispatcher, but its offline
version probe failed because pnpm 12 requires a separate native executable.
Inspection of that pinned dispatcher's downloader established that its default
policy verifies the registry checksum and npm signature. The opt-in builder now
warms the exact manager outside project discovery with that default policy
enabled, and includes the native payload before packing.

Nine focused guard/metadata tests passed, and real signed archive preparation
passed under Node 24.21.0 with Corepack 0.36.0 and pnpm 12.8.1. The archive was
26,431,869 bytes. These are **not** successful runtime results.

Experimental archive SHA-256:
`d0fcfef9c4688fe80c4b0214d18fdf5be9deac65834dbb35d212fc26f7efac61`.
Only that generated archive and its generated manifest were removed from the
API output afterward, preventing accidental default deployment inclusion.
No application records, shared cache, dependencies or source assets were deleted.

The revised cold-runtime handoff timed out at its unchanged exploratory
35-second deadline. One bounded harness correction enabled loopback and copied
the workspace configuration; that attempt also exited **124** at 35 seconds.
The latter trace reached the launcher's `pnpm --version` after restoration and
selection of pin 12.8.1. Loopback alone did not resolve the failure. The cause of
that native CLI stall remains unattributed; no app or database was started by
these probes. No further retry of this probe was launched.

The helper and launcher option remain **explicitly opt-in**. The tentative
automatic build hook was removed before any rollout, and the normal Publish
build/run commands and target remain unchanged. No deployment configuration,
production service or managed development workflow was changed or restarted.
The optional command and regression checks remain available for continued
investigation in this task. No TLS/signature checks, original browser deadlines
or inventories were weakened. Full offline application startup remains NOT RUN.

The combined `test:build-identity` command subsequently completed with **exit 0**,
including its **48/48 Node tests**, TypeScript contract tests and measurement-
provenance checks. Bash syntax checks and `git diff --check` also passed in that
batch. This is not a release pass, a real native-manager handoff pass, or an
application-startup result.

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
  dialog case. The owner subsequently approved all 13 additions in the main
  suite. The exact contract is updated to 240 identities without changing
  filters, retry policy, or time limits. The comparison and approval are
  discovery/scope evidence only, not a browser pass.
- The post-approval scripts typecheck exited 0. The combined
  `release-duration-reporter.unit.mts` command exited 1 at its standalone
  293-versus-278 assertion, after accepting the fresh main-suite exact set.
  The standalone inventory decision is not inferred from main-suite approval.
- The new main-suite attempt launched at 2026-11-01 07:20 UTC through the same
  canonical isolated runner and unchanged reporters/retry/time limits.
  Its distinct, ignored results directory is
  `artifacts/run-calculator/generated-artifacts/reliability-closure-approved.Ih1R4I/`.
  Startup uses disposable PostgreSQL and synthetic account/session fixtures;
  no operational database or provider credentials are supplied. No main-suite
  completion or all-checks-green claim is made.
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

## 2026-11-01 — Warehouse and local-overlay queue repair

The preserved Warehouse staging trace failed while polling the disposable
database: expected the staged value `"true"`, received `null`, then reached the
20-second test deadline. The actual control is a button with `aria-pressed`;
its button semantics were not the defect and were not changed.

Source inspection found a separate, reproducible queue race that fits that
missed-write symptom. The queue's synchronous no-op comparison and eventual
payload both read the current day-state reference. Warehouse staging and
substitution handlers previously updated React/local storage but left that
reference unchanged until a later React effect. An acknowledged old snapshot
could therefore suppress the edit entirely. Rapid edits could also calculate
their next overlay or activity log from the same old reference. The prep
handoff effect had the same ordering problem.

All three producers now update the reference with the new local snapshot
before scheduling. No canonical baseline, hidden-document, foreground-wake,
in-flight-adoption, scope/date, epoch or acknowledgement fence was removed.
No production arithmetic, counter ownership, API contract or persisted schema
changed. Server-side staged-item union/uncheck policy is unchanged.

The Warehouse test manager fixture now uses the existing canonical manager
capability list rather than narrowing the shared fixture role to four
capabilities. This is fixture source only: no accounts or role records were
changed by this repair batch.

Verification sequence, including failed attempts:

- The first new test-loader attempt failed before executing the handlers
  because compiler directives were incorrectly treated as a function
  expression. That was a harness error, not six reproduced application defects.
  The loader now selects the emitted function structurally.
- Six subsequent assertions failed against the old Warehouse/substitution
  handlers, including no dispatch, rapid-edit loss and stale local references.
- After repairing those handlers, eight new regressions plus 84 existing
  focused sync/tracking checks passed. The following wider typecheck failed
  because the test imported TypeScript directly. The import was corrected to
  the required workspace adapter; no boundary rule was waived.
- A separate focused prep-handoff assertion then reproduced no dispatch
  against the old effect. Its producer received the same reference-order fix.
- The final combined command exited zero: all nine new regressions and
  84 existing focused checks passed (93 total), followed by the root workspace
  typecheck and `git diff --check`.

The regressions execute the actual source handlers/effect and `schedulePush`.
Payload construction and transport are bounded test doubles. They cover an
already-acknowledged baseline, rapid row checks, local net-zero unchecking,
successive substitution activity, prep handoff, and hidden/foreground/adoption
fences. They do **not** establish real React/device wake timing, server
acceptance, stock consumption, reload persistence or cross-device convergence.
At this checkpoint the original Warehouse browser journey still needed its
isolated recheck; the subsequent result is recorded below.
Other non-reference `schedulePush` callers have been enumerated for continued
review; they are not all classified as bugs because some independently stamp
run metadata or enqueue operational intents.

No browser, managed workflow restart, publish, shared development-data write,
production mutation or release decision occurred in this batch. The task
remains in progress and the failed main-suite result remains authoritative.

## 2026-11-01 — Selected Warehouse follow-up and run-order repair

### Warehouse persistence follow-up

Collection-only preflight selected exactly the existing Chromium case
`operator staging check persists for a canonical per-run material across reload`.
The approved isolated runner then executed that single case with its existing
assertions, timeout, no-retry policy and one worker. It passed **1/1**: the
operator's staging check reached the disposable database and remained checked
after reload at the tested emulated screen sizes. The runner exited zero and
cleaned up its disposable services. Shared development and production records
were not changed.

Bounded trace review found two `/api/sync/today` PUT responses with status 200,
no recorded HTTP failures and no unexpected browser console/page errors.
The six console warnings were the expected Playwright-blocked service-worker
registration notice. Build output retained chunk-size/deprecation/color
warnings; no warning threshold or assertion was weakened. Authenticated trace
images showed the synthetic Warehouse screen. Raw traces remain in ignored
private generated output, not published or exported.

This is a selected-flow result on its recorded inputs, before the later
run-order repairs below. It does not replace the failed 240-case attempt,
establish physical wake/cross-device behavior, or certify other overlays.

### Same queue class in run ordering

Source review found the same reference-before-queue omission in manual moves,
suggested ordering and its Undo. Per-run metadata stamping compares rows by ID,
so an order-only edit does not independently provide a changed metadata stamp
to rescue the old-reference no-op check.

The old Undo also restored captured run objects and the previous selection.
It could overwrite newer values or drop later membership changes. The repair
captures immutable order IDs, reorders current records only, preserves current
selection and values, and rejects compensation after membership/order,
day/reset or operational-scope changes. Rejected work shows an actionable
message and performs no partial save or dispatch.

Forward ordering also uses the latest synchronous rows. Suggestions keep
newly added runs; a positional move refuses a changed rendered ordering
rather than moving a different run. Both refuse crossing a changed day/reset.
No cadence formula, production quantity, API/schema, role permission, canonical
acknowledgment requirement or existing wake/adoption fence changed.

Verification chronology:

- Two launcher attempts timed out before test collection. The shell used
  Node 24.22.1 while the repository required 24.21.0, causing external fallback
  acquisition despite the retained matching executable. Putting the verified
  executable first on PATH restored the supported runner. Its locks, pin
  validation, TLS and signature safeguards were not bypassed.
- Against the old ordering/Undo handlers, eight actual-source assertions
  failed and ten passed. This was an application-regression result, unlike
  the earlier unstarted launcher attempts.
- After the initial order/Undo repair, the combined six-file batch passed
  **105/105**, followed by the full root workspace typecheck and diff check.
- Immutable-ID hardening then passed **22/22** producer regressions plus the
  client typecheck and diff check. This was a narrower follow-up, not another
  full workspace or browser certification.
- Five additional latest-row/stale-position/day/reset cases reproduced
  failures before forward ordering was repaired: five failed, 22 passed.
- The final actual-source producer suite passed **27/27**, followed by the
  client typecheck and diff check. Unchanged focused suites were not rerun
  merely to inflate counts; results from different inputs are not summed
  into a claimed single run.

These tests execute the source handlers and queue with bounded state/transport
doubles, not a real React/account transition or server ordering transaction.
The desktop preview loaded the signed-out entry screen on its current port;
that screenshot does not verify the changed authenticated flows. The earlier
default-port capture could not connect, and the component-preview port was
not mistaken for the application.

No managed workflow restart, publish, manual commit/push, provider send, real
source capture, shared development-data write or production mutation occurred.
The task remains **IN PROGRESS**. Remaining local integrated journeys and
failure dispositions are still owned here; the full-browser and external
evidence gaps are not waived.

### Dough speed-change/wake failure disposition

The ordinary Dough correction/Resume case is separate from the failed
`speed adjustment during a dough run stays aligned across screen wake` case.
The preserved latter trace failed on expected 8 versus displayed 9 trays;
batch stock matched at 1.5.

Bounded request/response metadata shows that its last simulated tick evaluated
a time approximately 158.6 seconds ahead of server capture time. That tick
accepted two claims and returned the future projection of 8 trays/1.5 batches.
Both subsequent actual wake GETs returned 9 trays/1.5 batches, matching the
form. The failing assertion compared that real-time display with the earlier
future projection. This evidence does not establish a production counting
defect or justify changing a production formula.

The test repair:

- keeps the simulated due-boundary and accepted-claim checks;
- additionally requires batch stock to decrease across that simulated
  consumption interval, rather than accepting success from an unrelated channel;
- binds form/adopted-value checks to the projection in the actual final wake
  response, with numeric and run-identity assertions;
- watches for forbidden retired browser claims through form adoption, not
  merely until the wake acknowledgment;
- retains the existing recovery fence, speed, hidden-time bounds, case count,
  projection/calculation consistency, timeouts and no-retry policy.

Collection-only preflight passed for the exact changed Chromium case, with no
collection errors; `git diff --check` passed. Private collection metadata is
under the ignored `dough-wake-clock` generated-output prefix. **The corrected
journey has not been rerun.** No browser result, physical-device behavior or
full-suite certification is inferred from collection, and the old failed
attempt is preserved.

### Bounded documentation/reference review

Input scope: the current task plan, this progress record, the browser inventory,
and seven Markdown documents in `docs/research-reconciliation`, reviewed on
2026-11-01. The inventory's historical screenshot hashes and the available
local duplicate uploads were permitted evidence. No external service, live
records or image contents were inspected for this check.

| Atomic claim/reference | Assessment and confidence | Evidence and limitation |
| --- | --- | --- |
| Explicit local Markdown links resolve in the ten-document set | **verified — high**, after repair | The initial scan found 160 targets and four broken screenshot links. Each replacement upload matched its original retained SHA-256 exactly; only navigation links changed, not the original inventory/provenance. The post-repair scan passed all 160 targets with zero missing. This is not a review of all repository prose or remote links. |
| Primary-document literal path references remain available | **partially verified — high** | The final scan found 44 literal references in the three primary documents: 42 resolved and two occurrences refer to the same historical ignored archive directory absent from this workspace. Path existence does not validate every cited symbol, line anchor, or semantic claim. |
| Historical stage-marker archive can establish byte-for-byte integrity now | **unsupported — medium** | The historical browser-inventory row says the marker was archived under `.local/build-identity/archived-stages/`; that directory is not available here. This does not disprove the historical action, but current integrity cannot be rechecked without the original archive and its recorded identity. The artifact was not recreated or substituted. |

The historical marker wording and its dated test outcomes are preserved,
qualified by this current availability review. The archive gap does not
invalidate independently recorded later typechecks and does not establish a
current application defect. No full source-catalog content review, production
verification or complete code-reference certification is inferred.

### PWA fixture build-mode repair — browser results still open

The preserved safe-before-update failure's page snapshot shows
“Development preview. Published updates are not checked in this development
preview,” while the test expects “Update ready.” Current application source
selects that preview state using Vite's DEV flag. The two-version fixture built
with an inherited process environment and did not pin its child's NODE_ENV.

A focused regression reproduced the mismatch with the real installed Vite
resolver: a build command with a development parent resolved DEV=true,
PROD=false, isProduction=false. Before the fix, four of eight assertions
failed. The fixture now supplies production NODE_ENV only to its child build;
it retains the distinct old/new fixture IDs, the existing fixture-only idle
interval, unrelated inherited flags, and the unchanged parent environment.
The eight regressions then passed, including Vite resolving DEV=false,
PROD=true, isProduction=true.

This is a fixture correction, not a production update-policy change. No
application safety gate, timeout, retry, worker count, browser inventory or
production inactivity interval was relaxed. The three historical PWA browser
failures remain open pending runtime verification; the build-mode evidence
does not prove every failure has this single cause.

The passing eight-test invocation was followed by an unnecessary repeated
client typecheck attempt that reached the shell command's 60-second deadline
without emitting a type diagnostic. No new typecheck pass is claimed from
that attempt. The application source covered by the earlier passing client
typecheck has not changed in this fixture-only batch; that check does not
typecheck these excluded test files.

The three selected PWA cases subsequently collected without errors. This
validated fixture imports and test discovery only; no browser was launched.

### Run Insights navigation/readiness repair — runtime recheck open

Both preserved Run Insights failures terminate in the profile-storage
readiness poll following sign-in. Their failing expression reads storage; it
is not the later Accept, Dismiss or “Got it” mutation. The traces contain two
document requests, but that alone does not establish the cause of navigation
or certify the application actions. Source review also confirms the shared
native Button already defaults to a non-submit button; no speculative button
or production change was made.

The readiness helper now uses Playwright's navigation-resilient browser wait
with the exact same storage predicate and 20-second limit, rather than a
Node-side assertion poll whose page evaluation can lose its execution context.
No API errors, response codes, final storage assertions or action outcomes are
ignored. These browser journeys remain unverified on the repaired fixture;
collection and source review are not runtime passes.

All three Run Insights cases subsequently collected without errors. This is
discovery/import evidence only, not verification of their interactive outcomes.

### Source/provider-boundary preflight — decision pending

The selected “manager gets Mauro's three products in review; source audit calls
are read-only” case uses a real customer workbook, allows AI requests to pass
through, and retains review evidence. “Read-only” does not make that source use,
retention, or provider call authorized for this task.

This phase did not execute that case or read the workbook. Neither the approved
240-case main inventory nor the reconciled 293-case diagnostic inventory was
changed. A decision was requested about synthetic local coverage while preserving
the real-source check as blocked, retaining the current blocked inventory, or
reviewing the necessary approvals. No answer or authorization is assumed.
Source-dependent verification must remain blocked until that boundary is
resolved; it must not be silently skipped or reported as passing.

### Published runtime observation — 2026-11-01 15:25–15:33 UTC

A read-only runtime investigation confirmed an active public Autoscale
deployment with a successful build. The 84 returned, non-truncated log entries
were scoped to serving revision `42763954-0c35-47c4-8b4b-6ea38c26deb1`, created
2026-10-30 15:38:15 UTC. No build was created in the incident window. This
revision binding does not establish agreement with the current local candidate.

Observed background impact includes repeated sync-outbox retries, push enqueue
failures, queue-monitor sample failures, and server-job dependency/deadline
failures. One approximately 61-second capacity window recorded 32 acquisition
errors, acquisition p95 8.1 seconds/max 11 seconds, and event-loop delay p95
2.3 seconds/max 6 seconds. Another window recorded event-loop delay p95
6.4 seconds/max 25.4 seconds and acquisition max 29.2 seconds. These are
server-runtime observations, not a trace of a particular user's action.

The initiating cause remains **inconclusive**. Successful post-checkout phases
also sometimes took seconds; those durations include runtime scheduling and
cannot isolate database execution time. A point-in-time database-capacity
observation showed one active/five idle backends and no active/lock waiters,
against a reported 450-connection maximum. That sample neither proves sustained
healthy connectivity nor supports a database-wide connection-limit diagnosis.
Increasing the pool is not justified by this evidence.

Resource/aggregate metric queries were unavailable from the observability
service. Endpoint telemetry exposed only readiness: four requests, no reported
4xx/5xx, p95 483 ms. User-route impact, CPU saturation and memory pressure remain
unverified, not zero. Failure events were exported at INFO severity, so an empty
ERROR-only query would have hidden them.

The investigation made no file, configuration, account, database, infrastructure,
or deployment changes and generated no synthetic production traffic. No claim
is made that the local repairs caused or fixed the published symptoms. The next
useful measurement is aligned runtime-resource, acquisition/post-checkout and
background-concurrency evidence for the same revision/time window; unavailable
measurements remain gaps rather than grounds for speculative capacity changes.

### Current client timing gate — failed attempt preserved

The standard client command completed its prerequisite checks and reported
395 passing test files/one skipped file, with 3,843 passing assertions and one
existing skipped test. Nevertheless, the command **failed**: the budget runner
measured 159.0 seconds against the unchanged 150.0-second limit. This is not a
passing client validation result.

The two new suites accounted for approximately 2.869 seconds and 0.418 seconds
of reported test-body time. These figures do not include all import/environment
cost and cannot explain or attribute the whole difference from the earlier
121.7-second workflow result. Detailed temporary JSON timing reports were no
longer retained; bounded per-file timings remain available in command logs.
Current host load/quota observations do not establish resource conditions
throughout either earlier run.

The handler-source harness was found to traverse/transpile the same immutable
callbacks repeatedly. It now caches only emitted source expressions, not bound
functions; each scenario still gets fresh refs, mocks and timers. All assertions
and the 150-second limit/worker ceiling remain unchanged. Only the failed timing
gate is being rechecked after that concrete test-helper change; unchanged
prerequisite checks are not being repeated. A passing result is not assumed,
and no runtime improvement will be attributed solely to this cache without
controlled evidence.

The post-optimization timing-gate invocation subsequently **passed** (exit 0):
395 files passed/one skipped, 3,843 assertions passed/one existing skip, measured
143.5 seconds against the same 150.0-second budget and four-worker ceiling.
This verifies the current test-helper inputs without changing assertions or
budgets. The earlier 159.0-second failed attempt remains recorded. Unchanged
prerequisite checks retain their earlier passes; the entire standard command
was not rerun. This client result is not browser certification, a production
performance finding, or completion of the wider task.

### Approved synthetic source boundary — 2026-11-01

The owner approved synthetic local coverage, not customer-source use or provider
sends. The three-product review/cancel case now uses an invented in-memory
workbook and a mocked response. The permission-denial and failure/retry cases
also use that fixture; deterministic export remains synthetic. The real-source
audit implementation is retained, excluded from both local inventories and
fails closed at entry if another configuration selects it. No flag or project
name substitutes for the still-required source-use, retention, privacy and
provider authorization.

Local AI routes are mocked or blocked, with a deny-by-default route and blocked
service workers to prevent bypass. Native checks passed for unsupported-layout
fallback, all three profiles' cited cells, fresh payload objects and the
fail-closed guards. Read-only discovery/reporter verification passed: 240 main
and 293 standalone identities, exactly one approved replacement. The previous
293-set digest and original 278-set digest still match after reversing that
replacement and the earlier reviewed additions respectively. Current standalone
digest: `ef7213cec9eb66a207be3336952fee7d5f5cc08762791b70e8d0365be50563ab`.

The first focused follow-up setup failed before starting Playwright or its
disposable database: its root evidence-directory parent did not exist.
The correction uses the app's existing generated-artifacts directory, after
checking that Git and publishing already exclude it. Native checks were not
repeated on retry. The four changed local cases are the only runtime follow-up
selected; their result is pending, not assumed to pass. This is not a fresh
full-suite run or a production/physical-device result.

The disposable browser follow-up then executed all four selected cases:
**one passed, three failed**, in 2.0 minutes. The deterministic export case
passed. The other three received the importer's correct unsupported-source
message instead of entering fallback. The first native check had proved only
that the layout was not a deterministic export; treating that as full fallback
eligibility was insufficient.

The fixture header now explicitly says that it is synthetic pizza recipe specs,
which is the existing content-based eligibility cue. No production parser,
permission check, rejection rule, assertion, timeout or retry limit was relaxed.
Two regressions exercise the actual web preparation path with mocked AI and with
AI disabled, rather than copying the eligibility regex. Their verification is
pending. The three failed browser outcomes remain unresolved runtime results;
no unchanged passing flow or fresh complete browser lane is being repeated.

Synthetic evidence writing is now scoped to each Playwright attempt's private
output directory rather than the retained real-source audit directory's fixed
filenames. The focused attempt's JSON, failures and traces remain private in the
app's ignored generated-artifacts area. There were no customer workbook reads,
provider sends, managed workflow restarts, shared-development data changes,
production writes or publication.

Corrected-fixture verification completed with exit 0: the native source/citation
guards passed, all **23** preparation/snapshot tests passed (including the new
authorized mocked-AI and AI-disabled eligibility cases), and the root workspace
typecheck passed. This establishes the corrected admission path without
repeating the unchanged passing browser flow. It does not turn the three
recorded browser failures into runtime passes.

The preceding complete client timing-gate result (143.5 seconds against 150)
predates those two additional regressions. Its historical pass remains recorded;
the expanded whole-client suite's timing was not re-certified in this checkpoint.
Default/standalone case identities did not change with the fixture-header fix.
The successful synthetic review paths also explicitly mock the optional
name-matching endpoint with empty alias results; other AI endpoints remain
denied. AI-disabled and deterministic cases do not receive that matcher mock.
The final native guard and 23-test preparation file passed again after adding
the matcher boundary and exact prepared-brand assertion. Browser-fixture syntax
and `git diff --check` passed; neither is a browser runtime pass.
Older relative Playwright artifact paths resolve under the calculator app:
the original broad-run and selected fixture artifacts were located there, not
lost or replaced. Final integrated browser/local-release evidence is still
required before the owning task can be completed.
