# Packaging tracking recovery

Environment: isolated task workspace; fixture data only. Production has not been
modified. Operator screenshots are private source evidence and are not copied here.

## Scope and ownership

The implementing agent owns correction, hold expiry, canonical Resume, client
adoption, and the integrated four-station/lifecycle regressions. Broader
Frontline/update recovery remains with its existing owner; no duplicate task or
implementation is intended. No user decision is expected.

Approved approach: extend the existing section command with an explicit,
generation-bound Packaging Resume operation. Do not send another correction,
trust a device deadline, restart a run, or restore browser automatic writes.
Preserve the correction pair and generation, serialize against the canonical
row, and rebase only case bookkeeping. Ordinary expiry must use the same
no-held-time-replay policy.

## Failure ledger

| Finding | Evidence | Status / next action |
|---|---|---|
| Resume manufactures another manual correction, renewing the server hold | Station Resume calls onManual with local now; manual-section assigns serverTime + 60 seconds | FIXED; canonical/API and valid-fixture browser acknowledgement PASS |
| Worker builds case claims during the hold; validator rejects them, preventing persistence of the wall-clock bookkeeping for the whole beat | buildWallClockServerClaims passed caseSuppressed false; server tick persisted bookkeeping only when all wall claims accepted | FIXED; case-only rebasing, automatic expiry, exact next case, and unrelated channels PASS in canonical tests |
| Indefinite expiry failure | Operator report; original indefinite incident not independently reproduced | Historical cause MISSING; canonical expiry/down/up/duplicate/generation regressions PASS; real server-scheduled recovery PASS in all eight browser projects. Existing sync recovery owner retains historical correlation using bounded diagnostics, not a speculative data heal |
| All-station stoppage and Start/Stop requiring refresh then second click | Operator report; Packaging correction is only a preceding event | Four-station canonical continuity PASS; single-click pause/resume and peer/reload convergence PASS in all eight browser projects; lifecycle/new-run fences PASS in canonical/client tests. Original production sequence MISSING; existing sync recovery owner retains broader diagnosis |
| Operational-intent validation rejection | One reported HTTP 400 SYNC_VALIDATION_FAILED; incident and performance card refer to the same request | Historical rejected field MISSING; bounded reason/stage logging added; malformed/rejected retention regression PASS. Existing sync recovery owner can correlate future occurrences with allowlisted request/stage/build diagnostics; unchanged terminal requests are not replayed |
| Authentication timeout and sync timeout across hidden/visible boundary | Reported elapsed browser lifetimes 8,882 ms and 10,472 ms; server duration unknown | Hidden-timeout/visible retry and explicit 401 retention PASS in controlled client tests; offline/reconnect acknowledgement PASS in all eight browser projects. Real OS suspension/auth incident reproduction NOT RUN: physical-device service unavailable. Existing sync recovery owner retains historical diagnosis; no server-duration claim |

The operator cards name a mobile Chrome build but do not establish that every
incident ran that build. No payloads, identities, cookies, or credentials are
retained in this report.

### Production diagnostic boundary

Read-only deployment discovery succeeded, but both current-serving and
revision-scoped runtime-log queries reported that no deployment was available.
Metrics discovery was also unavailable. These are **BLOCKED** diagnostic reads,
not evidence that production was healthy. No request payloads were collected.
The current public bundle's build identity differed from the reported screenshot
build. Device timezone is unknown, so a deployment near the device-time card
cannot be identified as the affected deployment.

The historical validation request therefore remains **MISSING** a server-side
field/stage correlation. The repair adds allowlisted validation-stage logging
with request reference and sealed build identity (or explicit `unknown`), never
raw fields, operational values, account information or request bodies.
Clock-window rejection, malformed inventory lines, lifecycle shape, revision,
identity/envelope, correction values, production date and command envelope are
distinguished. An unchanged terminal 400 is not automatically replayed.
Broader historical wake/auth/update diagnosis remains with the existing sync
recovery owner; this report does not assert a common cause.

