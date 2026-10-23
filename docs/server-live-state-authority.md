# Server live-state authority

## Objective and status

The existing operational-intent ledger, manual-section ledger, automatic claim
engine, and transactional finalization remain the only canonical writers.
Local clocks animate server anchors; browser persistence is recovery evidence,
not acknowledgment.

Implementation and bounded workspace verification are complete, pending task
completion validation. Required remaining browser selections passed; their
individual coverage and historical failures are retained below. This is not a
release certificate. No production mutation, heal, publish, or physical-device
verification is authorized or claimed here. The assigned implementation owner
owns this authority outcome; independent release/production observations retain
their separate boundaries.

## Field/action inventory

| Surface | Canonical owner / mutation | Snapshot policy / local evidence |
| --- | --- | --- |
| Start, global Pause, Resume, End; started/paused/ended anchors | Existing operational intents; server clock; epoch/run generation; atomic End service | Transport only; pending lifecycle kept in owner-scoped durable outbox |
| Pause tunnel decision | Operational `control/pause-policy`, stable pause ID and bounded choice window | Never a timestamp-wins snapshot edit |
| Auto/Manual mode | Operational `control/auto-track`, locked revision | Optimistic toggle requires durable delivery |
| Dough timer hold, timed release, manual Resume | Operational `control/dough-timer`; server-issued pause/release anchors | Canonical controls replace browser controls; no per-second writes |
| Downtime log add/edit/end/delete | Operational `control/stoppages`; revision-bound bounded rows | Open lifecycle pause cannot be removed or rewritten |
| Packaging counts and Resume | Existing manual Packaging section and automatic case claims | Canonical causal register, never client suppression-generation authority |
| Dough trays/batches, Sauce counts and physical supply | Existing manual sections, stock transitions and automatic claims | Counter/anchor/generation fields are command-owned |
| Frontline applicator/pepperoni supply and batch progress | Existing section commands and canonical claims | Existing station-specific weight/demand and stock math retained |
| Split Press/Oven/Frontline/Packaging timers and drain | Existing server projection derived from canonical lifecycle/configuration | Read models stay outside hashed persisted sync document; local interpolation only; pending lifecycle anchors use estimated server time, while cadence and choice deadlines remain local |
| End/history/inventory | Existing single transaction: intent result, immutable history and inventory | Generic snapshots cannot create an End |
| Brand/flavor, recipes, speeds, timing configuration, targets | Ordinary setup edits under existing setup authorization/merge | Intentionally not converted into operational commands |
| Warehouse staging checklist, substitution definitions and plan ordering | Existing day/setup merge (not physical production totals) | Separate from physical prepared-stock accounting |
| Selection, tabs, draft forms, minimum active-run recovery | Local UI/recovery state | No canonical status inferred |
| Cursor and pending deliveries | Scope/account/session-generation/reset-bound recovery | Late pages never advance a different session or pass newly queued work |
| Pre-run preparation planning | Existing pre-run/setup state, not a new live-run scheduler | Must not be used to forge accepted live-run counters |

Lifecycle commands observe the adopted run generation, not the maximum timestamp
in browser storage. A local setup/recovery stamp cannot establish a server base.
The server retains its generation guard, and snapshot fencing separately restores
canonical `metaUpdatedAt`; no second generation ledger or scheduler was added.

## Coverage inventory / next milestone

* Retain repaired Packaging Resume, split timing, Frontline physical-stock and
  surplus contracts; do not duplicate their ledgers or accounting policies.
* Input variants: complete/partial/legacy snapshots; missing and exact base;
  duplicate, reordered, colliding, concurrent and epoch-stale commands;
  pending/sending/blocked/review/accepted recovery; online/offline/storage
  failure; signed-out, returning same account, other account and sandbox.
* Lifecycle variants: pending/running/paused/draining/ended; manual and timed
  station hold; historical stoppage edit; no lifecycle pause deletion.
* Platform evidence required: Chromium and WebKit desktop, phone, tablet
  portrait and landscape; two-context handoff and sleeping writer. Physical
  Android/iOS/PWA is **NOT RUN: no physical device access in this workspace**.
