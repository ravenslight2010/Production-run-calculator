# Consolidated reliability closure — working ledger

Task: Close Remaining Reliability Gaps. This is an in-progress ledger, not a
completion certificate or release decision.

Last refreshed: 2026-11-02 UTC. This checkpoint preserves earlier failed
attempts; it does not recast a focused rerun as a full-suite pass.

Latest resumed checkpoint: the ingredient-ID stale-profile overwrite is
repaired, and both mix/cheese pending-refresh → Start freeze → peer reload
browser journeys passed. Three Gold journeys passed; the reminder fixture's
role assignment is corrected but its browser journey is not rerun. The declared
client command subsequently exited 0: **395 files passed, one file skipped;
3,868 tests passed, one skipped; duration guard 103.7s / 150.0s**. The existing
real-workbook audit skip is retained, not newly added. This clears the current
client-runtime blocker only. The full-browser failure and remaining app-wide,
physical-device and publication-bound gaps keep this task **IN PROGRESS**.

### Completion continuation — isolated runtime available

The previous checkpoint's unavailable-app explanation was too broad. The
existing guarded staging runner can build and serve its own app and PostgreSQL
cluster; restarting the shared development API is not necessary for local
verification. The current platform snapshot lists managed workflows as **not
started**; the earlier ENOENT observations remain historical failed starts.

The existing `isolated-staging.mjs serve` path completed successfully on the
current source, with **13 recorded PASS checks** and exit **0**, including:
independent app/cluster/build preflight, synthetic manager/operator setup,
unauthorized inventory-write denial, invalid-session/validation no-write
checks, committed manager adjustment, restart/sign-in persistence, empty
disposable reset, reseeding, and verified app/cluster cleanup. Its retained
report is
`.local/isolated-staging/reports/b43d4faefeac572d4fc04a6ad134027f.json`.
The serving source fingerprint was
`fc735602b5942897340e468ded7945da5d78a25ad6ed50e38242a1764fe506ac`.
This is isolated local runtime evidence, not production evidence. A desktop
screenshot confirmed the unsigned landing page only; anonymous 401 console
observations do not certify authenticated navigation.

The two previously failed Run Insights cases were then rechecked through the
existing disposable-database runner and focused diagnostic configuration:
**2/2 PASS**, no skips/flakes/retries, **51.788 s**, exit **0**. The selection was
limited to Dismiss persistence and next-run follow-up/Got-it, whose subtle
reload/context failure needed runtime confirmation after the seed repair.
Evidence:
`artifacts/run-calculator/generated-artifacts/insights-reload-runtime.9iyjKq/results.json`
and its private `run.log`. The unchanged Accept case and passing unrelated
flows were not repeated. This closes those two focused failures, not the
interrupted full-browser result.

The canonical isolated API-unit entrypoint also passed **134/134 files,
1,342/1,342 tests**, in **79.51 s**, exit **0**, on an independently created and
ownership-checked local cluster. Both its generated API database and outer
cluster were cleaned up. Evidence:
`artifacts/run-calculator/generated-artifacts/closure-api-isolated.i7Jnx7/`.
That entrypoint excludes integration files; it is not by itself a complete API
suite pass or a replacement for the earlier failed full-API attempt. The
remaining integration-file partition subsequently passed **59/59 files,
1,165 tests passed / one skipped**, **338.77 s**, exit **0**, with its independent
cluster cleaned up. The selected filenames and cleanup receipt are retained at
`artifacts/run-calculator/generated-artifacts/closure-api-integration.RERE6W/`.
The one skip is the existing opt-in background-concurrency trial in
`serverJobs.integration.test.ts`, not a new exclusion. Its earlier isolated
trial and rejection of the lower-concurrency candidate remain recorded below.
Together these disjoint partitions provide **2,507 passing API tests and one
reported opt-in skip across 193 files**. They are two runs, not a single timed
full-suite certification; the separately owned convergence lane was not
repeated merely to refresh its passing count.

Evidence reconciliation also located an earlier **PASS** for the exact five-run
Start/Packaging/End/explicit-none case in the original main attempt's durable
case ledger. Its original source/test identities are retained at
`.local/browser-verification-attempts/153ae08f-b3c2-4b8d-8aab-5ef34a71da51/progress.json`.
This corrects the claim that no five-run evidence exists; it does not establish
a final-source joined substitution/stock/history journey.

No shared-development/production data, provider configuration, publication,
test limit, retry policy, inventory contract or visual baseline was changed.
The task remains **IN_PROGRESS** until required remaining local verification
and disposition reconciliation are resolved.

The task register now assigns every one of the **43 archived suggestions**
exactly once to a current disposition/evidence group, retaining all **98**
original records and their review depth. A native JSON/set/link check passed.
Of the **55 merged records**, **43** still have metadata-only review and need
outcome reconciliation; the other **12** have plan-content review but no
completion certificate. None is treated as verified solely from MERGED status.

### Supported production observations — access restored, not causal proof

The earlier authenticated-production-read denial no longer reproduces. A
supported read-only aggregate succeeded and reported `pg_is_in_recovery() =
true`, one visible/active connection and zero lock waiters. This is a **replica**
sample, including the observation query, not a measurement of the serving
application's primary pool, acquisition phases or historical load. The
three-table diagnostic/health/snapshot metadata result did not expose a
persisted pool-phase measurement source.

Current deployment metadata reports a successful Autoscale build. A public,
read-only `/api/build-info` observation returned release build
`app-build:934ed015-7a94-4db0-a558-0fdbad559c27`, source fingerprint
`2da695ab03f3d90d3c2fa5c6d90519addbc420701e88445b5df3b986e0629cdb`.
It differs from the isolated candidate above. No publication or deployed
candidate verification is claimed.

After supported metric discovery, one aggregate batch for the previously
recorded **2026-11-01 15:25–15:33 UTC** window returned CPU p95 **2.92%**, memory
p95 **12.6%**, **5 requests**, and request-latency p95 **365.54 ms**. The 5xx and
error-log series had **no points**; that is not evidence of zero errors.
Those host aggregates do not establish the initiating cause of captured
pool/outbox/queue delays or rule out brief primary-database/runtime stalls.
No capacity, timeout, retry, concurrency or provider setting changed.

An initial inline probe failed before HTTP because a sandbox URL global was
unavailable. Explicit `node:url` validation and a TLS-verified bounded shell
request corrected the probe. That local tooling error is not a deployed outage.
No raw request, SQL text, user record or credential was retained in this summary.

A subsequent narrowly filtered supported lookup returned **13 pool log
entries**, no truncation and no next page. Their reported windows include a
**30,100 ms** acquisition maximum, a **25,417 ms** event-loop-delay maximum and
up to **20** waiting acquisitions. These are per-window observations, not a
fleet-wide percentile or a universal failure rate.

Unlike the separate replica query, the application-owned capacity snapshot at
**15:29:53.181 UTC** explicitly verifies the **primary**, with complete state
visibility: **450** configured connection slots, **7** client backends,
**0** active/lock waiters and **439** estimated ordinary slots remaining.
Its process pool was max **10**, total **5**, idle **2**, waiting **0**, bound to
published source `2da695…`. This supersedes the claim that no primary observation
was accessible; it does not prove primary conditions during a different peak.

The supported phase query completed both pages: **38 phase events** (25 + 13),
no truncation or remaining cursor. A read-only SRE review independently repeated
the phase search with the exact serving revision filter and confirmed the
current and prior windows. In the selected window, outbox scope-list had **7
connection-timeout acquisitions** (max **30,100 ms**, overrun **29,200 ms**);
status-aggregate had **6 checkout-timeout acquisitions** (max **6,601 ms**,
overrun **5,701 ms); duplicate-group-scan had **1 checkout timeout** (max
**3,400 ms); and successful post-checkout work reached **5,859 ms**. The
preceding same-revision eight-minute window already had outbox connection
timeouts up to **35,900 ms** and status-aggregate checkout timeouts up to
**9,100 ms**. It was not worse in the selected window. Post-checkout elapsed
time is not pure SQL time; a timeout does not measure exact TCP/TLS setup.
Telemetry is sampled. The initiating cause and any link to a specific phone
sync/recovery remain unproven because no incident request timestamp or trace is
available. No larger pool, deadline, retry or concurrency setting was
introduced.

Both windows had five requests, no returned 5xx/error-metric points, and zero
error-severity log entries. Request-latency p95 was **365.54 ms** current versus
**402.10 ms** prior; CPU/memory p95 were **2.92%/12.6%** versus **2.9%/11.95%**.
Empty metric series mean no reported points, not zero. Neither build changed
during the windows: the serving revision was created October 30, as was its
predecessor. This gives no evidence that a deployment introduced the sampled
delays. The prior window already had the same symptom, so this capture confirms
recurrence, not that the current build caused it.

The bounded numeric capture, exact query/window/page boundaries and limitations
are retained in
[`reliability-closure-supported-production-observations.json`](reliability-closure-supported-production-observations.json).
Raw messages, SQL, host/process identities, user records and credentials were
not copied into that evidence file.

### Saved-copy test instrumentation — initial bootstrap boundary

The preserved saved-copy scenario failed its final API-cancellation guard.
Its trace places the three reported `/api/me`, QC badge and cursor cancellations
in the initial document/bootstrap period, before the first explicit reload;
they must not be described as reload failures or proof that removal failed.
The test already declared bounded navigation windows for its two reloads but
omitted the equivalent initial-navigation window.

The initial window now starts before `goto`, closes after Start becomes enabled,
and closes **before** the first run action. Existing request-identity matching,
the two cancellation-code checks, HTTP/access-control assertions and cross-origin
guards remain unchanged. This is fixture instrumentation, not an application
sync/removal repair or proof of the cancellation initiator.

A new native source-order contract reproduced the missing boundary (**1 FAIL**,
2.29 s), then passed **1/1**, 2.07 s. An earlier setup-only attempt rejected a
non-file source URL; package-root filesystem resolution corrected it. The
configured client compiler subsequently passed, exit **0**. Evidence is retained
at `artifacts/run-calculator/generated-artifacts/manager-bootstrap-contract.yAqkmx/`.
These checks do not relabel the original saved-copy browser case as passed.

### Continued startup repair — concurrent Corepack shim publication

Read-only workflow status inspection found both managed development API and
web workflows failed before app startup. Their bounded output reported ENOENT
while removing the workspace pnpm/pnpx launchers during Corepack enablement.
These are development-startup observations, not evidence of a production
outage, database failure or the cause of historical Agent stalls.

The existing selector invoked Corepack enablement directly against one shared
shim directory. A deterministic two-launcher fixture reproduced the same
read/unlink/create ENOENT. The repair prepares each invocation's launchers in
an owned private staging directory, validates executable targets, resolves
relative links before relocation and publishes each launcher by atomic
same-filesystem rename. Failed preparation leaves the previous launcher
untouched and fails closed. Private staging is cleaned on completion. There
is no service-lifetime lock, added runtime dependency, pin change, signature
bypass, registry-policy change or automatic cache-retention rollout.

Verification:

- The initial regression reproduced the shared-directory ENOENT. Its
  dangling-link failure scenario also exposed a fixture-isolation mistake:
  a missing test shim could fall through to the host manager and attempt a
  native download before the bounded child exited. The fixture now has an
  explicit fallback-denial executable, private HOME/XDG/pnpm/cache paths,
  networking disabled and an allowlisted child environment. This was a test
  harness fault, not evidence of an app data write; no API or database was
  started by the fixture.
- The coherent focused runtime selection passed **7/7**, covering concurrent
  launchers, failed preparation, dangling targets, post-merge phase handling,
  direct/nested pinned calls and unsafe cache rejection. After the fixture
  environment was tightened, its affected **4/4** cases passed again; unchanged
  cases were not repeated.