The workflow log refresh later exposed a current-serving runtime-log window
(starting at approximately 20:58 UTC), but not the reported historical incident
window. None of the supplied safe incident/request references appeared in that
window. This does not reverse the earlier unavailable revision-scoped reads or
establish the rejected historical field. Diagnostics include the server-generated
correlation reference used by the response header, not just the worker's local
request sequence.

### Implementation and fixture failure history

- Replaced the old station-local Resume/correction shortcut with a durable
  section control bound to lifecycle and correction generation. The server
  retains counts/generation and only shortens the hold. Duplicate identities
  cannot be rebound to a different run/generation or correction.
- Held case events are no longer generated and rejected on every worker beat.
  The worker records the correction/deadline it applied, rebases only its case
  arm through the hold, and waits a full valid case interval after recovery.
  Dough and net-second station claims retain their own cadence.
- Client adoption now accepts a shorter canonical hold deadline. Resume receipts
  must contain coherent canonical counters/progress and an ended hold (unless a
  newer correction has since superseded the request). Resume adoption never
  forces its earlier counts over a newer correction.
- The existing station wrapper dropped the complete pre-edit baseline passed by
  rapid stepper actions; forwarding it preserves serialized correction intent.
- Initial scheduler assertions expected a held claim to be rejected and guessed
  a 1.2-second case interval. The fixture actually runs at 400 ppm, making the
  interval 1.8 seconds; held claims should now be absent. Updated assertions also
  compare unrelated tray scheduling with the unsuppressed reference, rather than
  incorrectly expecting its due timestamp not to advance.
- A new paused-tunnel test initially assumed no physical post-tunnel drain
  immediately after pausing. It now observes the stopped tunnel after that
  existing bounded drain clears; production pause policy was not changed.
- Initial integrated fixtures omitted press-speed inputs and used an unmapped
  sauce. Added valid speed and disposable BBQ inventory so all required channels
  are genuinely eligible. The fixture also twice assumed an API response
  envelope; the canonical GET returns its snapshot directly. Corrected the
  assertion after reading the actual route contract.
- Initial client typecheck found nullable Resume-state access; corrected it.
  These are retained fixture/check failures, not production root-cause claims.
- The initial browser matrix failed peer adoption in all four Chromium
  viewports. A targeted diagnostic confirmed an awake peer with an open stream
  and no pending commands, but no local Packaging register. Investigation found
  missing required `brand` and `flavor` strings in the seeded test metadata.
  The client correctly rejects that incomplete snapshot; the fixture was
  corrected without relaxing the canonical contract. These failures are not
  evidence of the operator's production cause.
- Tracing that failure exposed a separate shared receive-path defect: a valid
  partial frame was reconstructed/applied, then the raw sparse frame was applied
  again and retained as the next baseline. Common adoption now receives the
  reconstructed full document once, preserving snapshot validation and stamps.
  The same correction/Resume browser flow is the bounded regression for this
  subtle fix; no new broad test pass or independent repair task was created.
- Resume retry tests initially expected terminal 400/409 commands to be
  resubmitted. The existing outbox correctly refuses that; tests now assert
  retention without unchanged replay, and the station asks for reviewed counts
  and a new correction instead of describing validation as connectivity.
- The first valid-fixture browser wait allowed only 25 seconds for a case.
  The production worker beats every 15 seconds and must rearm before the next
  valid 12-second case cadence. A later exact-value poll over 45 seconds observed
  subsequent legitimate case beats and failed after missing the short-lived
  first value; this did not establish held-time replay. The corrected test waits
  for the first transition, immediately asserts exactly one added case and a
  valid elapsed cadence, then pauses canonically before reload assertions.