* Completed milestone: actual sign-out receipt, sandbox handoff/return,
  accepted End/drain and outstanding viewport variants. No browser driver is
  running. Focused checks and affected typechecks pass; partial historical
  assertions and current whole selected cases remain explicitly distinguished.
  Owner: assigned authority task agent. Task completion validation is next;
  physical evidence remains unavailable as described above, not inferred from
  emulation. No same-outcome browser or fixture work has been deferred.

## Failure ledger

| ID | Observation | Status / evidence / next action |
| --- | --- | --- |
| A1 | Delayed mutation cursor page could cross identity/reset/pending-work boundaries | Repaired; seven focused cursor regressions pass |
| A2 | Intent ID collision could disclose/reuse another command's stored result | Exact actor/device/base/payload comparison implemented; seven unit cases and full transaction suite pass |
| A3 | Accepted lifecycle response could retain optimistic browser anchors through LWW | Forced canonical reconciliation implemented; focused lifecycle/cursor set passes (16 tests) |
| A4 | Initial reconciliation edit referenced removed accepted-start stock predicate | Repaired; start-stock regression passes |
| A5 | Missing controls remained broad-snapshot mutations | Migrated onto existing intent channel; transaction tests pass; browser verification running |
| A6 | Broad snapshots could overwrite canonical lifecycle/counters after temporary holds | Command-owned field fencing implemented before/after legacy merge; full transaction suite passes |
| A7 | Shared-library check failed on malformed app-slot test fixture; declarations remained stale, causing downstream export errors | Corrected fixture to actual app-slot input; shared-library build and calculator TypeScript pass |
| A8 | Account sign-out/sign-in ABA could adopt old section/intent response | Session-generation fences implemented; deferred section/intent response and cursor regressions pass |
| A9 | Migrating manual corrections off snapshots omitted existing automatic-channel invalidation | Existing station-specific invalidation now runs in the correction transaction, identified by its server mutation revision; stale-tray claim regression passed |
| A10 | Duplicate command/claim delivery returned a historical snapshot after a newer correction | Exact retries now return current canonical facts with the original receipt identity; focused tests pass |
| A11 | Delayed replies could rewind canonical revision, clock, or cache after asynchronous validation; dated replies could replace today's baseline | All-channel session/revision fences and live-day-only cache adoption implemented; client response/cursor coverage passes |
| A12 | A canonical dough hold received before live-screen mount could be lost during baseline effects | Owned synchronous projection and post-reset adoption implemented; clock-offset/pre-mount/no-held-catch-up regression passes |
| A13 | Rejected manual corrections lacked a visible saved-request review and canonical replacement | Canonical rejection adoption plus read-only scoped request details implemented; browser evidence not reached |
| A14 | Full transaction fixtures assumed snapshot-owned counters, hard-coded revisions, and only day-state events | Historical passes 175/189, 184/189, 187/189, 188/189; corrected explicit-409, command-lock payload/actor and accepting-revision assertions; latest **189/189 PASS** |
| A15 | Convergence fixtures still attempted snapshot Start/End/counter writes | Historical 6/11 and 10/11; setup writes retained and lifecycle/counters migrated to real commands; latest **11/11 PASS**, with request/convergence bounds retained |
| A16 | Operational-update rejection and stale-base recovery can coincide; ordinary setup must not be lost or operational changes blindly replayed | Ownership-aware three-way recovery retains setup; owned deltas remain immutable scoped review evidence; shared/client recovery regressions pass |
| A17 | API typecheck rejected missing canonicalRevision in a synthetic SSE-frame type | Fixture repaired; supported API and route-isolation checks pass |
| A18 | A pending/rejected control could suppress unrelated canonical lifecycle adoption | Controls cannot fence canonical adoption; terminal control evidence retained without blocking fresh lifecycle controls; focused regressions pass |
| A19 | Clearing a legacy saved snapshot after rebase could discard unsupported operational evidence | Original request and baseline now retained read-only in existing scoped outbox before clearing journal; no retry/discard/delivery of those review records; owner-switch and idempotence tests pass |
| A20 | New recovery-result declarations were stale; JSON fixture used unavailable structuredClone global; one focused invocation used wrong hook-test paths | Rebuilt shared declarations, used JSON clone for JSON evidence, corrected paths; library/API/client typechecks and all 12 selected client files pass |
| A21 | Two shared calculation fixtures contradicted their titles (valid package count while testing missing count; missing/mismatched private ownership while expecting canonical schedule) | Fixtures repaired without production math changes; added invalid-count and mismatched-proof cases; **30/30 PASS** |
| A22 | New convergence helper used unwrapped intent, nonexistent manual route, omitted manual date/epoch, and omitted error property in diagnostic fixture type | Request envelope/path/date/epoch/type repaired against maintained UI contract; API/route typechecks and convergence **PASS** |
| A23 | Pending local lifecycle anchors and server-offset timer display used different clocks | Capture pending anchors using estimated server time, retain local pause-choice deadlines; four focused lifecycle/clock suites **42/42 PASS**, including +/-120-second offline projections; calculator typecheck PASS |
| A24 | Optional development identity-sequence diagnostic is unavailable | Read-only development catalog check found all 37 expected targets still non-identity, while diagnostic requires the existing identity conversion. No schema/sequence/row changes made. This is separate from operational authority; any conversion needs approved migration rehearsal and supported managed-schema handling. Owner: project database maintainer; next action: reconcile migration/catalog expectations before release, never hide warning or reset sequence positions |
| A25 | Automatic deployment-log feed reported database timeouts/connection failures affecting background jobs, push scheduling and an auto-track tick | OBSERVED / NOT DIAGNOSED; this is the separately reported published runtime, not the disposable verification target. No production health claim or repair made. Owner: published-app operator; next action: authorized deployment/database reliability diagnosis before a production-readiness decision |
| A26 | Browser command returned -1 after starting one Chromium desktop test, without a durable exit/result artifact | Incomplete, not PASS or a proven app failure. Tester confirmed no active runner; prepared suite retained and original matrix continued in a bounded durable background process. Owner: authority task agent; next action: collect actual per-project results and repair any confirmed same-outcome failure here |
| A27 | Durable original browser matrix: 8 failed, with three harness causes | Chromium desktop/tablets reached terminal Stop but fixture had paused first, hiding the running-only Stop button; phone could not name the compact sync button; WebKit service worker bypassed page-route request gating. Earlier reached assertions remain evidence, not whole-case PASS. Failed artifacts retained under ignored generated-artifacts/live-authority. Phone accessible name and harness selectors repaired; shared real-transport gating replaces page routing, and Stop is attempted while running. Original full case has NOT been rerun |
| A28 | Automatic client/release checks exposed a pnpm workspace-discovery fixture failure and two unassigned API release-suite titles | Repaired the malformed-manifest fixture using its existing workspace-list seam; complete checker file 96/96 PASS. Assigned station-activity and bounded completed-history suites to existing release sync shards; actual shard inventory assertion PASS. An initial tsx -e invocation could not require a top-level-await ESM module; corrected node --import tsx --input-type=module invocation passes. Full client/release workflows were NOT rerun and no release certification is claimed |
| A29 | Managed API restart reported port 8080 already in use | Verified the old listener was the orphaned workspace API process, terminated only that process, then restarted the exact managed API workflow. API ready, development /api HTTP 200; web workflow running. No production process or unknown listener was terminated |
| A30 | First targeted continuation: 8 failed before downstream recovery/completion assertions | Chromium inspector omitted the scope from both recovery-key prefix and expected owner; actual writes are synchronous before the offline branch. WebKit held B's real Packaging request but A was still on Run, so its Packaging control was absent. Scoped inspector, both required tab transitions, and promise rejection handling repaired. This run did NOT prove lost data or a server conflict failure. Artifacts retained in generated-artifacts/live-authority/continuation-fixture-failures |
| A31 | Bounded Chromium desktop continuation advanced past recovery, then failed waiting for auth-screen after Sign out | PASS reached assertions: exact owned request survives offline reload; unverified cold session is visibly unavailable; peer counter advances to 4; original request receives real 409; canonical 4 replaces pending 3 and original request/base remain reviewable. Whole case FAIL: post-logout / renders Landing, not /sign-in. Source-only diagnosis confirms the fixture must open Landing's Sign in control. The failed log does NOT establish logout HTTP success. Helper now explicitly observes POST /api/auth/sign-out 204, Landing, then real Sign in navigation; not rerun. Sandbox handoff/return and terminal End/drain remain NOT REACHED. Artifacts retained in generated-artifacts/live-authority/desktop-recovery-confirmed-scope-not-reached |
| A32 | Source review found additional continuation assumptions before retry | Replaced offline reload's authenticated-tab expectation with the actual bounded session-unavailable surface plus exact retained owner/request evidence; retry uses the visible session retry control, not injected auth or blind refresh. At this stage Pause/Resume predicates incorrectly assumed action=lifecycle; A40 records the source-confirmed correction. Common transport/reconnect helpers keep both harnesses consistent. Collection checks are not browser PASS evidence |
| A33 | Remaining-check source audit found that run-ID/name absence alone is not a valid sandbox ownership assertion | Authorized resetSandbox copies canonical Live daily documents, including IDs, into server sandbox scope. Distinguish legitimate server-seeded data from adopting or delivering another account's local correction. Remaining-only harness preparation must prove current authenticated scope, canonical server state, absence of other-owner recovery display/delivery, and original-owner recovery after return. No sandbox reset or production data change was performed by this audit |
| A34 | Remaining-only continuation harness prepared; no browser or test run | Added independent `desktop-scope-end` and `browser-recovery` selections with distinct output directories. Desktop now creates only a real held online owner request (base 2/value 3), lets the peer commit canonical 4, and retains the exact rejected request before sign-out. The browser selection excludes desktop and retains its offline conflict/reload journey; phone and WebKit keep Pause/reload/reconnect/Resume, with WebKit's held Packaging response/run-switch path. Start state comes from an isolated canonical running-state seed rather than replaying the already-proven Start action. Sandbox checks now allow the documented stale-login server copy of Live IDs/names while requiring no sandbox-owner recovery display/adoption or delivery of the Live request and restoring Live through real sign-in. End now requires the real `STOP RUN` lifecycle receipt, explicit zero-surplus confirmation receipt, and exact prior-run drain assertions. Earlier A1–A33 results/artifacts remain unchanged. Collection, browser execution, and typecheck are NOT RUN by request; next owner action is collect/drive only the selected case(s) using the commands returned with this preparation. |