- The existing runtime-cache integrity/fail-closed suite passed **9/9**.
  Bash syntax, native module syntax and whitespace checks passed.
- Two concurrent **real Corepack** preparations passed in a disposable
  workspace with networking disabled. Both pnpm/pnpx links were executable,
  absolute after relocation and parseable by the pinned Node. No manager,
  app or database was executed, and no staging directories remained.
  Sanitized retained output:
  `artifacts/run-calculator/generated-artifacts/startup-shim-followup.Yyfh20/real-corepack.log`.

The regressions are registered by the existing runtime test entry point, not
an unconnected test file. This batch changes startup selection and its test
support only; the passing client assertion/runtime result above was not
invalidated or repeated.

Managed workflows were **not restarted**: API startup may run maintenance
against shared development data, which this task must preserve. Workflow
recovery and an app-level offline handoff therefore remain unverified. The
clean-start checker was inspected but not invoked directly because it
inherits its caller's database configuration; it does not itself provision
a disposable database. Any subsequent app-level startup check must retain the
approved isolated-database wrapper. The owning task remains **IN PROGRESS**.

### Focused PWA recovery follow-up — 3/3 runtime passes

The remaining production-fixture correction affects service-worker activation,
unsaved-work protection and stale-chunk recovery. Its earlier native checks
cannot establish these browser behaviors. A narrow follow-up is therefore
limited to the three previously failed Chromium flows; it is not another broad
browser pass or a repetition of passing journeys.

The dedicated PWA configuration serves its own two-version static fixture and
has no database/API global setup. Read-only discovery matched all three exact
identities from the original broad collection, with no collection errors:

- `68653885c13ad33062c9-5525da1780bb477027cf`: preserves unsafe work, then
  auto-reloads after safe inactivity.
- `68653885c13ad33062c9-01e6d02deb28827ea8f0`: auto-reloads when Home was already
  safe before update discovery.
- `68653885c13ad33062c9-58ccbb40d396d96bf2ad`: recovers an old HTML-served Home
  chunk onto the current build once.

Private attempt directory:
`artifacts/run-calculator/generated-artifacts/pwa-recovery-followup.rH8XAZ/`.
The preserved collection and reviewed identity list remain discovery evidence.
Execution uses the existing Chromium PWA configuration, its unchanged 120-second
per-case timeout, zero retries and one worker. No assertion, timeout, inventory
or cache/update policy is being relaxed. Application and test inputs remain
unchanged during this follow-up.

The execution finished with exit 0: **3 expected passes, 0 unexpected failures,
0 skipped and 0 flaky**, in **64.35 seconds**. Each runtime identity matched
the reviewed three-case list. `results.json` and `command.log` in the same
private directory preserve the outcome. This closes those three historical
Chromium update/chunk-recovery failures, not the entire browser lane, other PWA
variants, physical devices or a published-site check. No API/database, managed
workflow, customer source or provider send was used.

The file-target check of this task plan and ledger examined 49 distinct local
references: 48 exist and one is the already-documented historical ignored
build-identity archive, unavailable in this workspace. This confirms no new
source-path defect in that bounded set; it is not prose, symbol, remote URL or
heading-anchor certification. The artifact was not fabricated or replaced.
The private raw path report is retained beside the startup-shim result.

The complementary startup-guard selection then passed **8/8** in **3.761 s**,
excluding the already-passing focused selection. This covers the remaining
runtime-entry-point guards without repeating the seven passing focused
assertions. The separate retained-cache contract guards remain **9/9 PASS**.
Private log: `artifacts/run-calculator/generated-artifacts/startup-shim-followup.Yyfh20/complementary-runtime-guards.log`.
These are launcher/contract checks, not managed-service recovery or a release
certification; no managed API/web restart was performed.

### Run Insights fixture follow-up — reload preservation, not a browser pass

Source review ruled out a missing button type in the Run Insights actions:
the shared native Button already defaults to `type="button"`. No component
button or application reload policy was changed.

The fixture's `addInitScript` callback did contain an independent defect: every
document initialization rewrote the synthetic day with `resetAt: 0` and cleared
its saved run values. Playwright also invokes the callback in child frames.
The callback is now a closure-free test-only helper, scoped to the top-level
document and initialized once per owned scenario/session. Completion is recorded
only after all required storage writes succeed. Canonical state and saved run
bytes survive subsequent callback execution. Initial fixture values, role grants,
assertions, case names, retry policy and browser budgets are unchanged.

The native serialized-callback regression first reproduced both failures
(reload overwrote acknowledged bytes; a child frame wrote three local keys):
**4 PASS / 2 FAIL**. After the repair it passed **6/6** in **11.10 s**, including
fresh and distinct scenarios, a fresh independent session, and initialization
failure followed by storage recovery. These are VM/JSDOM checks, not six browser
journeys or evidence that the old execution-context failures are fully explained.

The configured client compiler subsequently completed with **exit 0**. Earlier
setup attempts are preserved: the release-wrapper launch timed out before
Vitest started; an artifact-local compiler-path probe found no compiler; and
an initial short workspace-compiler diagnostic ended without a result. The
installed Vitest entry and correct workspace compiler were used directly under
the unchanged pinned Node version. No source runtime/test limits, dependency
versions or compiler flags were relaxed. Evidence, including the before/after
logs, final compiler output and exact three-input hashes:
`artifacts/run-calculator/generated-artifacts/run-insights-seed-followup.mPGXQ8/`.

The original two failed Run Insights browser outcomes remain **unverified**;
no additional browser run, shared-data operation or managed restart was used
at that checkpoint. The later completion continuation above supersedes this
runtime gap: both fixed flows subsequently passed **2/2**, with the original
failure artifacts preserved.

The separate no-install diagnostic reported the running Node matches the source
pin; its `networkUsed` and `discoveredToolsExecuted` fields are both false.
A parent/child-shell version probe also retained the same pinned Node. Source
inspection shows the release command dispatcher provisions pinned pnpm through
private `npm exec` acquisition rather than executing the selected global shim.
That distinguishes its pre-test setup from the managed-service shim race.
The exact duration/cause of the interrupted acquisition is not established;
no cache/trust policy was changed and no test failure is inferred from it.

### Phone calendar follow-up — first-of-month fixture assumption

The preserved failed phone-layout trace identifies `toBeDisabled` on
`button[data-day][disabled]` as the failed assertion. Its captured calendar
starts on Sunday, November 1, 2026, with no earlier displayed dates. The real
Schedule control disables dates before today; it does not promise that the
currently displayed month contains one. This is an attributed fixture
assumption, not evidence that the app enabled a prohibited date.

The phone fixture now visits the previous month before checking disabled dates,
then restores the selected month before the existing selection and dialog
reachability checks. It retains the disabled-date assertion, selection checks,
case identity, retry policy and browser time limits. No application date rule,
production component or visual baseline changed.

The real Calendar component's native file passed **7/7** in **17.30 s**
(three existing checks and four added regressions). The new coverage demonstrates
the no-disabled-button boundary and verifies past-date rejection, restored
selection and an enabled next-date selection across the Sunday month boundary,
an ordinary mid-month date and a year boundary. It uses the actual component,
not a mocked calendar. This is **not** a reverified phone touch/overlay journey.

Evidence and the two changed-input hashes are retained beside the Run Insights
follow-up as `calendar-after.log` and `calendar-input.sha256`. The final combined
client budget/compiler result is recorded separately in `client-final-checks.log`:
**PASS / exit 0**, with the cast budget unchanged. Both edited browser files also
passed syntax transformation in `changed-browser-syntax.log`. These checks do
not constitute semantic E2E certification or a passing integrated browser run.

**Current boundary:** these two fixture repair batches are locally checked, but
the owning task remains **IN_PROGRESS**. Final integrated confirmation is not
available: the original main attempt failed/interrupted, the managed API and web
workflows are failed, and restarting the shared API can run data heals outside
this task's synthetic-only boundary. No shared-service restart or fresh broad
browser pass was used as a workaround. The remaining lifecycle/stock/history,
break/report/notification journeys and unattributed runtime groups stay open;
native passing results do not close them or authorize task completion.

### Offline startup diagnostic — fixture corrected, cold version handoff passes

The earlier retained archive/manifest are absent from the current API build
output, and no retained copy was found in this task's generated-artifact tree.
That is not proof of a production fault: the retained-tool option is still
opt-in and ordinary build outputs can be replaced. The original 35-second
timeout remains a recorded observation with an unattributed cause.

A different diagnostic approach provisioned only the already-approved exact
signed tool artifact in a disposable project copy, not the real API output.
It preserves source Node/manager pins and normal checksum/signature verification.
No build/publish policy, default launcher option or application source changes.
The copied input-file hashes are recorded with the diagnostic report.

The current command lookup is file-based, so an inherited pnpm/Corepack shell
function was not established as the cause. Namespace preflight confirmed
same-UID, loopback-only networking isolation. The `ip` utility is absent; the
existing Python socket/ioctl interface brought up only that private loopback.
No system package or kernel/host setting was changed.

Private diagnostic directory:
`artifacts/run-calculator/generated-artifacts/offline-tool-trace.2TFOcC/`.
After validated cache-only restoration, the protocol traced the native version
command outside a project. Only if it succeeds does it trace the retained
project launcher. Each probe retains the unchanged exploratory 35-second
deadline and stops at the failing boundary; it is not an app startup test.
Child environments contain no application credentials, host-manager fallback
is denied, and traced processes have no external network route. No API,
database, operational account, provider request or managed service is started.