- Two desktop attempts failed while clicking a transient tunnel-policy prompt
  whose countdown detached its button. The test now checks the actual canonical
  pause acknowledgement without depending on that optional prompt. Another
  attempt read Packaging controls while the Run tab was mounted; explicit tab
  transitions fixed the test. These were test-interaction failures, not evidence
  that an accepted pause or Packaging recovery failed.
- The final isolated browser matrix passed all eight projects, with no retries,
  in 6.8 minutes. Each project used two independent browser contexts and proved
  correction adoption without refresh, an offline Resume that did not falsely
  acknowledge, reconnect/retry, canonical Resume preserving the correction
  generation, one first scheduled case, pause acknowledgement, reload persistence,
  and one accepted run-resume click. Synthetic fixtures and their database were
  cleaned up. This does not reproduce a real mobile OS suspension.

## Required validation matrix

Canonical/API: downward/upward correction, successive corrections, expiry,
Resume before/after expiry, duplicate and stale Resume, pending correction,
scope/reset/lifecycle fences, peer contention, pause with tunnel stopped versus
physical drain, ended drain, new run, and exact one next accepted case beat.
Unrelated Dough, Sauce, and Frontline must continue.

Client: acknowledged adoption, reload, second tab without refresh, selected-run
change during response, failed/offline/conflicting requests, auth and sync timeout
across hidden/visible boundaries, and single-action Stop/Start.

| Surface | Chromium emulation | WebKit emulation |
|---|---|---|
| Desktop (1440 × 900) | PASS | PASS |
| Phone (390 × 844) | PASS | PASS |
| Tablet portrait (768 × 1024) | PASS | PASS |
| Tablet landscape (1024 × 768) | PASS | PASS |

Physical Android Chrome and iOS Safari/PWA: NOT RUN (physical device service not
provided). Native applications: NOT APPLICABLE (web-only product).

## Checks

Completed checks (pinned Node 24.21.0):

- PASS: server scheduler/coordination/intent parsing unit checks, 64 tests.
- PASS: focused canonical API integration groups, 40 tests; 140 other cases
  explicitly skipped by the name filter, not claimed as passed.
- PASS: client manual-section, operational outbox, lifecycle, and sync-policy
  checks, 84 tests.
- PASS: earlier Packaging manager/progress/suppression/banner checks; their
  production math was not changed by the later busy-state or receive-path fix.
- PASS: `pnpm run check:api-generated`, including its generated Zod smoke tests.
- PASS: `pnpm --filter @workspace/api-server run typecheck:routes` after the
  final API changes. This focused check is not a full-workspace typecheck claim.
- PASS: `pnpm --filter @workspace/run-calculator run typecheck` after correcting
  nullable state access in the new run-switch busy cleanup.
- PASS: isolated `playwright.packaging-recovery.config.ts` matrix, 8 tests,
  Chromium and WebKit at all four viewports; zero retries. The earlier standalone
  Chromium desktop journey also passed before the matrix.