### Prepared per-variant continuation commands (not run)

The two broad modes recorded in A34/A35 are superseded by these selections. Each command filters to exactly one project and receives a distinct evidence ID; output directories remain separate from the stopped run. The WebKit tablet cases were not reached in the stopped batch, so those two selections retain the full remaining sequence. Use the isolated runner from the repository root when the task owner resumes browser work:

```sh
LIVE_AUTHORITY_CASE=desktop-scope-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-desktop-scope-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
LIVE_AUTHORITY_CASE=chromium-phone-lifecycle-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-chromium-phone-lifecycle-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
LIVE_AUTHORITY_CASE=chromium-tablet-portrait-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-chromium-tablet-portrait-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
LIVE_AUTHORITY_CASE=chromium-tablet-landscape-recovery-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-chromium-tablet-landscape-recovery-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
BROWSER_TEST_INSTALL_WEBKIT=1 LIVE_AUTHORITY_CASE=webkit-desktop-recovery-lifecycle-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-webkit-desktop-recovery-lifecycle-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
BROWSER_TEST_INSTALL_WEBKIT=1 LIVE_AUTHORITY_CASE=webkit-phone-lifecycle-end LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-webkit-phone-lifecycle-end bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
BROWSER_TEST_INSTALL_WEBKIT=1 LIVE_AUTHORITY_CASE=webkit-tablet-portrait-full-remaining LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-webkit-tablet-portrait-full bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
BROWSER_TEST_INSTALL_WEBKIT=1 LIVE_AUTHORITY_CASE=webkit-tablet-landscape-full-remaining LIVE_AUTHORITY_EVIDENCE_ID=20261023T214502Z-r2-webkit-tablet-landscape-full bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.live-authority-continuation.config.ts
```