Initial outcomes without the omitted source lockfile (the JSON phase results,
not the controller's exit code):

- Signed artifact provisioning **PASS**: pnpm 12.8.1, Node 24.21.0, existing
  trusted Corepack 0.36.0, Linux x64. No tool or source pin was changed.
- Verified cache-only restoration **PASS**.
- Native version command outside a project **PASS**, correct exact pin, no
  connect calls in its trace.
- Retained project launcher **FAIL**, exit **124** at the unchanged **35-second**
  deadline. It restored the cache and executed the native child, which invoked
  `node --version` and attempted DNS connections; six were unreachable in the
  isolated namespace. It did not fall back to the host manager or start the app.

This initially narrowed the failure to project-aware native initialization after
successful restoration. Upstream's [package-manager pin documentation](https://pnpm.io/package_json#devenginespackagemanager)
explains that pnpm 12 records its legacy pin resolution in a leading lockfile
bootstrap document. Inspection confirmed that the real source has that document,
but the disposable copy omitted the entire lockfile.

Only that failed handoff was confirmed after adding the unchanged source
`pnpm-lock.yaml` to the same disposable workspace. The existing signed archive
was reused; no manager upgrade, engine-policy change, relaxed verification or
new timeout was used:

- **PASS**, exact pinned version, exit **0**, **10.645 s / unchanged 35 s**.
- Source lockfile and fixture lockfile both remained byte-for-byte unchanged.
- Trace showed **0 AF_INET/AF_INET6 connect calls**, no unreachable calls and
  only two local **AF_UNIX** socket attempts. OS networking remained isolated.
- Confirmation: `artifacts/run-calculator/generated-artifacts/offline-tool-trace.2TFOcC/with-source-lockfile.json`.
  Its added-input hash binds the omitted-lockfile correction to the baseline.

The missing lockfile caused this disposable fixture's version-handoff stall.
This does not retrospectively certify every old probe, establish a production
or sync/database cause, or prove actual application startup. Offline application
startup remains **NOT RUN**; retained tools remain opt-in and not enabled by
default. Private input hashes, verified artifact metadata, per-phase JSON,
bounded stdout/stderr and syscall traces remain retained above.

A regression first demonstrated that missing/symlinked root lockfiles reached
the verifier instead of stopping early. The optional retained-tools launcher now
rejects those inputs with actionable guidance before any restoration/bootstrap.
The focused guard check passed **4/4** (missing, symlink, regular-file delegation
and the parent check). The regular-file case intentionally delegates to a
stopping verifier stub; it is not an archive/app-start certification. Default
launcher behavior and archive verification are unchanged. Bash syntax,
ShellCheck and whitespace checks passed for this change. The earlier real
cold-version pass is bound to its recorded pre-guard wrapper input; the new
positive-delegation check covers the added early guard without repeating the
unchanged archive extraction and manager execution.

Follow-on harness inspection did not start another suite. The existing isolated
browser wrapper provisions its owned Postgres instance but unconditionally ends
in Playwright execution; it has no app-start-only mode. The plain clean-start
checker does not provision its own database and must not be pointed at shared
development data. The approved startup item calls for a verified **tool**
handoff, not a new full-app-offline certification gate. That distinction is
preserved: the tool-version result cannot establish application health or close
the remaining integrated operational journeys. No extra startup-only feature
was added merely to expand this item.

Current source-boundary checkpoint: synthetic local coverage is implemented.
The actual preparation/snapshot regression file passed 23/23, including the two
new eligibility checks, and the root workspace typecheck passed. The focused
browser attempt remains one pass/three failures; its identified fixture cause
was corrected and checked at the preparation layer, not replayed in a browser.
The wider task and its unresolved app-wide browser evidence remain open.

## Resumed objective — reconnect and Gold fixture contracts

The next bounded repair batch addresses seven retained browser failures, not a
new complete-suite attempt. Three facility-reconnect fixtures now capture the
server's current write epoch for newly created commands, count only validated
canonical replies as acknowledgments, and examine the two intended queue keys
without discarding unrelated bootstrap work. The original command/generation,
independent-setting result, final durable totals and other-account byte
preservation assertions remain. Unbound legacy commands are not upgraded by
application code.

Three Gold retention/reminder mocks now carry the required 64-hex snapshot
revision, changing it after a simulated verification changes the register.
The approval-error fixture holds its synthetic outage until the explicit Retry
action instead of allowing a background remount/refetch to clear the error
before the assertion. Production permissions, retention consistency checks,
retry policy and source approval rules are unchanged.

Focused source checks passed: 49 factory-queue/write-epoch tests and 41 Gold
API/component/reminder tests. Syntax checks for the three edited browser files
and `git diff --check` passed. These are not new browser passes.

The narrow reconnect follow-up passed **3/3**, with no unexpected, flaky or
skipped cases (85.9 seconds). It used disposable loopback services/PostgreSQL;
private output is under
`artifacts/run-calculator/generated-artifacts/facility-reconnect-followup.moyOqq/`.
It establishes those cross-process write-fence/acknowledgment journeys only.

The premade-crust fixture also needed its own canonical day: its old first-Start
failure showed an already-running line before this test had started a run.
Its bespoke setup additionally overwrote the global test manager role with
eight capabilities. It now uses the established authorized-fixture lifecycle,
owned account/role, complete empty day on the browser-local date, tracked
profile cleanup and a fail-closed loopback API origin. It does not remove
production permission checks or change operational crust selection.
The narrowly scoped follow-up passed **1/1** (2.5 minutes), including started-run
mode preservation. Private output is under
`artifacts/run-calculator/generated-artifacts/premade-isolation-followup.E1MtVg/`.
The browser syntax validator passed for 71 files; no inventory cases were added,
removed or renamed.

Gold's four corrected fixture paths have not received a new browser pass.
The two historical recipe-refresh failures also remain unclosed. Their saved
synthetic traces have acknowledged master-data writes and differing run-value
snapshots; those observations do not yet identify a current application defect
or distinguish late reads from conflicting writes/profile propagation.
Trace members must be ordered by event timing, not ZIP member names, before
inferring a reversal. No operational math or conflict guard was changed on
this evidence alone.

Do not repeat the 187 previously passing full-run flows or represent these
four focused browser passes as complete-suite certification. The owning task,
remaining integrated journeys, physical-device gaps and publication-bound
evidence requirements remain open. No publish, production/shared-development
database mutation or managed workflow restart occurred.

### Default-manager fixture drift found during the same audit

Eight remaining browser fixtures copied the obsolete eight-capability manager
baseline instead of using `DEFAULT_MANAGER_CAPABILITIES`. Those copies are now
replaced in audit export, critical workflows, management performance, manager
queue, phone layout, photo count, profile reload and sync convergence fixtures.
The scan also checked copies with extra capabilities, not just eight-element
arrays. No additional copies of that baseline were found in the spec set.

The existing pre-database browser preflight now rejects both default-role
declarations and inline built-in-manager SQL assignments that copy the old
baseline, including copies with additional permissions. It continues to allow
canonical defaults, explicit filtered restrictions, empty-capability revocation
and owned custom-role assignments. This is fixture hygiene, not a production
permission grant or an authorization bypass.

The focused validator unit file passed **13/13**, including the real preflight
entry-point check; the complete 71-file preflight also passed. Combined with
the earlier focused runs, 103 focused native tests passed in this resumed work.
This is not a new complete-client-suite result, nor runtime certification of
the eight changed browser fixtures.

An initial validator launch timed out after 60 seconds without output and
established no test result. The shell selected Node 24.22.1 while the installed
required runtime was 24.21.0. Selecting that installed runtime on PATH let the
unchanged guarded release runner execute successfully (13 tests in 11 seconds).
No engine constraint, runner lock, network/TLS guard or tool acquisition policy
was weakened. This observation does not establish the cause of older platform
Agent stalls or merge-lock incidents.

### Manager workflow follow-up

The four previously failing `manager-attention.spec.ts` journeys passed
**4/4** on the recorded candidate, with zero skipped, flaky or unexpected cases
and no top-level runner errors (91.17 seconds). They cover keyboard incident
review/resolution, keyboard workflow navigation/focus, badge/destination
transitions and setup with incomplete recipe names. Private results are under
`artifacts/run-calculator/generated-artifacts/manager-attention-followup.ocFcFl/`.
This brings the focused browser follow-ups in this resumed work to eight
passing journeys, not a complete-suite pass.

The old keyboard trace was not used to rewrite current application behavior:
the present fixture already accounts for new incidents starting expanded, and
the current runtime follow-up passed. The other historical manager failures
also did not reproduce in this follow-up.

The calculator's declared typecheck was attempted with the pinned runtime.
Its three config-loader unit tests, real Vite config loading, library build
prerequisites and reviewed `as any` budget checks passed. The final app compiler
phase produced no diagnostic before the shell's 120-second limit; the typecheck
is **INCOMPLETE**, not green and not a confirmed source error. Do not repeat
those completed prerequisites merely to retry the interrupted compiler phase.

The interrupted compiler phase was then run directly with the same pinned
runtime and `tsc -p tsconfig.json --noEmit`; it completed with exit 0 and no
diagnostics. The calculator package's completed prerequisite checks plus this
compiler result establish the scoped typecheck. They are not a new root
workspace typecheck or a complete release check.

### Historical client runtime failure — current follow-up passed

The declared client test command was attempted once after the focused fixes.
The duration/worker contract, reviewed-cast checks and startup/boundary
prerequisites ran before Vitest. The outer command hit its unchanged
300-second shell limit before Vitest completed. Its last captured progress was
**226 of 396 files passed, 2,720 passing tests observed, 251.99 seconds elapsed**.
Those partial counts do not establish a complete assertion result. The
observed Vitest elapsed time already exceeds the existing **150-second**
wall-clock budget, so no current complete-suite or runtime-budget pass is
claimed.

The existing runner still uses isolated worker threads, file-level
parallelism, a four-worker default/ceiling and the same duration contract.
No worker count, budget, assertion or inventory was relaxed. Completed-file
timings alone cannot attribute the excess to test execution versus environment,
module-import, worker-startup or runner contention costs. The earlier 143.5s
result remains historical, not certification of this expanded attempt.

The runner previously printed capacity only in its completion summary. An
early metadata line now records runner Node version, actual requested workers,
detected capacity and configured budget before spawning Vitest, so an interrupted
attempt does not lose those facts. This adds observation only; it changes no
allocation, test or budget behavior. No further complete-suite retry was started.
That statement describes the pre-repair checkpoint; the single post-repair
client check is recorded below.
The metadata change passed Node syntax validation and all **5/5** focused
duration-contract tests, including emission before spawn and visibility of an
overridden worker request. `git diff --check` also passed. These cheap controls
do not turn the incomplete expanded client run into a pass.

The owning task remains **IN PROGRESS**, with the failed full-browser attempt
and remaining local coverage gaps still open. The client-runtime failure is
superseded by the passing post-repair command recorded below, not erased.
Keep diagnosis and repairs in this task rather than generating recursive
follow-ups. No publish,
production write, shared development-data mutation or managed-workflow restart
was performed in this resumed work.

A read-only capacity observation at 2026-11-01 18:49:57 UTC, during the later
focused disposable browser run, reported pinned Node 24.21.0, eight available
logical CPUs, an eight-CPU cgroup quota, a 16-GiB memory limit and about 4.18 GiB
current cgroup memory usage. This is not a sample from the interrupted client
suite and cannot establish or exclude resource contention during that earlier
attempt. No capacity setting was changed.

## Intake

### Continued focused verification — recipe propagation

The next bounded local check selects only the two retained mix/cheese recipe
refresh-and-freeze failures. It uses synthetic accounts, disposable loopback
services/PostgreSQL and the unchanged diagnostic browser configuration. It does
not rerun the 187 previously passing full-run journeys.

An initial setup attempt was stopped before browser execution to correct a
selection expression: Playwright matches qualified test titles, so anchoring
the expression at the scenario label could select no cases. This interrupted
setup establishes no browser result. Its private output directory is
`artifacts/run-calculator/generated-artifacts/recipe-freeze-followup.1ooaBq/`.
The corrected selection removes only that leading anchor; scenario names,
assertions, inventory, retry policy and time limits are unchanged.

The corrected two-case execution completed with **1 PASS / 1 FAIL**, no skipped
or flaky cases (122.98 seconds): mix passed its edit, Start, freeze and peer
reload journey; cheese retained the old first-edit Ingredient Detail. Private
artifacts are under
`artifacts/run-calculator/generated-artifacts/recipe-freeze-followup.sq4bSL/`.
This is a current reproduction, not just an interpretation of the old trace.

The cheese trace was ordered by network timestamps across browser contexts.
The synthetic recipe write acknowledged 20 lb; linked profile writes then
alternated between 20 lb and the previous 10 lb with newly added catalog IDs.
Canonical pending-run reads briefly showed 20 lb before reverting to 10 lb.
This establishes a stale write after acknowledgment, unlike an archive-entry
ordering artifact. No credentials, raw trace or customer data are published.

The bounded repair separates ID-only recipe enrichment from operator edits in
the existing Home durable writer. At flush, ID additions rebase onto the latest
run snapshot only where the original row is unchanged. They cannot replace
newer quantities, names, row sets, existing IDs or counters, and do not rewrite
or propagate the shared profile. Actual quantity/name/identity/counter edits
retain the ordinary save path. Recipe data is not stripped from write payloads;
valid new IDs still persist through ordinary run synchronization.

Four focused native files passed **61/61** after the repair, including all six
recipe row fields, late canonical replacement, newer counters, existing-ID
conflicts, real edits and omitted arrays. The calculator compiler completed
with exit 0. An earlier optional native-check launch timed out while waiting
for the browser runner's validation lock; it established no test result and
was superseded by the completed focused command. Validation locks and runtime
limits were not bypassed.

The six-case browser follow-up completed with **5 PASS / 1 FAIL**, zero skipped
or flaky cases (210.20 seconds). Both mix and cheese passed pending-run refresh,
Start-time freeze and peer reload. Gold approval lifecycle/error/retry, the
responsive Gold panel and the QC Manager retention-only panel also passed.
Private artifacts are under
`artifacts/run-calculator/generated-artifacts/recipe-gold-repair-followup.hdZQFD/`.
This supersedes the recipe reproduction failure for these two exact journeys;
it does not recast the full-suite result or the remaining Gold case as passing.

The remaining Gold reminder fixture did not assign its synthetic manager the
built-in Manager role. Its custom role held default manager capabilities, but
retention intentionally requires both the built-in Manager/QC Manager identity
and a review capability. The trace recorded no retention request from that
identity, consistent with the current fail-closed gate. The fixture now uses the
existing isolated Manager-role assignment; no application role check was
weakened. The focused role/counting checks passed **14/14** and the edited
browser spec passed the direct pinned-Node syntax preflight. The reminder
browser journey itself remains **NOT RERUN** after that fixture correction.

The first attempted syntax command used an obsolete package-local `tsx`
launcher and failed before validation: its referenced 4.23.13 installation is
absent while 4.23.15 is present. The repository's explicitly scoped scripts
launcher is a different file, and API development already uses that launcher;
this observation is not proof that API startup is broken. Direct pinned-Node
execution of this erasable-TypeScript validator passed without installing,
changing or bypassing a dependency.

### Pure-test environment cost — bounded repair and measurements

Two unchanged pure test files spent 98% of a 9.67-second focused run in the
browser-like environment, despite using only role decisions and mocked
retention pagination/counting. Explicit Node environments kept all **14/14**
assertions and completed in **0.587 seconds**. A conservative source/import
inspection then identified ten additional Node-only source/math test files:
their unchanged **37/37** checks passed before and after the annotation,
at **13.95 seconds** and **2.01 seconds** respectively, using the same four
workers. The ingredient-catalog source guard also passed **2/2** under Node
(0.638 seconds).

These thirteen files now select Node rather than initialize an unused DOM.
No assertion, test identity, browser scenario, worker default/ceiling,
isolation setting, retry or duration limit was removed or relaxed. Actual DOM,
component, accessibility and browser verification still belongs to its
existing environments; a source-inspection assertion is not a rendered UI
test. These scoped observations address avoidable startup cost, not the
cause or complete duration of the interrupted 396-file run. At that checkpoint
the full client runtime budget remained unresolved pending its declared gate.

One post-repair invocation of the declared client command was started,
with private output in
`artifacts/run-calculator/generated-artifacts/client-runtime-followup.DRqIi9/command.log`.
Its early metadata confirms Node 24.21.0, the unchanged 150-second duration
budget, four requested workers, eight detected available CPU workers and the
four-worker ceiling. The unchanged 300-second outer bound is explicit for this
background invocation; no additional full-browser attempt was started.

A read-only sample during this actual client attempt at 19:03:03 UTC reported
an eight-CPU quota, zero reported cgroup throttling, a 16-GiB memory limit and
about 3.25 GiB current memory usage. This describes that moment, not the
historical failure; it does not exclude I/O, module-loading, worker-startup or
other contention costs. A running command or partial pass count is not a
complete suite or budget result.

That invocation completed with **exit 0**. Vitest reported **395 passed files
and one skipped file (396 total), 3,868 passed tests and one skipped test
(3,869 total)**. Its own duration was 102.33 seconds; the enclosing unchanged
duration guard measured **103.7 seconds against 150.0 seconds** and passed.
The skipped real-workbook audit existed before this batch and remains outside
the approved synthetic-local source boundary. The runner's aggregate
“396 passed files” wording includes that skipped file; this ledger preserves
the more precise Vitest statuses rather than claiming every file executed.

This establishes a current complete client assertion/budget result, not a
full-browser result, root typecheck rerun, physical-device result or release
decision. Do not rerun this passing command without an invalidating change.
No further application/test source edits were made after it started; only
this ledger was refreshed with its result.

The repaired cheese/mix journeys and four previously corrected synthetic Gold
fixtures are selected for one bounded diagnostic follow-up. Their current
browser result is pending; native checks alone do not close the reproduced
cheese failure. The incomplete complete-client runtime lane and remaining
app-wide/external evidence gaps remain open in this owning task.

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

The earlier invalid Chromium attempt remains stopped/preserved. The first
approved 240-case attempt ended with 187 passed, 43 failed, one interrupted and
nine not run; that historical result remains preserved. The latest approved
240-case run completed on test identity
`test-sha256:9f510ad9d4fc6a3f32bdd9952fd4110ec7a83c68ea9b8cf80d6b7c8cc53fd3de`
in 3,795,633 ms: 232 passed, six failed, two skipped, zero not run. It is a
complete failed run, not a passing-duration certificate.

The six failures are grouped into four investigation areas: the authenticated
QC test could not find the expected synthetic long-ingredient option after its
earlier workflow steps; all three Run Insights journeys timed out before the
refresh control became visible; the wake/reset test timed out waiting for the
peer's run to disappear after reset; and the desktop visual baseline differed
by 43,110 pixels (4%). The actual desktop capture shows the current
“Development preview” banner and explanatory notice where the stored baseline
shows “Current.” The visual test group is serial, so its phone and tablet
cases were skipped after the desktop failure. Each cause still needs focused
triage; these symptoms do not alone establish product defects. The exact
run report is `release-evidence/browser-full/FINAL-REPORT.md`. The runner
cleaned up its disposable database; no shared development or production data
was changed.

A corrected, focused diagnostic run using the dedicated non-release browser
configuration passed the exact QC case, all three Run Insights cases, and the
wake/reset convergence case (5/5 in 57.7 seconds, fresh disposable database).
This establishes that the first five full-suite failures did not reproduce in
isolation; it does not supersede the full-suite failure or establish why the
long suite produced them. A preceding attempt used the full-suite reporter with
a six-case filter; the reporter correctly rejected the selection because its
contract requires all 240 cases, then emitted unknown-case progress errors.
That invocation timed out before the sync case finished and is incomplete
diagnostic evidence only. Its stopped disposable DB was removed; the earlier
unrelated temporary directory was left untouched. Do not count the filtered
attempt as a pass or release run.
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
| Production database aggregate measurement unavailable | SUPPORTED READS RESTORED; CAUSAL ATTRIBUTION GAP | The earlier authenticated-user rejection is historical. Replica reads, a verified primary snapshot, host metrics and both pages of the sampled phase-log query succeeded. See the bounded current capture above. The ultimate stall cause and revision attribution remain unresolved; no direct-connection workaround or unsupported capacity change was made. |
| Published stalls' causal attribution | REVISION-BOUND REVIEW COMPLETE; INCIDENT LINK OPEN | Same-revision comparison confirms acquisition delays predate the selected window and were not worse in it; no build changed in either window. The selected phase samples still show 30-second acquisition delays, but no incident timestamp/trace ties them to a phone sync. Revision-filtered capacity logs returned 12 current and 13 prior records but no sync-write counters or duration distributions; this cannot establish zero writes or a failure rate. The development candidate and serving source fingerprints differ, so candidate instrumentation is not assumed live. No setting change is supported. Owner: this task; next action is one timestamped, sanitized trace of a reproducible user sync/recovery request. |
| Required local integrated verification | LATEST FULL RUN FAIL; FOCUSED DIAGNOSTICS PASS | The latest complete 240-case Chromium run passed 232, failed 6, skipped 2, and had 0 not run in 3,795,633 ms on test identity `test-sha256:9f510ad9d4fc6a3f32bdd9952fd4110ec7a83c68ea9b8cf80d6b7c8cc53fd3de`. The exact five non-visual failures then passed 5/5 in a dedicated focused diagnostic run; this does not supersede the full-suite failure and points to a suite-order/resource/fixture interaction still to investigate. The first filtered attempt used the full reporter, which enforces 240 cases; it was rejected, emitted unknown-case progress errors, and timed out before completion. Its incomplete attempt metadata is not pass evidence. Earlier 187-pass/43-failure result remains historical. No assertion/tolerance was weakened. |
| QC authenticated evidence journey | FULL-SUITE FAILURE; FOCUSED PASS; ORDERING CAUSE OPEN | At case 169, the expected synthetic long-ingredient option was absent after earlier component-check steps. The same exact case passed 1/1 (28.1 seconds) under the dedicated release-debug configuration with a fresh disposable DB. This does not erase the full-suite failure; inspect cross-test state/order and repeat in the final full suite before changing the ingredient contract. |
| Run Insights accept/dismiss/follow-up | THREE FULL-SUITE FAILURES; FOCUSED PASS 3/3 | Cases 184–186 timed out before the refresh control appeared in the full suite. All three exact journeys passed in the focused diagnostic run (7.3 seconds total). The saved full-run contexts do not establish whether suite order, query/auth state, or browser lifecycle caused the absent card. Next: validate after the desktop baseline fix in a complete run; add sequence diagnostics only if failures recur. |
| Wake reset-epoch convergence | FULL-SUITE FAILURE; FOCUSED PASS; ORDERING CAUSE OPEN | Case 218 timed out waiting for the peer's stale run to disappear after reset/wake; bounded full-run diagnostics showed reset epoch 2, a post-reset baseline acknowledgment, two epoch-2 day-state PUTs, and the test run still present locally. The exact test passed in 8.2 seconds in the dedicated diagnostic configuration. Follow `sync-invariant-check`; preserve the full-run failure and investigate if repeated. Production behavior remains unverified. |
| Desktop visual baseline and responsive visual cases | BASELINE MISMATCH; TWO CASES SKIPPED | Case 228 differs from the stored desktop snapshot by 43,110 pixels (4%). The visible difference includes the development-preview banner and explanation replacing the old “Current” status. Cases 229–230 were skipped because the test group is serial. Next: confirm banner intent/source, update the snapshot only if this change is intentional, then run phone and tablet baselines without changing tolerance. |
| Standalone diagnostic inventory | RECONCILED; REPORTER REGRESSION PASS | Owner-approved exact review established 15 additions and zero removals: 13 already-approved main cases plus focused saved-schedule and synthetic-import journeys. Updated 293-case digest retains a second fence for every original 278-case identity. Combined reporter regression exited 0 with fresh main 240 and standalone 293 collections and the original-set fence. No matcher, retry, timeout or browser assertion changed; no browser launched. See `docs/full-browser-inventory.md`. The previous failed attempt remains preserved, not relabeled. |
| Warehouse/local day-overlay queue | FOCUSED PASS; SELECTED WAREHOUSE BROWSER PASS | The staging, substitution/log and prep producers advance their synchronous local reference before the queue's acknowledged-snapshot comparison. The original nine regressions and 84 existing checks passed (93), with root typecheck. One exact, preflighted Warehouse staging/database/reload follow-up then passed 1/1 on disposable local fixtures. Other overlays are unit-verified, not browser-certified. The old main failure remains preserved. |
| Run ordering and suggested-order Undo | SOURCE REPAIR; CURRENT FOCUSED PASS | Manual/suggested ordering and Undo now queue the intended current snapshot. Forward actions preserve newer rows/values; positional moves refuse stale lists. Order-only Undo retains current fields and selection, and refuses changed membership/order, day, reset or operational scope. Final actual-source producer suite passed 27/27 with client typecheck and diff check. Earlier combined 105/root-typecheck evidence is recorded separately below. No run-order browser or physical-device pass is claimed. |
| Dough speed-change/wake fixture | CLOCK-DOMAIN ASSERTION REPAIR; RUNTIME RECHECK OPEN | The failed trace's simulated tick projected 8 trays about 159 seconds ahead of wall time; both subsequent wake GETs and the form showed 9. The test now binds adoption to that received wake projection and separately requires the simulated consumption interval to reduce batch stock. Exact one-case collection passed; this is not a browser pass or a production counter-formula repair. |
| Role/Gold API integration rerun | FOCUSED PASS | Role/import-operations rerun 268/268 and API typecheck passed. The later five-file run passed 291/292 before the final route inventory fix; that failure is preserved. |
| New active run hides eligible ended-run drain | REPAIRED; FOCUSED PASS | Explicit run identity prevents the newer active lifecycle from stealing the bounded case-only drain. Final server-claim/registration rerun: 50/50. No Sauce, applicator, or Dough cadence formula changed. |
| Two-account live-authority browser journey | TEST BASELINE/DRAIN FIXTURES REPAIRED; DESKTOP PASS; MATRIX PENDING | The initial Dough edit returned a safe 409 `section_changed` while both clients were tracking. The visible and pre-click canonical tray counts were both 40; the mismatching full-section field was not captured, so this is not classified as a product defect. The test now waits for an acknowledged Dough pause and confirms tray/batch parity on both clients before expecting acceptance; its later stale-409 check remains. The next attempt exposed an invalid drain fixture (`freezerTime=0`), so its expected panel could never be eligible. Setting the synthetic drain window to one minute made the corrected Chromium desktop journey pass 1/1 (36.8 s). Remaining viewport variants and the final full suite are still required; no app runtime code changed. |
| Missing protected Gold read inventory | REPAIRED; FOCUSED PASS | Approvals/retention use either manage-staff or manage-qc; cleanup uses manage-staff. All remain scoped and retain their existing role middleware. The mounted-router registration test passes. |
| Full API attempt | HISTORICAL FAILURE; CURRENT DISJOINT PARTITIONS PASS | The earlier 2,483-pass/16-failure attempt remains preserved. Current disposable-cluster unit and integration partitions passed 2,507 tests across 193 files, with the existing opt-in concurrency-trial skip reported separately. This is not one timed full-suite run; unchanged passing convergence evidence remains separate. |
| Current same-day published-runtime signals | CONTRIBUTING SYMPTOMS OBSERVED; ROOT CAUSE OPEN | Sanitized ten-minute serving-log rollup is appended to `reliability-closure-production-window.md`. Pool pressure, outbox timeouts and long queue snapshots occurred together; initiating workload, database execution time and sync-intent outcome remain unresolved. No capacity or retry setting changed. |
| 2026-11-02 wake/recovery and tracking report | RUN-BOUND CAUSE OPEN; DB POOL PRESSURE CONFIRMED | Sanitized read-only telemetry for 17:35–17:42Z showed pool saturation (10/10 connections in use, zero idle, 18 waiting) and a checkout timeout; a sync-outbox scope read timed out after 12.1 seconds. One `/api/sync/events` request ended after 300 seconds with HTTP 200/request aborted; a long-lived stream is not proof of cause. Only one foreground-recovery observation was recorded in this window, as success at 17:36:27Z; none were recorded at screenshot times. CPU/memory were low and no deployment changed. This does not prove the user’s run stopped tracking or correlate the pool stall to that run. Owner: this task; next action: finish the local recovery/heartbeat review and retain the incident as unconfirmed if no run-bound evidence emerges. No production writes or settings changes. |
| Later production log snapshot, 2026-11-02 18:51–18:53Z | REPEATED SERVER-SIDE PRESSURE; NO RUN CORRELATION | A read-only deployment-log refresh showed 15 and 19 pool-acquisition errors across consecutive one-minute windows, up to 18 waiting checkouts, event-loop delay up to 32.7 seconds, and outbox/queue database phases taking 34.8–42.3 seconds. The sample did not identify a run or request and did not establish a serving revision; it is a plausible contributor, not the cause of the reported tracking stop. Sanitized aggregates are in `docs/evidence/reliability-closure-production-pool-pressure-2026-11-02.json`. No production mutation. |
| Owner screenshots after run stop, 2026-11-02 12:56 CST | UI STATE OBSERVED; SERVER/HISTORY BEHAVIOR UNCONFIRMED | The mobile browser screenshots show ended runs still in a Frontline-draining state and a selected next run labeled provisional/awaiting server confirmation; another selected run shows a confirmed server baseline. The screenshots do not establish whether the state is stale or expected during drain/handoff. No run identifiers, product names, or counts were retained. Next action: compare selection, server confirmation, and drain transitions with existing lifecycle coverage and test reload/switch behavior if uncovered. The raw screenshots remain user-provided attachments and were not copied into repository evidence. |
| Owner report after attempted Resume, 2026-11-02 14:13 CST | REPEATED WAKE/RECOVERY CONTROL SYMPTOM; EVENT PATH UNKNOWN | The screenshot shows “Still recovering” and provisional server confirmation while Resume Run is visible; the owner reports tapping Resume did nothing until refresh. This repeats the wake symptom but does not establish whether the browser missed the touch, the handler intentionally rejected it, or the request failed. Next: reproduce the pending-recovery interaction locally with bounded touch/handler/request evidence; preserve the adopt-before-publish barrier and make any blocked action explicit. The raw screenshot remains a user attachment and was not copied into repository evidence. |
| Owner performance diagnostics, 2026-11-02 14:14–14:15 CST | DEVICE-SIDE TIMEOUT/CANCELLATION RECORDS; SERVER CAUSE UNPROVEN | Screenshots of the published build show one `/api/sync/today` read timing out after 35.7 seconds while the app was backgrounded, another request cancelled before a response, and a performance summary with 1,134 accumulated failures, 74 incomplete attempts, and five recent non-successes. A current-success card and server-receipt estimate are also visible. The UI warns that background suspension contributes to browser wait; the counts are historical device-side aggregates, not one incident's failures, and do not establish server processing/receipt. Next: correlate only through an authorized, privacy-safe request trace and compare the same client outcome with server logs. Raw screenshots remain attachments and were not copied into repository evidence. |
| Owner wake/recovery report and 13:09 CST screenshot pair, 2026-11-02 | TAB CONTENT/AUTO-TRACKING FAILURE REPORTED; SERVER PRESSURE COINCIDENT | The owner clarifies that tab-to-tab navigation responds, but controls inside the selected tab screens do not; timers continue advancing while auto-tracking does not. The screenshot pair keeps the recovery banner while its baseline indicator differs between “Confirmed server baseline” and “Offline — local projection”; the images do not establish tap outcomes. Logs overlap the 13:09 CST pair: pool acquisition p95 up to 6.2 seconds, 17 waiters, event-loop delay up to 7.9 seconds, three checkout timeouts, and two unavailable queue samples; the queue monitor later recovered. Local code review found wake raises a shared-sync barrier and blocks auto-tracking; selected operational-control writes are rejected while the barrier remains up, ordinary edits are retained/queued, and failed recovery intentionally keeps the safety fence. The banner is inline; profile/factory refresh is decoupled from the barrier. This can explain a subset of unavailable actions while recovery is unresolved, but does not prove device taps or request/run causality. Raw screenshots remain user-provided attachments and were not copied into repository evidence. |
| Read-only production SRE investigation, 2026-11-02 | ROOT CAUSE INCONCLUSIVE; SERVING BUILD BOUNDARY CONFIRMED | Current serving Autoscale build `app-build:934ed015-7a94-4db0-a558-0fdbad559c27` (revision `42763954-0c35-47c4-8b4b-6ea38c26deb1`) was created 2026-10-30 15:38:15Z; no build occurred in the incident windows and local diagnostics are not deployed. Aggregate metrics show six `/api/sync/today` requests and two error-free auto-track claims in 18:59–19:04Z; no claim appeared in the returned endpoint list for 19:06–19:11Z. These aggregates cannot identify the affected browser/run and only weakly argue against a claim storm. The 04:17–04:21Z job failures are not contemporaneous; sparse provider CPU/memory data do not indicate host-wide saturation. SRE finds pool contention/event-loop delay the strongest measured contributor but cannot establish causality; client/browser resume remains plausible. Smallest next diagnostic: one controlled synchronized wake with privacy-safe client outcomes, ephemeral correlation token, request statuses/durations, and per-instance pool/event-loop/worker events. No production changes or publication. |
| Web-workflow duplicate start, 2026-11-02 19:05Z | EXISTING APP HEALTHY; WORKFLOW START ATTEMPT FAILED | The workflow log reported port 26038 already in use. Process inspection found the existing run-calculator Vite process, and the Replit development domain answered HTTP 200. This is a duplicate-start conflict, not evidence of an application outage. Do not restart while the full browser runner may share the service; after the runner exits, restart once only if the workflow status still needs recovery. |
| Final-candidate browser rerun before diagnostic repair | INTERRUPTED; NO ASSERTION FAILURE REPORTED | The unchanged 240-case run passed 21 cases and began case 22 before it was stopped to address the confirmed absence of a local event for an in-progress wake recovery. This partial run is not a pass; it reports no completed failing assertion. Owner: this task; next action: focused-verify the bounded local diagnostic, then rerun the complete inventory under the existing limits. |
| Final-source Chromium browser inventory after diagnostic repair | IN PROGRESS; 103/240 PASSED AT CHECKPOINT | Cases 1–103 passed so far, including the five-run lifecycle; case 104 is running and no failures have been reported at this checkpoint. The wake-recovery interaction cases remain pending. The run is not complete and must not be described as a pass until all 240 cases finish. |
| In-progress wake-recovery diagnostics | REPAIRED LOCALLY; FOCUSED PASS; FULL RUN PENDING | Each attempt now writes a bounded local in-progress record and immediately updates the activity list; terminal recovery records use a separate `recovery` category so a snapshot pull is not shown as a write acknowledgment or failed write. Legacy wake events are normalized on read. No run ID, production payload, or server write is added. Focused tests passed 30/30 and root typecheck passed; owner: this task; next action: complete the approved 240-case browser run and reconcile its exact result. |
| Owner policy choices | RECORDED; DELIVERY STILL OWNED HERE | Packaging factual status only; approval-expiry reminders seven days before expiry; verified offline runtime-tool handoff approved for isolated testing. These decisions do not authorize publication, provider sends, real-source Gold, or production trials. |
| Current test:client workflow | PASS; ONE EXISTING SKIP | Latest configured workflow completed 397 client test files (3,879 tests passed; one existing workbook-source test skipped), in 83.4 seconds against its 150-second budget. The separate full-browser and release-evidence gates remain unresolved. |
| Isolated API sync-convergence test | PASS | The dedicated local disposable-Postgres runner completed successfully in 56.7 seconds. It unsets inherited database connection variables and starts its own local test database; no shared development or production database was used. This confirms the tested synthetic convergence flow, not physical wake behavior. |
| Current release:standard workflow | BLOCKED / NO-GO; NO GATES RUN | The standard release runner stopped because matching published release evidence is missing. It did not run release gates. This is an evidence prerequisite, not a code-test failure. Owner: release owner after local closure; do not publish early or fabricate a matching identity. |
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
- Phone operational calendar: the disabled-date expectation is now attributed
  to the captured first-of-month fixture assumption and repaired with seven
  native component checks above. Its full phone journey remains unverified.
- The premade-crust Start fixture received its own canonical day/full-manager
  isolation repair and its focused follow-up passed **1/1**, as recorded above.
  That does not close the separate calendar or remaining lifecycle journeys.
- Prior-run drain and daily allergen-report unexpected retention 403s. Client
  retention gating is repaired; neither full journey is yet reverified.
- Three PWA update/chunk recovery cases are now reverified **3/3** in the focused
  follow-up above. Two Run Insights cases with destroyed execution contexts
  subsequently passed **2/2**, as recorded in the completion continuation.
  Their independent six-check native fixture reproduction remains separate
  evidence. No app reload safeguard was weakened.
- The mix/cheese pending-refresh, Start-time freeze and peer-reload cases
  subsequently passed **2/2**, as recorded in the recipe/Gold follow-up.
  The initial failed full-run outcomes remain preserved; the focused pass does
  not certify every shared-recipe variant or replace the full-run result.
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
that native CLI stall remained unattributed at that checkpoint; no app or
database was started by these probes. No further retry was launched at that
checkpoint. The later differential investigation recorded above corrected an
omitted source lockfile in its disposable copy and passed the version-only
handoff under the same deadline. Actual offline application startup is still
not established by either checkpoint.

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
The later focused follow-up above then executed all three exact historical
Chromium identities successfully; its runtime result supersedes this checkpoint's
open status for those cases only.

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

### 2026-11-02 — pre-full-suite checkpoint

Milestone 4, integrated verification, remains in progress. Since the preceding
checkpoint, six database-independent package suites passed: production rules
17/17, inventory math 96/96, spec reconciliation 33/33, scheduled-recipe checks
19/19, spec export 51/51, and corpus harness 12/12 (228 total).

The four approved synthetic importer journeys also passed their browser
assertions in Chromium against the isolated local database. The filtered command
was intentionally not a release-suite run: the default release reporter rejected
four discovered cases against its exact 240-case contract and its secondary
attempt tracker could not checkpoint three cases after that rejected
initialization. The four test assertions themselves passed; this invocation is
not complete-suite evidence and did not change the reviewed inventory. The
synthetic fixture and the existing 240-identity contract were left unchanged.

The corrected reference audit checked 702 in-scope Markdown files. No local
Markdown file targets were missing. In the six current research/progress
documents, the only stale code path was corrected to the actual spec-import
implementation and test. A wider scan still reports unresolved references in
archived plans and historical evidence; those were not treated as live-code
defects or bulk-rewritten. The scan did not validate every prose claim or remote
link.

Next: run the approved complete 240-case Chromium lane with its unchanged
identity, timeout, retry, worker and duration guards, using the isolated browser
runner and disposable database. Preserve all failures and interruption status.
The focused filtered run above cannot substitute for it. No shared development
or production database was used; production publication and physical-device
evidence remain separate owner-controlled boundaries.

### 2026-11-02 — production pool-pressure follow-up

The read-only deployment investigation found credible, recurring short-lived
database-pool contention on the currently serving successful Autoscale build.
Across 02:32–02:36 UTC, two adjacent capacity windows each recorded 23 pool
acquisition errors; the second reached the configured ten-connection maximum,
with queued checkouts and event-loop delay up to 27.2 seconds. A queue-monitor
database timeout was followed by readiness recovery, then another timeout before
a sampled acquisition returned to 99 ms. No build occurred in the incident
window.

This is evidence of transient pool pressure, not a proven initiating cause or
request-level impact. Provider metrics returned only two readiness requests and
cannot establish user impact or exclude unobserved load. The later capacity
sample showed ample database-wide slots, which does not rule out the earlier
transient contention. No pool-size, infrastructure, production-data, or
deployment changes were made.

Evidence: `docs/evidence/reliability-closure-production-pool-pressure-2026-11-02.json`.
Next diagnostic owner: engineering/operations to correlate database-side query
and connection waits with per-instance pool acquisition and event-loop samples
for this UTC window before considering configuration changes.

### 2026-11-02 — Dough wake check and interrupted browser startup

The focused “speed adjustment during a dough run stays aligned across screen
wake” browser journey passed **1/1 in 34.5 s** on the disposable local runtime.
The earlier failure came from a test assertion that treated saved run values and
the initial seed as live tracking authority. The check now compares the Dough
form with the current server operational projection and allows the server-owned
run to advance while the device is hidden. This focused pass establishes UI
convergence for this case only; it is not a full browser result or physical
device evidence.

The first complete-suite invocation supplied a descriptive string as
`RELEASE_BROWSER_ATTEMPT_ID`; the runner requires a UUID and a corresponding
startup manifest. Its reporter rejected the identifier, although Playwright
continued: accessibility cases 1–3 passed and case 4 (`accessibility-smoke`
authenticated-controls journey) had started when the process was stopped. This
partial, untracked attempt is not suite evidence. For the approved full run,
leave the variable unset so the isolated runner creates and records its own
UUID; preserve the same 240-case inventory and all existing budgets.

### 2026-11-02 — pre-rerun repairs and local gates

The preceding complete Chromium attempt is preserved as a failed baseline, not
as a passing certification: test fingerprint
`test-sha256:44a16709dedb4ea28592316aa31d1e341ea3254c010453496dc9775a9f6388d7`,
240 cases, 233 passed, 6 failed, 1 skipped, 0 not run, and 3,703,259 ms
(61m 43s). The six failures were in incident-review reload selection, three
Run Insights setup-navigation waits, sync no-op/reset convergence assertions,
and the phone visual baseline.

Focused repairs did not weaken product assertions. The issue-review test now
anchors to the stable incident identity and rechecks its correlation reference
after reload. Run Insights waits for the Setup view instead of a conditional
card. The sync test replays the accepted canonical document and accepts the
documented unchanged-write response shape; the reset assertion remains strict,
with bounded diagnostics attached on failure. The reset case passed alone and
in a later grouped 5/5 run after one earlier grouped intermittent failure.

The phone screenshot mismatch was caused by a 28-pixel scroll offset after
Playwright scrolled the page to a control. Phone and tablet captures now reset
and verify scroll position before comparison. The reviewed current UI keeps
“Warehouse” on one line by design; only that phone baseline was refreshed. The
complete visual set then passed 3/3, including tablet portrait and landscape.

The root workspace typecheck passed, including recovery-audit contracts and
generated API checks. The isolated clean-start smoke also passed API readiness,
web and sign-in fallbacks, API proxy, Vite reconnect behavior, browser console
checks, and the mockup server. The focused reference audit found no issues across
142 local Markdown links and 98 standalone code-path references in the three
current task/research documents.

Still required: rerun the unchanged full 240-case Chromium inventory, run the
WebKit smoke lane, and retain their exact outcomes. These local checks do not
certify deployed behavior; no publish, production write, or shared development
database change was made.

### 2026-11-02 — WebKit smoke and production pool-pressure follow-up

The isolated WebKit smoke lane passed **3/3 in 1m 18s**. It is a bounded
compatibility signal, not a substitute for the Chromium inventory or real
Safari/iOS-device verification.

A read-only SRE follow-up confirmed another short-lived pool-pressure episode
on the same successful serving build. Per-process telemetry recorded 23
acquisition errors from 04:18:25–04:19:26 UTC, followed by 16 errors from
04:19:26–04:20:31 UTC; the later window reached 5.7-second acquisition waits
and nine queued checkouts. Event-loop delay coincided, queue-monitor database
timeouts recurred, and web-push enqueue logged database timeouts. Readiness
returned success but reported a background-worker warning; the scheduled-queue
sample was unavailable and showed five failed terminal jobs in its last window.

Provider telemetry returned only three requests, all readiness probes, with no
observed 5xx points; the instance-count series was inconsistent. This confirms
recurring process-local pool contention, but does not establish that it caused
the October degraded periods or any user-request failure, nor identify what
initiated the pressure. The next useful evidence is primary-database wait/query
telemetry, per-instance pool/event-loop samples, request outcomes, and details
for those five terminal jobs during 04:17–04:21 UTC. No production changes or
publish occurred. Sanitized evidence is in
`docs/evidence/reliability-closure-production-pool-pressure-2026-11-02.json`.

Still required: rerun the unchanged full 240-case Chromium inventory, then
reconcile its exact outcome with the review contract. Physical-device behavior,
published-site behavior, and database-side causes remain outside what these
local tests can prove.

### 2026-11-02 — owner-reported downtime timing

The owner reports they have not noticed downtime during active app use; the
interruptions they have noticed occur while the app is idle or unused. This is
user-observed timing context, not proof that active requests never fail or that
background work caused the interruptions.

The read-only SRE follow-up found temporal overlap with background/database
degradation around all three reported windows. The Oct 16 02:23Z window
included pool waits up to 26.3 seconds, event-loop delay up to 22.2 seconds,
outbox/queue activity, a failed server-job claim, and a daily-rollover failure.
The Oct 20 16:15Z window had pool waits up to 18.1 seconds, 20 queued checkouts,
repeated queue timeouts, failed push enqueues/server jobs, and a later
background-worker readiness warning. The Oct 20 19:59Z window similarly
overlapped pool waits up to 26.9 seconds, outbox/push/job failures, repeated
queue timeouts, and worker warnings.

This supports the owner's idle-timing observation, but does not prove those
background failures caused the reported interruptions. Endpoint metrics
contained only 5–6 readiness probes per window; zero observed 5xx points do not
establish user-request success. An Oct 21 exact-window search returned no
records while the Nov 2 unrevision-filtered searches found samples within
five-minute windows; that historical query discrepancy remains unresolved.
The highest-value next diagnostic is a synchronized, instance-correlated
capture of primary-database waits, pool/event-loop timing, request outcomes,
and terminal-job failure details. A read-only production-replica query has now
found two distinct failed `scheduled-evaluation` jobs completed from
04:17–04:21Z, with six total attempt receipts: one job had three
`handler_failed` attempts; the other had one `lease_expired` attempt followed
by two `handler_failed` attempts. A bounded classifier returned only category
labels: two attempt messages contained push-delivery terms, four were
unclassified, and none matched the database/lock/timeout token set. Raw error
messages, actor IDs, payloads, and results were not retrieved. The queue-health
sample reported five terminal failures; a read-only replica query matching its
five-minute interval found three failed and one cancelled job. The exact
04:17–04:21Z query found two distinct failed jobs. This leaves a
readiness-versus-replica count discrepancy, even after aligning the time
window. The evidence narrows the window but still does not prove a cause. No
production changes or publish occurred.

Source review found that scheduled-evaluation jobs have three attempts, a
60-second handler timeout, a 30-second default lease, and default worker
concurrency two. For each date, the handler wraps alert evaluation in the
protected commit boundary; that operation performs database work and serial
external push sends before returning. This can hold a job-row transaction and
lock during those operations, so it is a plausible pool-pressure contributor.
It is not a confirmed cause: send failures are caught by delivery handling,
while the persisted `handler_failed` code does not identify the uncaught
failure. A synthetic slow-send test with pool/lease timing is the next safe
validation before changing this boundary.

### 2026-11-02 — documentation references and current browser run

A bounded documentation audit covered 18 current task, research, and evidence
Markdown files. All **163 local Markdown links** resolve. All **176
repository-rooted path references** resolve or are explicitly classified as
historical evidence locations unavailable in the current workspace; there are
no unexplained missing references. The audit does not validate remote URLs,
symbol semantics, or every document in the repository.

The review corrected a stale task-plan pointer and clarified that the Gold
approval screenshots and one sanitized staging report were recorded at the
time but are not available in the current workspace. Their absence is retained
as an evidence limitation; no replacement artifacts were fabricated.
`git diff --check` passed after these documentation corrections.

The approved 240-case Chromium inventory completed at 2026-11-02 05:26 UTC:
**236 passed, 4 failed, 0 skipped, 0 not run** in **3,676,241 ms**
(about 1h 1m 16s). Result: **FAIL**, test fingerprint
`test-sha256:74cf30a7ffa476739c0d6eeddc8c5b4330468bfad5901a734bee19188a462f3e`.
The failures were the Run Insights accept, dismiss, and follow-up journeys,
plus the Warehouse staging-check journey.

Run Insights diagnosis found that its local browser-only run was replaced by
the server's canonical unnamed run during sign-in. The fixture now seeds the
same synthetic current run into the isolated server snapshot and browser
storage. The accept, dismiss, and follow-up browser cases then passed **3/3**
in **56.7 s** through the disposable-database runner. This focused result does
not change the full-run FAIL status or replace the required full rerun.

The full-suite Warehouse test failed at the uncheck assertion: the button
remained pressed after the click. The same test then passed **1/1** in **18.3 s**
through the isolated runner, so the failure was not reproduced. The test now
captures bounded request/response metadata if the failure recurs. The current
client merge is additive for checked rows, while the UI exposes a reversible
toggle; an older project note describes whole-map replacement. The intended
cross-device uncheck contract remains unclear, so no Warehouse runtime behavior
has changed pending the owner's decision. A new 240-case rerun is being
recorded separately; the earlier full-run result remains FAIL.

### 2026-11-02 — revision-bound production connection-pressure window

A read-only SRE review scoped logs and aggregate telemetry to serving build
`42763954-0c35-47c4-8b4b-6ea38c26deb1` (successful build created 2026-10-30
15:38 UTC). No deployment occurred during the sampled window. Structured
`INFO`/`WARN` events—not `ERROR` severity—showed background-job dependency
connection failures and sync-outbox scope-list database-connection retries.
The adjacent ~61-second windows had 39 acquisition errors before, 44 during,
6 immediately after, and 18 in the next window. Acquisition p95/p99 were
5.4s/9.4s before, 6.5s/9.6s during, and 0.62s/4.9s immediately after. The
event-loop p95 was already elevated before the window and did not increase
during it.

Readiness succeeded in 245ms with database `ok` and `backgroundWorkers=warning`;
the reported sync-outbox lag was zero. Endpoint metrics had only two successful
readiness samples and no 4xx/5xx in the interval, with no adjacent user-route
samples. Therefore these records support **intermittent database-connection
acquisition pressure as a proximate mechanism** (moderate confidence), but do
not establish an operator-facing outage or identify whether the underlying
source is the database service, application pool, network, or runtime. No
production setting or retry policy was changed. The best remaining
measurement—time-aligned database-side session/connection-failure metrics at
one-minute resolution—is not available in this capture; production impact and
root cause remain open.

An incremental read-only review confirmed the same serving build through
13:50–13:52 UTC. That window added 17 acquisition errors in about 60 seconds
(p95 4.1s, p99 6.2s, max 7.6s; pool total reached 10; wait p99 13), acquisition
timeouts in scheduled-evaluation status and outbox scope-list work, and
6.3–6.7s post-checkout durations for other database-path operations. Readiness
again succeeded (109ms; database `ok`, `backgroundWorkers=warning`); sync-outbox
lag remained zero and its latest drain succeeded. This raises confidence to
moderate-high in recurring database-path pressure, but does not separate
database-service, application-pool, and runtime causes or prove user-facing
impact. No new build was published in these windows; a deployment regression
is not supported by the sampled timeline. The next useful evidence remains
time-aligned database-side session, connection-failure, wait, and query/lock
latency telemetry.

### 2026-11-02 — crust-run phase timing and wake responsiveness investigation

Source review confirmed that all runs previously used the same Press/Oven +
Frontline split. Crust runs now bypass Press/Oven in the shared timing
calculation; missing Frontline timing allocates the old combined pre-tunnel
window to Frontline. This mode is passed through the client fallback, server
operational projections, ended-run drain calculation, and Line Map display.
The Line Map now labels Press/Oven as bypassed and omits its dough-specific
case/pair metrics for crust runs. Dough timing and stored setup values are
unchanged. The OpenAPI `linePhasesVersion` enum and generated clients now include
version 3. No database schema or production change was made.

Focused evidence:

- **PASS**: `@workspace/live-calc` canonical projection and run-view tests,
  22 tests.
- **PASS**: `@workspace/api-server` server auto-track tick tests, 43 tests.
- **PASS**: `@workspace/run-calculator` selected line-phase, Line Map,
  lifecycle, wake-snapshot, foreground-recovery, and screen-sync tests: 7 files,
  156 tests.
- **PASS**: API generated-contract check and root workspace typecheck. The first
  typecheck caught the old provenance-version union; the OpenAPI source was
  updated, generated clients refreshed through Orval, and the rerun passed.
- **PASS**: the web and API workflows restarted; the API reported startup
  readiness success. A 402×874 development-preview capture rendered the signed-
  out sign-in screen. Its 401 auth requests are expected for the unauthenticated
  preview browser; the signed-in Line Map was not visually verified.

The reported wake-time unresponsiveness is not yet reproduced. Source review
found no page-wide recovery overlay, `inert` state, or recovery-scoped
`pointer-events:none`; `ForegroundRecoveryStatus` is an in-flow status banner.
Recovery does raise a synchronous barrier before fetching and reconciliation.
That barrier intentionally blocks sync-dependent writes; Pause and Resume
handlers return without visible feedback while it is active, while Start is
deferred. This can explain some ignored actions, but not a whole page that
cannot accept touch input.

Two owner-supplied failures from 2026-11-02 are now matched to production field
check observations by exact timestamp, device category, build, and measured
duration. At 08:58:48 America/Chicago (14:58:48.970Z), mobile Chrome recorded
an authentication request timeout at 8,608 ms while backgrounded; it was
received by the server 339 ms later. At 09:26:51 (15:26:51.521Z), the same
device/build recorded a network transport failure during another app request
at 1,480,032 ms (about 24.7 minutes), also while backgrounded; it was received
1.149 seconds later. The screenshot's incident references do not equal the
field-check observation IDs, so this is timestamp/build/category correlation,
not a request-ID join.

Read-only production runtime review found an `incident_captured` log for the
first authentication timeout at 14:58:49.366Z and its diagnostic POST was
accepted in 210 ms. `/api/me` had succeeded shortly before, and the 14:58
capacity sample was near-normal (pool acquisition p95/p99 16/36 ms; event-loop
p95/p99 21/25 ms). There had been earlier intermittent pressure: 29 database
acquisition errors in 14:52–14:54 (p95 7.4 s; event-loop p95 5.1 s) and 23 more
in 14:54–14:55 (p99 8.6 s, max 12.6 s). This is not a matching server trace for
the authentication request.

For the second failure, the closest server-side signal was a scheduled-queue
monitor database checkout timeout at 15:26:03.882Z, after a 3.4 s acquisition.
The preceding two one-minute windows contained 30 and 16 pool acquisition
errors; event-loop p99 reached 3.2 s and p95 2.7 s. Readiness checks succeeded
but reported `backgroundWorkers` as warning. Immediately after the client
failure, production recorded foreground-recovery success, then an incomplete
sync cancellation, followed by successful startup, reload-persistence, sync,
and convergence observations. No server log identifies the exact failed
request; endpoint metrics showed no relevant 5xx, and deployment metric queries
were unavailable. Later capacity samples improved. These signals support
intermittent server database/runtime pressure as a possible contributor, not
as a proven cause of either client failure.

Both observations used app build `934ed015-7a94-4db0-a558-0fdbad559c27`, which
matches the latest successful deployment build listed for October 30; no new
deployment build was created during the incident window. Production has
performance check version 4 observations through November 2, but no version 5
long-task/slow-interaction observations in the checked period. The new
responsiveness probes therefore still need a later publish before they can add
live evidence. A read-only aggregate showed 1,802 observations retained over 30
days and 276 received in the previous 24 hours. Report queries and visible
cards are bounded; current volume does not by itself explain a page-wide freeze.

Added browser-supported `PerformanceObserver` measurements for long tasks and
slow interaction events above 250 ms. They retain only duration and fixed
source codes, are capped at ten samples per page, and never record input values,
event targets, selectors, or page content. Unsupported browser APIs simply
produce no observation. These measurements are not available from the current
published build until an owner-authorized publish; none was performed here.

Focused verification after this addition: the run-calculator field-check and
auto-track wake tests passed (33 tests), API field-check validation passed
(13 tests), the API field-check route integration passed (20 tests), API
generated-contract checks passed, and root workspace typecheck passed.
Physical Android touch behavior remains unverified. The incident now has
production timestamp/build/diagnostic correlation, but its root cause remains
**UNCONFIRMED**; no wake/recovery behavior or production configuration was
changed.

### QC import-review badge navigation

The count-only Import QC badge is now a keyboard-accessible button. Tapping it
switches to QC/Quality and opens the existing Import review section for users
with both QC workflow access and QC review permission. Other users receive an
access-required message; the badge still exposes counts only. The badge event
and the QC section opening are covered by focused component tests. Root
typecheck passed. A signed-in browser screenshot check was not possible in the
unauthenticated preview, so the complete Home-to-review journey remains
unverified in an authenticated browser.

### 2026-11-02 — browser inventory preflight and interrupted attempt

An initial isolated full-suite attempt was stopped after 17 cases passed and the
18th began. It is an interrupted attempt, not complete-suite evidence; the
partial browser artifacts were retained and its disposable database was stopped
and removed. The stop was procedural, not a test failure.

Before retrying, a no-server Playwright listing was compared by exact
project/file/title identity with the owner-approved contract. It found 240 cases
in 57 files, with zero additions, removals, or duplicates. This matches the
approved Nov. 1 inventory and the Nov. 2 inventory record in
`docs/full-browser-inventory.md`; no browser tests ran during collection.

The existing QC import-review reload/badge browser case now starts from Run,
clicks the global badge, and requires the Import review section to open. This
extends one approved identity without adding or removing a case. Its focused
isolated browser check passed in Chromium and WebKit (2/2); the authenticated
Home-to-review browser journey is now verified, though the signed-in preview
still cannot be captured by the unauthenticated screenshot browser. The
workflow's historical `browser-full-159` label does not describe the currently
approved 240-case inventory; the actual isolated runner and exact contract are
used here. The complete 240-case Chromium rerun remains pending.

### 2026-11-02 — active-run recovery and tracking stall report

The owner supplied screenshots at 11:38:03, 11:38:44, and 11:38:56
America/Chicago (17:38:03Z, 17:38:44Z, and 17:38:56Z). They show an active
run with the app still reporting that it is checking current production state;
the Packaging view shows Auto while a separate view reports the line about 13
minutes behind with no stoppage logged. These are browser-observed states, not
proof that auto-tracking was progressing. Product identity and production
quantities are intentionally omitted from this record.

Read-only production field-check records in 17:35–17:42Z contain one
`foreground-recovery` success at 17:36:27.075Z from mobile Chrome on app build
`934ed015…`; there is no field-check observation at the screenshot times. The
live aggregate issue table, last updated at 17:17:48Z, still had the
performance issue open while production-run-save-sync and sync-acknowledgment
were marked recovered. Those aggregate states are not run- or device-bound.
The success record therefore cannot establish that this run's visible recovery
barrier was released.

The SRE correlation confirms database-pool stalls in the surrounding period:
at 17:33:52Z the sample showed all 10 pool connections occupied, 18 waiting
requests, and `pool_checkout_timeout`; at 17:36:28Z the sync-outbox scope-list
read timed out after 12.1 seconds. At 17:41:58Z the queue monitor could not
sample status because of a database timeout. One `/api/sync/events` request
ended at 17:41:30Z after 300 seconds with status 200 and `request aborted`;
the 17:35–17:42 endpoint sample had one such request, zero 4xx/5xx for that
route, and 166.9 seconds average duration. This is evidence of an unusually
long open stream, not proof it caused the tracking stop. Overall traffic in
that window had no measured 5xx; readiness and server auto-track health checks
succeeded, but they do not attest this user's run state. CPU and memory were
low, one instance was reported, and no deployment build occurred in the
window. No error-severity runtime log identifies the request or the affected
run.

The leading confirmed condition is database-pool contention; its causal link
to this run's recovery banner and stopped tracking remains **UNCONFIRMED**.
The client recovery code intentionally keeps auto-tracking fenced until it
adopts a canonical response, so a recovery that is pending or failed can leave
tracking paused. A source review of `/api/sync/events` found that each new
stream reads the canonical day and reset state for its initial frame and again
for registration reconciliation. The established stream's default 15-second
heartbeat reads the day and reset state again; active-run calculation ticks
also read station-activity rows through a shared one-second cache. That cache
does not coalesce concurrent same-key misses, and the per-stream interval
callbacks have no explicit in-flight guard. If these reads are slow or many
streams resume together, overlapping queries could amplify pool demand. This
is a source-level risk, not evidence that SSE caused the observed production
stalls or the phone's unresponsive controls. No runtime behavior or production
configuration was changed.

The bounded next experiment is an isolated delayed-query test with concurrent
same-key stream reads and slow heartbeat/calc work. Measure loader calls, pool
wait and lease timing; preserve canonical/reset fencing and station-activity
freshness. Do not change heartbeat cadence, stale-evidence behavior, or
production settings without that measurement.

A later read-only snapshot of published deployment logs covered 19:29:56–19:32:00Z.
Two adjacent one-minute windows each had 35 pool acquisition errors, waits up to
8.5 seconds, and up to 18 waiters; event-loop delay reached 5.4 seconds. The
queue monitor timed out, outbox reads were slow, and two production background
jobs failed with dependency-connection after about 13 seconds. SRE confirmed
these are published-production logs, not output from the local API workflow.
This establishes a later recurrence, not continuous pressure between the
reported wake windows or causality for the unresponsive phone controls. The
snapshot has no request, run, or device correlation and no independently
confirmed serving-revision identity.

The exact-window endpoint metric check returned no rows for sync/today,
sync/events, or auto-track/claim; missing rows cannot be interpreted as zero
requests or successful requests. In the nearest minute-aligned window, only
`/__ready` was returned (3 requests; p95 481 ms; no 4xx/5xx). Thus the later
pool-pressure sample has no direct sync-route status or latency evidence.

The approved 240-case Chromium run is in progress. Visible failure markers are
case 169 (`QC operator and manager complete scoped evidence workflows in
authenticated browsers`), cases 184–186 in the Run Insights
accept/dismiss/follow-up flow, case 218 (`wake enforces reset epoch and
client-date scope while unchanged writes stay no-op`), and case 228 (desktop
visual-regression baseline). Cases 187–217 and 219–227 passed, including remote
Stop adoption, Packaging correction through wake/reload, retry visibility
after a failed correction, a manual correction winning over stale automation,
foreground recovery, retry after network recovery, stale-base conflict
handling, tab restart, premade-crust persistence, and date-scoped
sync-diagnostic downloads. Phone/tablet visual cases 229–230 were skipped; the
reason remains unconfirmed. Cases 231–237 passed, including cross-device
Warehouse staging, phone/tablet guidance, tab navigation, and synthetic-
workbook review/cancel; case 238 is running. Exact assertions and sanitized
artifacts for the six failures remain to be inspected after the suite. These
automated Chromium checks do not establish physical Android wake/touch
behavior.

The isolated-browser latency test ran on loopback with 0/40ms injected request
delay and no bandwidth cap. Six edit samples acknowledged in 296–385ms and
reached the peer in 320–414ms; the 40ms-delay samples measured 340–346ms for
acknowledgement and 353–368ms for peer adoption. Four wake samples took
140–191ms, including a simulated 503/retry; timed-out pulls were zero. All
recorded peer PUTs returned 200 unchanged, though the run also recorded one
failed pull. These measurements are synthetic and cannot estimate production
mobile latency or OS-suspended-device behavior.

### 2026-11-02 — later successful wake/pause observation

At about 13:41 America/Chicago (19:41Z), the owner reports that after waking
the phone, tapping Pause appeared to work. The screenshot shows the UI labels
“Latest production snapshot received,” “Confirmed server baseline,” and
“Resume Run,” but also shows a warning that unsaved edits are not confirmed by
the refresh. This is a single owner-reported successful control attempt, not a
controlled reproduction or a server acknowledgment trace; it does not identify
which edits are pending. Build identity is unknown from the screenshot, and it
does not establish subsequent auto-tracking progress or resolve the earlier
intermittent failures.

Read-only SRE telemetry for 19:40–19:43Z returned 10 `/api/sync/today`
requests (p95 1.75s) and seven `/api/sync/auto-track/claim` requests (p95
1.975s), with no observed 4xx/5xx for either route; successful 2xx counts were
not exposed. One `/api/sync/events` request averaged 36.529s, which may be a
normal long-lived stream. The 78 published-log entries had no warning/error
entries; 13 acquisition-duration samples were 0–977ms, four pool readings
showed 5–9 connections, 0–2 idle, and zero waiters; numeric event-loop delay
was unavailable. This is lower sampled pressure than the severe 19:29–19:32Z
window, not proof of recovery. No request/run/device correlation exists, so
the metrics cannot attribute the calls to the owner or prove the edits were
acknowledged.

### 2026-11-02 — idle and peer-wake follow-up

The owner reports that the app works while foregrounded but remains impaired
after background/idle time, including on non-production days. The owner also
reports that when one app remains foregrounded and another wakes, the first
app can develop similar symptoms after the waking app settles. Reported
symptoms include tab navigation responding while controls inside tabs do not,
timers continuing, and auto-tracking stopping. These are owner observations,
not a controlled physical-device reproduction and not proof of a cross-client
write or server fault.

Source review confirmed that browser request diagnostics mark a request when
the document was hidden during its lifetime and measure elapsed wall-clock
time, which can include OS/browser suspension. Field-check totals are scoped
to the current facility and check. Each failure or incomplete observation
increments its stored counter; a later success updates the recovery status but
does not reset those counters. Individual observation rows are retention-
limited, while the counters persist. Therefore the displayed totals are
accumulated history, not a daily count, run count, or device-only count. The
UI now says “Accumulated totals (not daily)” and directs managers to the recent
non-successes list. Focused component and lifecycle tests passed 45/45.

The existing two-session browser journey was extended with an online wake
while a second client remains active. It holds the waking client’s canonical
read, exercises Pause on the foreground client, then checks the waking client
adopts that state and the foreground client remains usable. The first browser
attempt failed before execution because the prepared build identity was stale.
After preparing a fresh local identity, a later attempt exposed a synthetic
clock mismatch: the peer advanced beyond the canonical server time. The test
now advances the foreground client, waking peer, and isolated server to the
same retry timestamp. That corrected case passed 1/1 in 26.9 seconds; it is
emulated-browser evidence only.

The paired Packaging journey now explicitly clicks Resume after the manual
correction, waits for the exact `resume-packaging` response, wakes the same
client, and checks the correction plus the next accepted case through reload.
Its first isolated attempt received HTTP 200 but stopped at a test assertion
that incorrectly required `manualOverrideUntil` to equal zero. The existing
API contract permits an expired timestamp at or before server time. The test
now asserts the server/client expiry boundary rather than exact zero and
filters for the exact Resume operation. The corrected run passed 1/1 (30.1
seconds overall; 15.6 seconds for the case) on an isolated disposable
database. It verified the correction through wake, one accepted post-wake
case, and reload persistence. The failed assertion attempt did not reach the
wake/case checks. These are local synthetic Chromium results, not physical
device or published-app proof. No production write, deployment restart, or
publish was performed.

### 2026-11-02 — responsive visual baseline closure

The first post-update desktop comparison failed again because the screenshot
was taken below the page's update toolbar. The page scroll was not reset after
the run-control interaction; that mismatch covered 99,241 pixels (9%), rather
than showing that the toolbar itself was intermittent. The desktop case now
resets scroll before capture. Desktop and phone also wait for the confirmed
“Synchronized” state so screenshots cannot preserve a transient sync warning;
the tablet case already had that assertion.

After comparing the actual images with their stored baselines, the reviewed
updates cover `live-run-desktop`, `mix-plan-desktop`, `import-review-desktop`,
`compact-run-tablet`, `run-overview-phone`, and tablet portrait/landscape. The
phone baseline had captured an old red sync indicator, while the current
canonical run is synchronized. The tablet and phone layouts also show a
consistent current header-spacing difference from their older captures. No
separate product defect was established by those image differences. The
earlier 43,110-pixel (4%) desktop difference remains a historical result; its
preliminary attribution to a “Development preview” notice is unconfirmed.

The focused normal visual suite passed **3/3** in 36.6 seconds: desktop live
run/Mix Plan/import review, phone run view, and tablet portrait/landscape. It
ran in Chromium against a fresh disposable database. The visual file now
compares normally against the reviewed baselines. This does not replace the
integrated 240-case run or demonstrate physical Android/iOS wake behavior.
No shared development or production data was changed.

The suite inventory is now reconciled at 241 identities. Next milestone: run
the integrated suite against the exact 241-case contract, then classify its
results. Production publication and physical-device evidence remain outside
this local verification lane.

### 2026-11-02 — new owner observations and browser-inventory preflight

The owner-provided Chrome screenshot, shown as captured at about 4:23 PM
America/Chicago on November 2, displays the Sync conflict monitor with 7
conflicts today (19 Run-value fields and 2 Run-list fields) and the note that
fields were kept from a safer merged state. A separate visible Data health
panel marks “Canonical sync self-check” as **Failing**; its text says the check
is read-only and did not repair anything. The displayed peer-update telemetry
reports 1 partial frame and 0 complete frames over a 41-second window. The
specific failed invariant is below the visible portion and is not identified
by this capture. Screenshot environment and build identity are unknown; these
images prove only the visible state, not a server request or a persistent
repair. Run identifiers were not retained in this summary.

A separate phone notification at about 4:16 PM says “Restart Agent to
continue.” That is a workspace-agent interruption, not evidence of an app
failure. No user data was removed or changed.

Later deployment-log telemetry, around 22:41–22:43 UTC, shows another
production database-pressure interval: a one-minute sample recorded 34 pool
acquisition errors, p95 acquisition 11.4 seconds, up to 18 waiters, and event
loop delay up to 4.7 seconds. The following sample recorded 18 acquisition
errors, p95 2.3 seconds, and event-loop delay up to 3.2 seconds. During the
same later interval the log recorded sync-outbox retry events, one unavailable
queue-monitor sample, a web-push scheduling failure, and a daily-rollover
failure. This is a later recurrence, roughly 18 minutes after the screenshot;
the logs do not identify the screenshot's request, device, run, or build, so
they do not establish its cause. No production change was made.

The client test workflow completed against the current workspace: 398 files,
3,900 tests passed, 0 failed, and 1 intentionally skipped (87.1 seconds).
This is unit/component evidence, not full browser coverage.

The attempted integrated browser rerun started a disposable PostgreSQL
instance and built the local test server, but Playwright discovered 241 cases
against the reviewed 240-case contract. The release reporter rejected the
inventory and subsequent per-case callbacks emitted “Unknown browser attempt
case.” Three accessibility tests printed pass before the fourth started; the
run was stopped and is incomplete, not a pass. No final report was produced,
and the isolated database is no longer present. The earlier report remains
untouched.

An initial direct Playwright `--list` command then failed while importing
fixture modules because it bypassed the isolated runner and lacked
`PLAYWRIGHT_API_BASE_URL`; it listed zero tests and executed none. The
documented isolated `--list` path subsequently discovered 241 unique cases.
The first comparison parser expected a different path format and returned zero;
re-parsing the saved listing in Playwright's actual format produced an exact
241/241 identity match after the contract update. There were no missing or
duplicate cases, and list mode executed no browser tests. The disposable
database was cleaned. The `release:standard` workflow separately stopped
before running any release gate because published release evidence is missing;
it is not evidence of a product failure or a local-test result. No publish was
initiated.
