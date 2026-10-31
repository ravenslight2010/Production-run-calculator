# Full-browser repair progress — 2026-10-24

Status: **IN PROGRESS / NO-GO**. This is a repair ledger, not certification.
The original completed and interrupted attempts, raw traces, passing cases,
and generated reports remain retained at their original locations. No full
suite has been repeated during this repair round.

## Execution boundaries

The owner authorized safe application, fixture, and harness repairs, focused
verification before another complete run, and read-only published evidence
retrieval. Publishing, production writes, check waivers, unapproved inventory
changes, and increases to the 80-minute warning / 90-minute hard browser limit
remain prohibited.

The existing local-release-check and partial-results tasks were read through
the task service. Both remain proposed. This work does not implement their
separate local-only CLI mode or reusable partial-result reporter. Current
failure repairs and their verification remain in this release objective.

## Revision boundaries

At repair intake, independently captured fork identity:

- Assessed revision: `test-sha256:5bc1f79780911829e0dccf76cfa7c79db670e31dbfed094a4f879223b9e7528c`
- Production source: `source-sha256:68c03c8da0348cffb2fd36533c1a046d2567b8e797d010f44327f95b86e1b9a7`
- Verification inputs: `ce00da8fec37f32134da4ba0a2dd665641e621941a00495649250da9ed9e5f58`
- Source policy: `production-source-v4`

This intake identity differs from the earlier browser attempt. Neither the
108 passing cases nor the failed complete attempt is reassigned to this fork.

After the first fixture repair and its regression tests:

- Assessed revision: `test-sha256:cfd7a7ebae3111b79b8e3900bbd44ce9912b89cecc039fd43195fe673d642962`
- Production source: unchanged from repair intake.
- Verification inputs: `0a0b75150d5196403eef5132e00ed78032521b1c536be07d5067a0db06cc23ef`

These fingerprints were captured with the pinned release wrapper. The final
revision is not frozen while repairs remain underway.

## Chromium failure grouping

A bounded scan of the 102 retained failure traces establishes these initial
groups. Counts are mutually exclusive; symptom groups are not represented as
proven root causes.

| Cases | Evidence / shared cause | Repair state |
| --- | --- | --- |
| 16 | Master-data writes rejected with the shared-data epoch conflict message. Guarded Undo advances a scope-wide epoch; raw fixture writers omit the required header. | Four shared master-data seed methods repaired to read a fresh canonical epoch before preparing a new seed. No mutation retry or server-fence weakening. Other raw writers and browser confirmation remain to be checked. |
| 8 | Seed writes receive `SYNC_OPERATIONAL_COMMAND_REQUIRED`. Setup sync cannot authorize live operational fields. | Fixture protocol repair pending; retain the server command boundary. |
| 3 | Missing Pause Run after Start in the retained Chromium assertion messages. | Lifecycle root cause still under investigation. |
| 1 | Guarded-Undo cleanup refuses a daily row no longer matching its ownership fingerprint. | Investigation pending; ownership guard retained. |
| 74 | Other assertion, timeout, fixture, convergence, layout, and visual failures. | Further grouping and representative diagnosis pending; no blanket fixture-only classification. |

The profile-save and warehouse seed failures that expose only an HTTP status
are not automatically assigned the same cause without further evidence.

### First safe repair and focused regression

The authorized browser fixture helper now reads the appropriate canonical
collection and sends its `X-Master-Data-Epoch` for newly prepared profile,
cheese, dough/sauce, and mix seeds. A missing or malformed epoch fails before
submission. A rejected mutation is not automatically replayed with a fresh
epoch, preserving the stale-edit fence.