### Continuation failure ledger

| Entry | Observation | Evidence / resolution |
| --- | --- | --- |
| A35 | Dedicated fixture import initially required its case flag everywhere and used a fixed artifact-date directory | The prior two-mode dedicated config still fails fast without selection; the spec registers only explicitly selected cases. Default full-suite discovery excludes these standalone authority specs. Safe UTC evidence IDs are inherited by workers and preserve prior failures. Earlier collection PASS covered one desktop case and seven other variants; A36 replaces that broad selector with per-project remaining segments |
| A36 | Stopped remaining-only browser batch exposed separate gate, popover, seed, and End-stage limitations | Evidence from `20261023T214502Z-remaining`: Chromium desktop reached the real held owner request and peer canonical 4, then timed out associating the Playwright response; Chrome phone completed manual offline/reload/conflict/review but Pause was blocked by the open SyncStatusPopover; Chrome tablet portrait completed manual recovery but End returned `outcome: conflicted`; Chrome tablet landscape failed before manual recovery because auto-track changed seeded trays 2 to 1. WebKit desktop passed held Packaging/run-switch review and retained/reloaded its offline request, then the first peer click was intercepted by sync activity in the open header popover; WebKit phone completed manual recovery but Pause was blocked by the popover. WebKit tablet portrait and landscape were NOT REACHED. Harness-only continuation now reads the real gated Response status and cloned JSON alongside request ID, retaining only allowlisted `code`/`outcome` in the artifact and safe transport-error metadata; it closes the controlled popover with its toggle and checks `aria-expanded=false`, seeds `autoTrackDisabled:true`, and selects only each variant's still-unproved segment. No app source changed. No browser, test, or collection was run for A36; all listed outcomes remain prior evidence, not new PASS claims |