- PASS: `git diff --check` at the source edit checkpoints.
- BLOCKED: after the final documentation-only update, the repository check
  could not start because the workspace exhausted process/thread resources
  (`bash: fork: Resource temporarily unavailable`, then Git's `unable to create
  threaded lstat`). A single-threaded Git retry also could not fork. Earlier
  source checkpoints passed; the eight-project matrix exited successfully
  before this failure. No other task's processes were stopped. Workspace tooling
  owns resource recovery; next action is to rerun the repository check when
  process capacity is available. This is not a failed application assertion.
- Completion submission: code review PASS. The required
  `bash scripts/src/run-release-node.sh pnpm run typecheck` check FAILED with
  exit 254 before TypeScript started: the shell and release runner could not
  fork because process resources were unavailable. At that submission the task remained incomplete;
  the required gate was not bypassed. Next action: retry that configured check
  and completion submission after workspace process capacity is restored.
- Owner-requested completion retry reproduced the same exit 254 and shell/release
  runner fork failures before TypeScript started. Code review again PASS; task
  completion remained blocked at that retry. No application code, passing browser results, or
  validation requirements were changed to conceal the resource failure.

### Final retry closure

- A further automatic completion attempt reached the system pnpm launcher, but
  it recursively attempted `pnpm add pnpm@12.8.1` and aborted with
  `pthread_create: Resource temporarily unavailable` before TypeScript started.
  Code review passed. This was another launcher failure, not a type error.
- Using a temporary PATH containing the already-cached exact Node 24.21.0 and
  pnpm 12.8.1 native executable allowed the identical required command
  `bash scripts/src/run-release-node.sh pnpm run typecheck` to run. Its first
  actual execution found generated API output drift: the Packaging operation
  constant was placed differently and generated validators had whitespace drift.
  This safely actionable failure was repaired here using the canonical Orval
  generation command, without editing OpenAPI or hand-editing generated files.
  The validator source's non-whitespace digest was identical before and after.
- PASS: the full required workspace typecheck command then exited 0, including
  shell inventory, TypeScript API boundary, recovery audit, generated equality,
  all six generated-contract tests, library checks, and API server, calculator,
  mockup sandbox and scripts typechecks. The retained recovery-audit difference
  was explicitly classified intentional; it had zero missing checks.
- PASS: final source `git diff --check`. The passing eight-project browser matrix
  remains valid: this retry changed generated declaration placement/whitespace,
  not station or synchronization behavior. No browser rerun was needed.
- Full-check execution receipt: local background log
  `/tmp/replit-background-tasks/68d35c66-00fb-4a68-b8de-f33ef7f6a73d.log`,
  exit 0. The scoped tool shim was removed automatically. Global pnpm, package
  versions, lockfile, workflow configuration, trust and release-runner guards
  were not changed. The default automatic launcher's duplicate invocation still
  cannot bootstrap correctly; completion submission records that exception
  separately from the fully executed, passing required check.
- Earlier managed app startup served the sign-in page and API readiness. The
  unauthenticated screenshot showed expected 401s plus an update-failed notice;
  it was not evidence of signed-in recovery.
- BLOCKED: later managed app restarts failed before application startup while
  the system package launcher tried to bootstrap pinned pnpm 12.8.1
  (SIGABRT/package transport failure). The isolated browser runner instead used
  the already-cached exact Node 24.21.0 and pnpm 12.8.1 native executable via a
  temporary PATH shim, retaining normal version checks, release-runner locking
  and disposable-database guards. Both private test servers started and all
  browser checks passed. No global package manager or workflow configuration was
  replaced. Workspace tooling owns the managed-launch issue; next action is to
  use the available pinned runtime for that launcher, not to change tracking math.

### Managed rebase verification

- The first fetch failed before rebase. A managed retry reached conflicts in
  operational-intent diagnostics, the sync route and generated validators.
  The resolution retains main's fine-grained inventory/lifecycle validation,
  separates identity from effective-time rejection, and keeps bounded
  request/build correlation in the existing request-scoped log event.
- Canonical generation from the combined OpenAPI contract preserved incoming QC
  APIs and the Packaging Resume operation; generated output was not hand-merged.
- Marker-free merge regressions were also found: two lifecycle unit tests had
  unrelated variable substitutions, while the task-owned browser spec and
  evidence report had reverted to earlier task versions. Those fixtures and
  the full prior evidence were restored. The browser spec and configuration
  again match the previously validated source and pass syntax diagnostics.
- The first server unit run failed one incoming all-station test that expected a
  rejected case claim during a Packaging hold. It now observes an actual
  pre-expiry Dough cadence and requires absent case claims with unchanged counts,
  while preserving the other-station assertions. No worker policy was weakened.
- The first post-rebase API pass had 33 passed, 2 failed and 153 filtered skips.
  The two four-station fixtures predated main's explicit Frontline stock
  initialization requirement. They were updated with initialized, zero-stock
  applicator registers; runtime tracking and inventory safeguards were retained.
- PASS: 73 server scheduler/coordination/intent unit tests, including merged
  diagnostics and incoming stock/lifecycle coverage.
- PASS: the full required workspace typecheck, including generated equality,
  libraries and all application/script packages, exit 0. Receipt:
  `/tmp/replit-background-tasks/478068a1-c3c7-4ac2-9bbc-ede4815bbfa1.log`.
- PASS: focused canonical manual-section and operational lifecycle API groups,
  35 tests, 153 explicitly filtered skips, on a newly initialized private local
  PostgreSQL cluster. Correction/expiry and correction/Resume both preserve
  all-station continuity. Receipt:
  `/tmp/replit-background-tasks/5e8748a6-9ccc-476f-b71a-aa98a434bbc0.log`.
  The disposable cluster was stopped and removed after each attempt.
- Browser matrix results above belong to the pre-rebase tested integration,
  not a new post-rebase browser run. The unchanged restored browser source was
  compared to that validated tip and parsed; the shared server integration was
  rechecked as described above. Physical-device and historical-incident limits
  remain unchanged. No duplicate follow-up or production mutation was made.

### Finalization against the newer main branch

- Main advanced during finalization with split Press/Oven/Frontline timing,
  approved Brix-source contracts and development-runner changes. A further
  managed rebase stopped only on generated validators. Regeneration retained
  those incoming contracts and the Packaging operation. The release runner
  installed the incoming frozen lockfile; this task did not change dependency
  versions or weaken its supply-chain checks.
- The newer full typecheck found `TS2345` in the shared calculation tests:
  an operational snapshot had replaced the batch-weight fixture. Inspection also
  found the no-pizzas-per-case fixture replaced with unrelated override data and
  lifecycle assertions merged into the freshness test. These marker-free fixture
  regressions were repaired, preserving the incoming phase version and adding
  explicit assertions for the new Press/Oven and Frontline sections.
- The first live-calculation unit pass then had 27 passed and one failed:
  a canonical-ownership test had acquired the adjacent stale-generation input
  and lost its private server ownership. Restoring its original matching input
  and ownership retained both the canonical and stale-generation assertions.
  No runtime formula or ownership requirement was changed.
- PASS: all 28 live-calculation tests across five files and the full workspace
  typecheck, exit 0, including generated equality, library and application
  typechecks. Receipt:
  `/tmp/replit-background-tasks/43fd612b-a7bd-4829-b0f6-7e113b4fc773.log`.
- PASS: 74 focused server scheduler/coordination/intent tests against the newer
  main branch. Their receipt also records the subsequently repaired library
  typecheck failure:
  `/tmp/replit-background-tasks/350babc9-0de0-40f6-b3eb-be83105c021a.log`.
- PASS: 35 canonical API tests with 153 explicitly filtered skips against the
  newer shared timing/stock rules, using a fresh private PostgreSQL cluster that
  was stopped and removed. Receipt:
  `/tmp/replit-background-tasks/a94aaac7-b36b-4ed5-bcef-04de8b9c4e6d.log`.
- The prior browser matrix remains labelled pre-rebase evidence; it was not
  rerun or relabelled as testing all later main-branch changes. Existing shared
  sync/server-authority work owns its planned next steps, and the existing
  pinned-runner and Agent-stall investigations cover the tooling issues. No
  duplicate follow-up or unapproved production repair was created.

Full release suites were not requested or run for this repair. A log refresh
exposed an earlier `release:standard` failure because an existing station-activity
integration group belonged to no release shard. This is not one of the focused
checks above and is not claimed repaired; the release-validation maintainer must
include that group before a future release gate. No release readiness claim is
made here.

Applicable safeguards:
task-execution-rules, state-accuracy-check, sync-invariant-check, api-design,
error-handling, evidence-hygiene, and verify-before-commit.