Focused command:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/run-calculator exec vitest run src/e2eIsolation.test.ts
```

Result: **23 tests PASS**, 1 file, 4.47 seconds. Coverage includes successive
nonzero epochs, all five canonical collection paths, invalid/missing epochs,
and no automatic replay of a rejected mutation. This is fixture-unit evidence,
not a browser pass or confirmation that all 16 related failures are resolved.

Private output:
`release-evidence-full/runtime-certification/repair-round-1/fixture-unit.private.log`.
`git diff --check` also passed for this repair.

## WebKit lifecycle diagnosis

Retained desktop, phone, and tablet lifecycle traces fail at the Start-to-Pause
transition. A bounded inspection of the desktop trace found no lifecycle
command POST and 108 setup-sync PUTs. Consecutive payload differences include
run-value timestamps and the base snapshot identity. This suggests unsettled
setup/adoption work may prevent the lifecycle command from being dispatched;
it is not yet a proven root cause or a completed repair.

The server returns a complete pending-run snapshot during fixture hydration.
Do not replace the lifecycle assertion with visibility-only checks, extend
timeouts, force a client-only started state, or bypass canonical adoption to
make the journey pass. Focused reproduction and a causal regression remain
required.

## WebKit guard reconciliation — specifically approved and implemented

The owner approved this exact eight-case reconciliation on 2026-10-24.
The existing authoritative-config contract test passed after implementation.
This is discovery/guard evidence only, not a browser-suite pass.

The selected release compatibility command already executes eight cases across
`phone-webkit` and `tablet-webkit`. The reviewed identity contract still lists
four. Proposed additions to that reviewed contract, on **each** selected
project, are:

1. `import-gold-lab-responsive.spec.ts`:
   `Import Gold manager panel fits and remains reviewable at this browser viewport`
2. `report-issue-confirmation.spec.ts`:
   `staff can retry a failed issue report without retyping and sees its diagnostic reference`

This adds four reviewed identities, removes none, and retains the four existing
lifecycle/report identities. It does not add runtime tests to the selected
command; these four additional cases already ran in the retained attempt.

The configuration guard would also replace its incorrect assertion that only
two WebKit projects may exist with an exact check of the four currently
configured names: `desktop-webkit`, `phone-webkit`, `tablet-webkit`, and
`tablet-landscape-webkit`. Runtime-contract collection would be scoped to the
release command's exact selected pair, phone and tablet portrait, and continue
to reject added, removed, or duplicate identities in that selection.

The dedicated three-case desktop WebKit smoke contract, Chromium's 216-case
inventory, all budgets, worker/retry rules, optional project definitions, and
physical-device requirements remain unchanged. The optional compatibility
desktop and tablet-landscape projects are not silently promoted to required
executed lanes, nor represented as runtime passes. No guard edits have been
made beyond this specifically approved reconciliation.

## Published evidence retrieved, not assumed to match

Fresh deployment-service lookup reports a successful public autoscale build.
A read-only request to its official primary URL's `/api/build-info` retrieved:

- Policy: `production-source-v4`
- Source fingerprint: `211e36b16b7ee63bc40d56e3ade3b61dd30d75f093ee04e31607f11cfde78be8`
- App build: `app-build:3e38e309-a61b-476f-91eb-a0900b9d7398`
- Build completion: `2026-10-24T04:21:13.791Z`
- Runtime-reported deployment: `411f3a0b-be0f-499a-9b85-b35deec43e5d`
- Runtime-reported platform build: `1c16156c-bb64-4dde-8e9d-b01f9ecc95cc`

This is newer than the previous invalid/stale published identity observation.
It **does not match** this fork's independently captured source fingerprint
`68c03c8da0348cffb2fd36533c1a046d2567b8e797d010f44327f95b86e1b9a7`.
The main workspace's reported source-match cannot establish a source-match for
this repaired fork. Runtime-reported IDs are labelled as such, not elevated to
independent provider attestations.

The fork's retained local expected-source and published-match files are older,
so they are not substituted for a current match. Matching readiness and source
reconciliation evidence for the final repaired revision remains outstanding.
Do not publish during this task. Finish repairs and freeze the exact source
revision that would require a later authorized publish before making any
matching-published-build claim.

## Remaining work

Continue the related application/fixture/harness repairs here, verify
representative failures with focused checks, obtain the specific inventory
decision, and run the complete required gates only after known causes are
resolved. Preserve all previous artifacts. Required runtime, engine, viewport,
physical-device, and published evidence remain separately labelled. **NO-GO**
continues; this ledger does not close the release objective.

## Subsequent repair milestones

### Lifecycle autosave repair

The focused desktop WebKit lifecycle journey reproduced the Start/Pause failure
before the repair. A registered optional form control can add an own property
whose value is `undefined`; JSON persistence omits it. Raw-object comparison
therefore treated a persisted round-trip as another edit, repeatedly advancing
the run-value stamp and leaving lifecycle actions waiting for setup sync.

The autosave predicate now compares the actual JSON persistence
representations, retaining the existing run identity, handoff, read-only, and
empty-over-populated guards. Regressions cover optional controls, nested
optional recipe fields, and a genuine clearing of a previously populated field.

After this repair the same focused WebKit journey **passed**, exercising Start,
Pause, Resume and reload: **1 passed, 26.6 seconds**. This focused selection is
not the complete three-case desktop lane and cannot certify it. Previous
failure artifacts were retained before the rerun.

Private diagnostic outputs:

- `repair-round-1/webkit-lifecycle.private.log` — pre-repair failure.
- `repair-round-1/pre-autosave-fix-webkit/` — pre-repair trace and screenshots.
- `repair-round-1/webkit-autosave.private.log` — post-repair focused pass.
- `repair-round-1/webkit-autosave/FINAL-REPORT.md` — focused report, not full certification.

All paths above are under the ignored/private
`release-evidence-full/runtime-certification/` directory.

### Canonical initial-state fixtures

An explicit disposable-database-only snapshot initializer was added for
journeys requiring an already-started run or pre-existing operational counters.
It independently checks the destructive-test fence, checks the fixture
account's API authorization, stores a complete canonical initial snapshot,
advances the row revision, and rejects persisted operational projections.
It is not an automatic fallback from a rejected application write. The normal
setup-only API seeder and all production command guards remain intact.

The Sauce/Dough phone, packaging recovery, prior-run drain, station handoff,
and recipe-refresh prerequisites use this explicit initializer. Their actual
journeys still use the application's real commands and recovery paths.

Focused fixture/autosave/clock regression selection: **43 tests PASS in
3 files**. Private output:
`repair-round-2/unit.private.log`.

The first grouped Chromium repair run's start metadata is recorded in
`repair-round-2/attempt.json`:

- Assessed: `test-sha256:0c35f9f0909ed2f590071ff5d83d51b4e86a3de68511e4de56dd1d776c05bcb1`
- Source: `source-sha256:86d97e6e5af21250ba9805263171e452dad591707df776db8a38eb2cb12c24e2`
- Verification: `5c63e67979f64387eff48057c141608af0d199317c33bb35fbf97e99335cd361`

Its runtime result was **5 PASS / 9 FAIL**, 14 selected Chromium tests in
4.2 minutes. The cross-device lifecycle, department navigation, Dough recipe
editor, die-size defaults, and Dough/Sauce quick-check representatives passed.
Subsequent recipe-refresh fixture edits are not retroactively assigned to that
attempt. These are diagnostic results, not a full-suite certification.

### Follow-up diagnostic group and remaining repairs

The next selected group completed **2 PASS / 7 FAIL / 1 SKIP**
in 4.5 minutes. The paired
run lifecycle and packaging correction/recovery representatives passed after
explicit selection of the canonical fixture run through the normal UI.
The start-of-attempt metadata is `repair-round-3/attempt.json`:

- Assessed: `test-sha256:9f104828e0755e3c158b21b6deb85018cee94d853b61c0f8fe094b7990e8c8b9`
- Source: `source-sha256:86d97e6e5af21250ba9805263171e452dad591707df776db8a38eb2cb12c24e2`
- Verification: `0d454499768bdbcbaedf79561936b51fc6322e99df996e901d5d53757a4a862e`

Fixture edits continued during diagnostic work, including a Sauce fixture edit
after its failure. Therefore the cohort is not certified as an immutable
verification revision. Application source stayed unchanged. Final certification
must freeze both application and verification inputs for the entire attempt.

Private traces/screenshots from these two groups were retained, respectively:
`repair-round-2/failure-artifacts/` and
`repair-round-3/retained/failure-artifacts/`. The original full-suite and
interrupted-attempt artifacts remain untouched.

Additional safe fixture/harness repairs prepared after these diagnostics,
**not yet browser-verified**:

- Barrel-production Sauce scenarios now specify positive recipe ingredient
  rows. Empty rows represent ready-made sauce and must not be used as a fixture
  for manufactured barrels.
- The prior-run counter reader overlays the independent packaging register,
  rather than assuming legacy run values remain the counter source of truth.
- The second station handoff explicitly selects its seeded run. The active
  Summary timer fixture now includes a positive press cadence instead of only
  the legacy approximate line-speed field.
- The remembered-ingredient journey explicitly selects its intended active
  run before asserting its Setup weights.
- The field-check retention test fixes browser Date while keeping timers and
  requests live, preventing relative-age labels from changing its text
  comparison. The original failure differed only by “just now” versus “1m ago.”

Two remaining profile-mode checks exposed a regression in the current implementation:
the checks require shared profile `_subTab` defaults to set Crust on a fresh
browser, but profile defaults are now device-local and individual run `subTab`
metadata remains shared. The owner confirmed that Dough/Crust defaults belong
on the server with the rest of each pizza profile. The existing two Chromium
identities and their shared-default expectations are retained. A repair now
queues capability-gated changes to the profile blob, reads the authenticated
profile cache before legacy defaults, and does not recreate missing profiles.
The profile editor now includes the chosen mode in the same acknowledged
profile save for creation and editing, and prefers saved metadata when opening
the editor. Existing run-mode metadata is not rewritten by these storage helpers.

Verification after this repair:

- Focused profile/sync/autosave/fixture tests: **76 PASS in 4 files**.
  The initial new create-profile test used a dough-only fixture rejected by
  the existing real-data guard; adding actual pizza applicator data corrected
  the fixture without weakening that guard. Both failed and passing logs remain
  in `repair-round-5/`.
- Root `CI=true pnpm run typecheck`: **PASS**.
- The two unchanged Chromium profile identities: **2 PASS**, covering reload,
  starting the next run in Crust mode, sign-out, and a fresh browser session.
- The separately selected remembered-ingredient journey: **1 FAIL** on a
  missing Setup batch-weight input after fresh sign-in; it remains unresolved.
- The browser cohort's start/end identity check passed (`inputsUnchanged: true`).
  Assessed: `test-sha256:ae9ba83e396f6cdd68b22c123c1475e433a49cbb3ea666976e5e0ea5ee31f9d6`;
  source: `source-sha256:06868323d5a9c4284e4688fb9a66f2db9ad3b6b9fcff12ad54a43f7c5345769e`;
  verification: `e4ac6aea26d31935947abf84eb4c4945ead2eaf444781c950904c9d3e6c2e1dd`.
  Private logs/metadata and retained failure artifacts are in `repair-round-5/`.

The preceding immutable diagnostic group (`repair-round-4/`) completed
**3 PASS / 7 FAIL / 1 SKIP**. The relative-age field-check repair, Sauce stock
peer/reload case, and phone station handoff passed. Its remaining Summary timer,
prior-run counter, Sauce balance/control, and remembered-ingredient failures
are not relabelled as passing.

### Remaining Sauce interface repair

Two required Sauce scenarios assert a consumed-barrel correction control and
the old batch-balance row, neither of which is currently rendered by the Sauce
page. The page instead displays current-run planned demand, editable stock, and
historical full barrels. Stock corrections and consumption corrections are
different operations; one must not silently stand in for the other.

The existing consumed-barrel correction callback and balance component are
still present in application code. Their missing connection is being repaired
without replacing consumption corrections with stock corrections. The restored
row uses current run demand and the existing canonical correction queue and
locks. No Sauce assertion is removed or weakened; both existing case identities,
216 Chromium identities total, and 54 files remain required.

### Other repairs still owned by this release task

The prior-run counter remained at zero after End advanced selection. The server
tick transaction built its wall-clock plan only from the canonical selected
index, although the planner already supports ended-run drain. It now plans
eligible ended drains as well, without changing selection, channels, math,
replay caps, shared claim budget, transaction locks, or acceptance fences.
Only whole plans fitting the existing budget are admitted; bookkeeping is
committed separately per admitted run after acceptance. Focused builder tests
are **41 PASS**, including positive prior-run case progress with the next run
pending or running, duplicate protection, expiration, disabling, budget omission,
and unchanged selection. The live browser drain scenario is still pending.

The restored Sauce balance/correction row and manual-section locking tests are
**33 PASS**. The initial client invocation named the wrong test directory and
collected nothing; the corrected invocation is the passing evidence.
Typechecking caught a section-name mismatch in the synchronous lock lookup;
the lookup now uses the existing `sauce` section while the hook retains its
existing `sauce-batches` control identifier. The initial failures are retained.
The final-partial fixture retains its original 10-case input and 30 lb buffer,
2.5-barrel requirement, authoritative 600-second tick, time limit, and identity.
A diagnostic attempt incorrectly assumed that buffer had been retired and used
25 cases; the runtime correctly showed a 4.0-barrel requirement. That input
change was reverted rather than changing the required expected values.

Fresh-session recipe navigation now retries only opening its accordion within
the original five-second assertion bound, allowing run hydration to finish.
The actual batch-weight assertions remain mandatory.

The immutable `repair-round-6/` browser cohort is **3 PASS / 1 FAIL**:
live Sauce/Dough controls, prior-run drain through next-run/tab selection, and
remembered ingredient weights across fresh sign-in pass. The fractional Sauce
case failed on the incorrect fixture demand described above. Its private
artifacts remain retained. Root typechecking also passed after the repair.
The first browser launch was stopped by its prerequisite check before execution;
it is not browser evidence.

All **14 original screen-wake failures** share the same obsolete expected
status text. Current Home code explicitly says "Latest production snapshot
received" and warns that reads do not confirm unsaved edits. Six assertions
have been aligned with that message; acknowledgement progression and the
scenario-specific canonical-state assertions remain unchanged. Focused runtime
verification is pending; no pass is inferred from this static diagnosis.

The immutable `repair-round-7/` cohort passed the original 50-case wake recovery
case after the copy repair. Its fractional Sauce case still failed: the tick
reported `sauceConfigurationBlocked`, while independent channels committed.
The fixture had created a raw-ingredient inventory key although this configured
recipe consumes `ingredient:Sauce:batches`. The fixture now provisions that
prepared-Sauce item only if absent, does not claim cleanup ownership of an
existing factory item, and explicitly rejects a configuration-blocked outcome.
Production inventory guards are unchanged.

The immutable `repair-round-8/` cohort is **4 PASS**: final fractional Sauce
supply through tab changes/reload, partial prep Mix Plan, paused wake, and a
disconnected sleeping peer adopting remote Stop. Assessed identity:
`test-sha256:eb6ae3045eb685077bd7545be1ad4f32480c2e746be4d4cc23369dd6fd124c98`;
source:
`source-sha256:0d4b9b8c1450cbf9a85e1c613ba0c23ca6590def744452cf7347e24a6b1f768d`;
verification:
`18c16cfb03e19bf9b94c44fbc32133ddcd5c9b097c9cba4d5c89169c13d50555`.
Private metadata, logs, and browser output are retained in `repair-round-8/`.
These are focused results, not a full-suite certificate.

Two further bounded repairs await verification:

- Accessibility's initial stoppage history was sent as an ordinary sync PUT.
  Its existing isolated fixture owner
  now initializes that canonical snapshot while the page is `about:blank`,
  before mounting the app, and owns cleanup. The normal command fence remains.
- Summary was provisionally diagnosed as displaying the wrong calculation
  field. The focused run did not support that diagnosis; the provisional
  application change was reverted. Both fields are production-work estimates,
  not wall-clock countdowns, and a clock pulse alone need not change them.

The immutable `repair-round-9/` cohort is **1 PASS, 3 FAIL**, with unchanged
inputs. Accessibility's staff workflow passed, including its original controls
and dialogs. Summary remained unchanged at `20m 0s`; Frontline attempted to start
the device-local blank third run rather than canonical fixture run A (confirmed
by its preserved screenshot); the scheduled move retained a canonical server
stamp rather than the unacknowledged literal `200` requested by the fixture.
Assessed identity:
`test-sha256:7f102190f69eaf7b46cf601695bba1c0239db255b8d31c037fb2fe1a44d491fd`;
source:
`source-sha256:96dce905e553536f01be10ebb6ee0f75527e4c4e5b9be76829bd06c965f819fc`;
verification:
`0b4d569b3c1a4411beddbff6683800070d57d3e1caf405a38fff709689cebb8a`.
Private output, metadata and failure artifacts remain in `repair-round-9/`.

Further fixture repairs await focused proof:

- Summary retains its actual displayed-value-change and draft-focus assertions.
  It now requests an accepted isolated server production tick while editing a
  safely unfinished target, rather than assuming wall time reduces work.
- Frontline selects each intended canonical run by ID through the real UI,
  waits for its target to hydrate, and asserts lifecycle state by that ID.
- Scheduled moves compare the destination stamp with the canonical source
  stamp read after fixture acceptance, not a pre-acceptance literal. Run order,
  value `37`, reload and source-removal assertions remain. Its epoch read uses
  the route's actual `epoch` field and rejects missing/invalid epoch responses.

The immutable `repair-round-10/` cohort is **1 PASS, 2 FAIL**, with unchanged
inputs. Frontline's original two-context refill, resumed automatic consumption
and next-run rearm scenario passed after explicit run selection. Summary's
isolated tick accepted one event but did not change its displayed estimate.
Inspection found the fixture's `casesPerSkid` inherited zero, which suppresses
Packaging suggestions; the fixture now explicitly supplies `12`.
The scheduled-move case stopped at the provisional `resetEpoch` check:
the actual route returns `{ epoch, rollover }`. That provisional field change
has been corrected to a strict `epoch` read; canonical-stamp comparison remains
pending proof. No server epoch contract was modified.

The fresh-session recipe-weight failure and the other unresolved groups
remain in this task. The independently owned security/CI task has merged;
this work has not duplicated its changes or claimed its checks for this revision.

The source still differs from the retrieved published build. Full verification
has not been repeated while these causes remain unresolved. Status remains
**NO-GO**.

## Subsequent focused repairs and evidence

These are attempt-scoped results, **not** a combined full-suite pass. The
original complete run and its failures remain retained. No cases, retries,
workers, or browser budgets have been relaxed.

- `repair-round-11`: **1 PASS, 1 FAIL**, unchanged inputs. Summary notes retained
  focus and text across a claim-backed Packaging tick after supplying the
  fixture's positive cases-per-skid. The scheduled move received a valid new
  destination stamp, but its Today card counted three runs while canonical
  reads contained exactly two. The extra row was a device-local pristine blank.
- The Today card now uses the existing pristine-seed predicate to exclude that
  local placeholder from its displayed planned-run count. It does not delete
  runs, change selection, or change persisted snapshots.
- `repair-round-12`: **2 PASS**, unchanged inputs: the complete scheduled-move
  and foreground-recovery latency cases. The move asserts one planned run
  before, two after, exact canonical IDs/order, value `37`, reload persistence,
  source removal, and the exact stamp acknowledged by the destination move.
  Latency now explicitly selects its named canonical fixture rather than a
  locally selected blank.
- Production source for those results is
  `d139d086337bb3be9ccfb8e270b702c9c6af555ea80d48adb66136b02123ae4e`;
  assessed revision
  `test-sha256:da816b6fc6a798ffb08f01daaf57bfef9b03a6cec6914d804063b0f4e6f0f0a9`;
  verification fingerprint
  `e6f986e7f670abfc5d3aba28a663a529696a75ce534cddb8575646697b4c031e`.
- Root typecheck passed. The complete client unit command then exposed eight
  failures in one editor mock missing the new profile-mode getter. That mock
  is repaired; the editor save assertions include the atomic mode argument,
  with a new regression for server-backed Crust mode without legacy crust
  indicators. **32 focused unit tests in five files passed.** This does not
  relabel the earlier complete client attempt as green.
- `repair-round-13`: **all 3 required desktop WebKit smoke cases PASS**, unchanged
  inputs and the same source/assessed/verification identities as round 12.
  Actual runtime covered authentication and start/pause/resume/reload, failed
  pull recovery, and authoritative report preview. This is Linux WebKit
  emulation, not physical Safari/iOS evidence. The separately approved
  eight-case phone/tablet WebKit lane is still pending.
- `repair-round-14`: **4 PASS, 2 FAIL**, unchanged inputs. Cross-device lifecycle,
  connected department navigation, manager keyboard destinations, and the
  QC phone/tablet target/check layout scenario passed. Explicit canonical-run
  selection repaired the related fixture-selection failures without changing
  their lifecycle, authorization, or layout assertions.
- Round 14's assessed revision is
  `test-sha256:fe8242e4f19175f0bcdac3aa06eac734e81e4ec83fabd2f8c7d3d2d4cd9a409b`;
  verification fingerprint
  `5a5dad4f593f6cf59970026c0f85ee243dec883bdb6fb112e512a4201fd5492f`.
  Production source remains the round-12 source above.
- The photo fixture's placeholder Brand/Flavor TSV legitimately took the
  deterministic parser path: no structured-AI request ran and no recipe data
  existed in that source. Its intended structured-AI branch now receives
  unstructured photographed-source prose containing the mocked recipe,
  ingredients, batch pounds, case pack, and die. Existing parse-count, review,
  cancel, Apply, and ingredient assertions remain. Verification is pending.
- The remaining QC case reached its correct run, but displayed no recipe
  ingredients. Its saved profile contained only a recipe name and target,
  contradicting the component-bearing pending-run snapshot. The fixture now
  supplies matching profile/run components and a positive case pack, retaining
  both narrow QC role grants and the original allergen/layout assertions.
  Verification is pending.

### Published comparison and coordination

An authorized public build-info read at `2026-10-24T15:08:35.901Z` returned HTTP
200 and production source
`211e36b16b7ee63bc40d56e3ade3b61dd30d75f093ee04e31607f11cfde78be8`
under `production-source-v4`. It **does not match** the tested repaired source.
The runtime-reported application build remains
`app-build:3e38e309-a61b-476f-91eb-a0900b9d7398`; deployment/build IDs are not
provider attestations. A final repair revision must be identified after repairs
finish, not inferred from the main workspace's separate source match.

Read-only coordination confirmed the local-only gate and automatic partial
reporting tasks are both still proposed and depend on this certification task.
Their entrypoint/reporter implementation is not duplicated here. Immutable
attempt directories retain the original failures and subsequent focused
results; future tooling is not a prerequisite invented to excuse these failures.
No physical Android/iOS verification or new publication has occurred.
The complete Chromium rerun is deliberately deferred while known causes remain.
Release status remains **NO-GO**.

### Focused repair rounds 15–17

- Round 15 completed with **1 passed, 2 failed**. The full authenticated QC
  evidence workflow passed with matching saved-profile and run components;
  its narrow operator/manager QC grants were unchanged. Photo failures
  remained and were not counted as successful imports.
- Round 16 was an explicitly **non-certifying diagnostic build** with temporary,
  fixture-enabled, static stage messages: **4 passed, 1 failed**. Guarded Undo,
  both simultaneous/offline multi-device convergence workflows, and photo
  review cancellation completed. The remaining photo Apply stopped at the
  mandatory server-atomic safety review, not an unbounded network save.
  Temporary application/test tracing was removed before round 17.
- Round 17 returned to production source
  `d139d086337bb3be9ccfb8e270b702c9c6af555ea80d48adb66136b02123ae4e`,
  assessed revision
  `test-sha256:24d14345e36cf6b1863716520a4b9434c8add36a7183d8f98678213a1bbac0f1`,
  verification fingerprint
  `e022937f626ece412e99fd9f7db05b465857b477e1b3ee689851af6935caf370`.
  It completed with **6 passed, 5 failed**, with unchanged inputs.
- Round 17 passes: photo cancellation, authenticated profile/recipe Apply,
  full multi-ingredient dough Apply, sauce Apply, active-date diagnostic
  export across midnight, and real-tab Warehouse switchover. Photo Apply now
  explicitly opens and confirms the safety review and requires HTTP 200;
  neither direct API submission nor silent approval substitutes for it.
- Warehouse initialization now uses the existing authorized disposable
  canonical-snapshot fixture. Ordinary client operational writes remain
  fenced. The original live tab-navigation assertions and cleanup remain.
- Diagnostic export permits genuine additional active-day log events, while
  requiring every exported event to have the active date, the expected
  fixture event exactly once, no prior-date fixture, and no writes.
- Remaining round-17 failures: two incident-navigation checks use the obsolete
  `Diagnostic reference:` label rather than `Incident reference:`; the workbook
  check selects a removed truncation CSS class; cheese Apply receives the
  intentional `STALE_REVIEWED_STATE` HTTP 409; and a partially normalized
  intermediate field-check assertion was inconsistent. Corrections are
  pending focused verification, not passes.
- The field-check correction restores exact before/after detail comparisons
  under the already-fixed browser Date; observations are not filtered out.
  The cheese fixture must follow the visible stale-review notice and make one
  fresh, explicitly confirmed review, still requiring a successful save and
  all original persisted ingredient weights.
- Publishing-service metadata independently confirms a successful, public
  Autoscale deployment at the previously verified URL. This does not attest
  that its runtime source equals this fork. The source comparison above
  remains negative.

Each round retains its attempt/result metadata, logs, and browser artifacts in
its own ignored evidence directory. Failed and diagnostic rounds remain
labelled as such. No complete Chromium rerun, responsive eight-case WebKit
runtime result, physical-device result, or publication is claimed here.

### Focused rounds 18–21 and paused verification

- Round 18: **3 passed, 2 failed**. Exact field-check comparisons and both
  incident-reference navigation checks passed. Cheese Apply and the real
  workbook parse remained failed.
- Round 19: **3 passed, 12 failed**. The paired-run timer/default workflow,
  photo cancellation, and Android-style cookie-session reopening passed.
  Android-style browser execution is emulation, not physical-device evidence.
- The import-review application repair preserves edited details when only
  the server comparison changes, while clearing the destructive-change
  acknowledgment. A new parsed source still resets the review. Its focused
  component checks returned **52 passed**; this does not establish successful
  browser Apply.
- Bounded provider diagnostics now retain a wrapped upstream HTTP status or
  allowlisted network code without retaining messages, request bodies, URLs,
  headers, or credentials. The related API checks returned **25 passed in
  3 files**. The root typecheck also passed.
- Round 20 stopped during collection because a fixture imported a nonexistent
  named helper. **No browser cases executed.** This is a bootstrap failure,
  not ten failed browser cases or a browser pass. The import was corrected.
- Round 21's collection preflight found **13 cases in 6 files**. Collection
  was not counted as runtime evidence. The subsequent native Chromium run
  completed with **5 passed, 8 failed** and unchanged inputs:
  - production source:
    `5cb33b38a59762a9a33a03afbeb46c98caf9349c2d232aa7a61586b938750ac8`;
  - assessed revision:
    `test-sha256:431056697813ec306ff39f4c3152f4f38dcacea2790fb164904b197dc187b673`;
  - verification fingerprint:
    `04a8eaba872623c03c96181151d170716fae35f1204fb7722eef44274bb0dfe1`.
- Round 21 passes: shared live/setup recipe pickers, brand-alias persistence,
  scope-preserving flavor-ignore Undo, photo cancellation, and explicit
  stale-Home-chunk PWA recovery. Stale-chunk recovery used authenticated safe
  fixture evidence; application reload protection was not bypassed.
- Remaining round-21 failures: second-manager alias availability, all four
  photo Apply cases, both automatic PWA handoffs, and the real workbook parse.
  The last workbook failure was a normalized application HTTP 502 whose
  bounded causal diagnostic identified upstream **HTTP 400**.
- After round 21, the photo helper's circular readiness condition was removed:
  it had waited for Apply to become enabled before checking the acknowledgment
  that enables it. A fresh epoch header was also added to the remaining alias
  seed. **These two narrow fixture fixes have not been browser-verified.**
- Separate, bounded synthetic diagnostics classified the selected primary's
  HTTP 400 as a model-availability rejection. Requests selecting the already
  configured `gemini-3.5-flash` and `gemini-3.1-flash-lite` backups returned text.
  The response shim did not attest an actual provider model identity. These
  synthetic results prove neither real-workbook readiness nor release
  certification. No primary, fallback list, routing predicate, or token limit
  was changed as a result.
- Verification is paused rather than launching another cohort after repeated
  failures. The pending decision is whether to authorize a narrowly classified
  model-unavailability HTTP 400 to advance through the existing fallback
  ladder, with regression/cache checks and one real-workbook verification,
  or leave that route unchanged and its dependent gate blocked.

Round 19 artifacts were archived before later attempts; round 20 retains its
bootstrap log and explicit zero-execution assessment. Round 21 retains its
attempt/result records, private browser log, failure traces/screenshots, and
separately labelled synthetic diagnostic records. None replaces the original
complete failed run.

The last retrieved published source remains different from the tested source;
no newer matching publication is assumed. The required complete Chromium
rerun, final-source WebKit evidence (including the approved responsive
eight-case contract), and remaining standard/full gates are still pending.
No physical Android/iOS result or publication is claimed. Task work remains
incomplete and release status remains **NO-GO**.