| A37 | Additional collection invocations did not constitute browser checks | Unfiltered default collection first required PLAYWRIGHT_API_BASE_URL, then reported 249 discovered cases against the reviewed 172-case contract after excluding both standalone authority specs. No browsers ran. Altering that reviewed release coverage is outside this task's explicit no-full-release-certification boundary; release-maintenance owner must reconcile exact identities before full-release use, not blindly raise the count. A shell-wrapped multi-case collection command timed out before reporting cases; the supported direct pinned-runner desktop collection subsequently passed one selected case. None of these results is browser PASS evidence |
| A38 | Desktop transport diagnostic and sandbox post-login setup gaps | Preserving original fetch arguments and cloning Request inputs produced a genuine 409/section_changed for the original held request; two transport-unit tests and scripts tsc pass. Run 20261023T220425Z reached logout 204, real sandbox sign-in 200 and reset 200, then probed identity during Home's supported reset reload. Wait for that actual reload and probe the shared browser-cookie identity after it. Run 20261023T220957Z then reached sandbox identity/owned evidence but the public account's first-login dialog intercepted the next click; complete its real onboarding acknowledgment. Run 20261023T221314Z proved no Live recovery adoption/display/delivery in sandbox, then strict Password label matched Show password too; use the exact input label. These are retained partial browser assertions, not whole-case passes or API failures. No app source changed |
| A39 | Actual scope/End passes and a separate post-recovery End conflict | 20261023T221550Z-exact-segments: Chromium desktop whole selected case PASS, including real logout, sandbox reset/reload and onboarding, sandbox identity/no Live delivery or adoption, return to original Live account, retained original review, End accepted, explicit zero-surplus receipt and prior-run drain. 20261023T222008Z-independent-remaining: Chromium tablet portrait End-only whole case PASS. Landscape offline correction/reload/409/review passed, but subsequent End returned HTTP 200 with outcome conflicted; never counted as accepted. Passing segments were retained |
| A40 | Phone lifecycle harness confused status surfaces and command discriminants | First failure looked for offline notice text in a closed popover while the real UI already showed Resume and Offline — local projection. Use the maintained badge and safe stop-tunnel default before reload. 20261023T222526Z-lifecycle-only then reached offline reload but falsely missed the durable Pause: inspector expected lifecycle/pause. Maintained source emits action=pause or action=resume, with no lifecycle value. Corrected inspector and response predicates; this was not evidence of lost work. WebKit phone was NOT REACHED in that stopped attempt |
| A41 | Browser stamps could supply a noncanonical lifecycle generation | Start/Pause/Resume/End and competing End used overlayRunMetaStamps, which takes the greatest durable browser timestamp. Use the adopted in-memory run generation instead; retain the server conflict guard and generic setup/recovery stamping. Focused lifecycle/foreground/clock tests 41/41 and calculator tsc PASS. 20261023T223659Z-canonical-generation: all six unresolved browser selections PASS, including genuine post-409 landscape End accepted. Allowlisted request/generation/canonical receipt diagnostics retained. No server policy, production math, schema, or accounting change |
| A42 | Previously logged full client run exposed stale or malformed related fixtures | Historical test:client run: 3 failed suites, 10 failed tests, 3541 passed, 1 skipped; not a current full-suite PASS. Valid-success manual-section mocks lacked required canonical revision/server time/values; updated fixtures, retaining malformed-success rejection tests, 31/31 PASS. Frontline fixture contained an out-of-scope slot, missing controls helper, duplicate draft bodies ignoring draft parameters, Sauce mounts in pepperoni cases, undeclared transition variables and an orphan read. Protected baseline authority-fixture-recovery-baseline; compared known-good bodies selectively, kept new temporary-removal coverage, restored all-register ingredient isolation/fill/navigation/locks/drain assertions. Recovery audit: 9 PASS, 1 declared intentional difference, 0 missing. First repaired station run exposed 17 failures, next narrowed to 2 wrong mounts; final targeted 3/3 PASS covers those and the restored fully-drained Packaging fixture. Latest 65 station cases are covered across the retained run and targeted fix, not claimed as a fresh single full-suite run |
| A43 | Station read-only source guard still sliced a removed profile-pool effect | Slice the maintained scoped-profile reconciliation boundary and assert its screenMode/session guard plus actual startProfileReconciliation call. Keep correctly bounded Factory KV write-through/queue/migration assertions. Focused syncBaselineGate suite 16/16 PASS. No application write permissions were loosened |
| A44 | Final whitespace and external readiness observations | Removed an orphan trailing blank line after fixture repair. Managed web restarted once after the application change and reached ready; public landing renders with expected unauthenticated 401s and the previously observed development update-check failure. Production latency/job failures and the default release browser inventory mismatch remain independent observations, not authority-test failures, permission for production writes, or a readiness certificate |
| A45 | Completion sync with main stopped on conflicts and changed generated/test content | Preserved integrated baseline authority-integrated-before-main. Unioned both PWA fixture lessons and deployment evidence exclusions. Selected incoming generated validator then regenerated from merged OpenAPI, never hand-merged it. Preserved incoming nonzero-stock/hidden-ingredient cases alongside this task's navigation/fill/identity coverage and both current profile reconciliation guards. Post-sync station/read-only suites 85/85 PASS (69 station, 16 guards). Codegen initially stopped on three TS2345 errors in live-calc tests: copied snapshot fixtures and a misplaced ownership fixture had replaced distinct original inputs. Restored that test file exactly to the protected integrated baseline, not a branch-wide rollback. Shared declarations, check:api-generated (including six validator tests/declaration builds), calculator tsc and API typecheck/route isolation then PASS |
| A46 | Completion code review PASS; configured `bash scripts/src/run-release-node.sh pnpm run typecheck` FAIL at Vite configuration precheck | Log PCV6OhHl0ZMGiJly-NHD2/validation.shell.exec.0 reports `Invalid prepared build-source record`; sibling typechecks were cancelled, not independent TypeScript failures. Confirmed ignored web-stage-start record is development-mode policy v3 while current policy is v4. Archived only that verified obsolete intermediate under ignored .local/build-identity/archive; preserved publish records, recovery data and validation guards. Vite configuration check then PASS for three files and bundle/runner/native loaders. Configured completion validation must still rerun; no browser flow invalidated |
| A47 | Post-sync development startup diagnostics | Both managed services ready after one restart per service for the merged batch; API initialization and sync listener succeed. Optional identity-sequence health reports `identity_sequence_health_check_failed`, and master-data health reports existing findings (not a clean health certificate). Identity-sequence safety is therefore NOT PROVED by this startup; project database diagnostics owner should inspect the bounded diagnostic before any sequence repair. No sequence/data heal or production operation authorized here. This does not establish an authority-test regression or replace the retained isolated transaction evidence |

## Verification results so far

* PASS: API controls, snapshot-authority, intent and exact-retry pure suites, 32 tests.
* PASS: 12 client files, 144 tests (outbox, receipt adoption, cursor, saved-snapshot
  recovery, timer controls, pre-mount hold, wake, automatic schedules and clock isolation).
* PASS: shared sync-contract, 10 tests; live-calc, 30 tests.
* PASS: `pnpm run typecheck:libs` after repairing A7/A20/A21.
* PASS: calculator `tsc -p tsconfig.json --noEmit` after shared declaration rebuild;
  rerun also passes after pending-anchor clock change A23.
* PASS: OpenAPI generation and `check:api-generated`, including generated drift,
  six validator tests and generated declaration builds.
* PASS: full transaction suite, **189/189**, in disposable PostgreSQL.
* PASS: convergence, **11/11**, using the existing isolated convergence runner.
* PASS: supported API typecheck and route isolation after A17/A22. Historical
  diagnostic-type failure stopped a chained convergence attempt (NOT REACHED);
  corrected type and final rerun pass.
* PASS: reset/session-boundary/automatic-coordination suites, **56/56**, in
  disposable PostgreSQL.
* PASS: additional foreground-wake, blank-value, skid-merge, value-stamp,
  applicator and Sauce-barrel client safeguards, **87/87**.
* PASS: lifecycle manager/frozen snapshot/foreground intent/clock-isolation,
  **42/42**; this set overlaps the earlier clock-isolation run, not 42 unique
  additional tests.
* PASS: latest SyncStatusPopover suite, **7/7**, including compact numeric-badge
  accessible status labels, followed by calculator typecheck. The earlier focused
  client total remains a separate run, not seven newly unique tests.
* Historical browser failures remain failures: original matrix **8 FAIL**, first
  targeted continuation **8 FAIL**, bounded desktop continuation **1 FAIL**.
  Their reached assertions remain evidence for those segments, not whole cases.
* Actual browser PASS: all eight project variants have passed their selected
  remaining case, across the runs in the table below. These are scenario-specific
  continuations, not one fresh uniform full-matrix run. Desktop and tablet
  portrait passing selections were not rerun. The lifecycle generation repair
  is covered by focused regressions and the six later selections.
* The last application-code change passed lifecycle/foreground/clock **41/41**
  and calculator tsc. Related fixture checks passed manual locks **31/31** and
  source baseline guards **16/16**. Station tests reached **63/65**, then the
  affected two cases and changed Packaging-drain fixture passed **3/3**, with
  **62 skipped** explicitly selected out. No new full-client/release PASS is claimed.
* PASS: deferred-boundary checker **96/96** and API release-shard inventory.
  These are focused repairs, not a rerun of full client/release workflows.
* Collection is separate: historical eight-case collection and latest selected
  desktop one-case collection PASS establish discovery only. Each actual browser
  result below additionally executed its one selected case. Default full-release
  collection remains blocked by A37's **249 versus 172** reviewed-case mismatch;
  it was not run as a browser suite or silently accepted by increasing the budget.
* Development preview: both managed services started and API reached ready.
  Public landing renders; unauthenticated 401s are expected. Optional identity
  sequence diagnostics reported unavailable, and the public development preview
  shows an update-check-failed notice and navigation budget warnings. Those
  observations are not evidence of clean release health; no site-data clearing
  or forced PWA update was used.
* NOT RUN: physical Android Chrome, iOS Safari and installed PWA; physical
  devices unavailable. Workspace inspection: Linux, no ADB executable and no
  exposed USB device bus; no attached iOS/macOS Safari automation or remote
  device-farm session is configured. Therefore real mobile OS suspension/wake,
  installed-PWA lifecycle and device-specific storage eviction remain unproved.
  Chromium/WebKit viewport emulation cannot substitute for those observations.
  Native mobile is NOT APPLICABLE to this web-only product.
  No production or release-readiness claim is made.

## Actual remaining browser results

These are Chromium/WebKit **viewport** variants, not branded Chrome/Safari or
physical-device certification. Existing earlier checks remain in the ledger.

| Project | Selected remaining case / actual result | Evidence ID |
| --- | --- | --- |
| Chromium desktop | Scope/account handoff and return, owner review, accepted End / zero surplus / drain: PASS | 20261023T221550Z-exact-segments |
| Chromium tablet portrait | End / zero surplus / drain: PASS; earlier recovery assertions preserved | 20261023T222008Z-independent-remaining |
| Chromium phone | Offline Pause / cold reload / durable owner intent / reconnect / Resume / accepted End / zero surplus / drain: PASS | 20261023T223659Z-canonical-generation |
| Chromium tablet landscape | Recovery / genuine 409 / canonical review / accepted post-recovery End / zero surplus / drain: PASS after A41 | 20261023T223659Z-canonical-generation |
| WebKit desktop | Offline correction/reload/conflict/review, offline lifecycle/reconnect, End / zero surplus / drain: PASS; prior held-response/run-switch evidence retained | 20261023T223659Z-canonical-generation |
| WebKit phone | Offline lifecycle/reconnect and End / zero surplus / drain: PASS; prior held-response and correction-recovery evidence retained | 20261023T223659Z-canonical-generation |
| WebKit tablet portrait | Held Packaging response/run switch, correction recovery/review, offline lifecycle and End / zero surplus / drain: PASS | 20261023T223659Z-canonical-generation |
| WebKit tablet landscape | Same selected remaining flows as portrait: PASS | 20261023T223659Z-canonical-generation |

Ignored, synthetic-only logs are retained under
`artifacts/run-calculator/generated-artifacts/live-authority/remaining-checks/`.
The six-case pass log is `six-remaining-browser-passes.log`; separate desktop,
portrait/failed-landscape, and phone protocol-miss logs preserve earlier outcomes.
Per-case success screenshots remain in the uniquely evidence-ID-named
`artifacts/run-calculator/test-results/live-authority-remaining-*` directories.
Phone and WebKit landscape End/drain captures were visually inspected.

The following sources were unchanged between the six-case pass and these
post-run SHA-256 captures, and retain the same hashes after the completion sync:

* Lifecycle manager: `022313baaa1cec7ec808e67b081c1bf51253bc8dc48361e996d5ea477a981481`
* Continuation spec: `4cc1d6df143531fdd3defc74b72405973b946639a5acbbf57b96ca15c2c52622`
* Recovery transport fixture: `2e87c0b4b27cef854284691619c6d1e9d3919b0ed461d4707891687f1724b84f`

These are retained pre-sync browser results, not a new browser certification of
all incoming main-branch features. Comparison with the protected integrated tree
shows the incoming Home/storage edits belong to shared master-data history,
guarded changes and retired local rollback; the auth change adds authorization
context without changing scope admission. The owned command reducers, outbox,
canonical merge policy and live context retain their tested content. Sync's
incoming change defers master-data invalidation until an enclosing database
transaction commits; it does not replace the owned operational mutation logic.
Generated contracts and affected types were rechecked after synchronization.
