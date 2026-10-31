# Guarded master-data Undo

## Contract and eligibility

The API server is the source of truth. A single manager-authenticated, scoped
transaction plans a supported master-data change, writes its canonical
mutations and typed receipt, and advances the scope's master-data epoch. A
failed mutation, evidence write, authorization check, or transaction commits
neither the change nor an undoable receipt. Repeating the same operation ID
and command is idempotent.

The typed command categories are brand, flavor, applicator, pepperoni type,
die type, ingredient and its supported recipe-specific categories, plus dough,
sauce, cheese, and mix recipes. The supported actions are add, remove, rename,
merge, and the supported recipe-category move. The command parser, planner,
and evidence allowlist define the exact accepted fields; they do not accept
client-supplied before/after snapshots.

The planner records changed rows from the fixed master-data tables and only
the owned directory entries and references involved in the command. It also
captures exact eligible pending run-value/metadata references and existing
profile/template references. Ingredient links use canonical IDs when present;
an ID/label disagreement or ambiguous link requires manual review. A merge
retains the target's existing values, and a move preserves native row units
and identifiers.

Undo is eligible only if every recorded entity and reference still matches
the recorded after-state guard and no protected dependency has appeared.
Started or finished runs, completed-run history, inventory associations,
nonzero mix-accounting quantities, unsupported reference forms, and
unreviewable unit conversions are protected. A protected action is recorded
as unavailable with a bounded reason; it is never presented as successfully
undoable. A later dependency edit returns a conflict and changes no entity.
Conflicts can be rechecked only after a manager reviews the later work.

Undo restores the exact recorded entity and reference facts in one
transaction, advances canonical versions/tombstones instead of restoring old
clocks, records the undo actor/time, advances the epoch, and emits the normal
canonical invalidations. It does not restore live counters/timers, whole
day-state documents, old read caches, inventory, or completed history.
Managers can read bounded, scope-fenced history and undo from another signed-in
manager session. Current account validity, token-backed session, role,
capabilities, and scope are checked again inside the transaction after locks
are acquired.

Import-operation and profile-data-health compensation continue to use their
own guarded protocols. The shared history offers links to those owner flows;
it does not issue a second compensation. Arbitrary API edits, recipe-content
editing, transient form/navigation edits, offline operational commands,
completed history, warehouse/accounting, and external side effects are not
new generic undo actions.

### Evidence, history, and legacy limits

- The ledger stores typed facts, references, actor ID, server timestamps,
  operation identity, command/evidence fingerprints, status, and bounded
  conflict information. It does not store browser snapshots, passwords/PINs,
  session tokens, auth state, arbitrary local-storage keys, or operational
  recovery queues.
- Reads are paginated (20 entries per page, at most 50 per request). Planning
  bounds the canonical row/date scan, aggregate world bytes, and individual
  fact/reference evidence; malformed, oversized, unsupported, or secret-field
  evidence fails closed.
- The ledger has no new automatic expiry or production purge. Existing server
  retention policies remain in force.
- New browser history contains session-only metadata, not before-snapshots.
  Old device-only history is projected to bounded metadata and labeled
  legacy-only; its before-data is never uploaded or executable. A manager may
  explicitly discard that browser's legacy history only after a confirmation
  and an online, capability-checked history request. That action removes only
  the legacy history key and leaves other local state and server history alone.
  Cancelled or offline resolution retains the original evidence.
- Offline history is marked unavailable and disables Undo. A conflict or
  failed confirmation is not displayed as a successful compensation.

## Verification

Only development schema changes were applied with the additive
`@workspace/db` push command. Integration tests construct and drop their own
disposable databases; the browser suite uses the isolated PostgreSQL harness.
Production schema changes, production data repairs/purges, and publishing
were not part of this work.

| Area | Result |
| --- | --- |
| API/server TypeScript, including route typecheck | PASS |
| Calculator TypeScript, Vite config, and maintained-cast budget | PASS |
| OpenAPI client/validator code generation and generated-output check | PASS |
| Guarded planner, directory-fact and transactional API tests | PASS — 100 tests across six files, including rollback/retry, cross-manager restoration, reference edits, dependency conflicts, fresh authorization, limits, and full-snapshot protection |
| Focused client tests, including legacy resolution and station read-only boundaries | PASS — 148 tests across nine files. The expanded run passed 147 initially; the stale source-anchor check was corrected and all 16 tests in that file passed on rerun. |
| Existing import-operation, profile-repair, alias and ingredient-related regressions | PASS — included in the six-file, 100-test API run |
| Browser journey | PASS — 8/8 isolated projects, with no retries: desktop, phone, and tablet portrait/landscape in Chromium/Chrome and WebKit/Safari emulation. Final run: 7.6 minutes; disposable database cleaned up. |
| Physical Android Chrome, iOS Safari, and installed PWA | NOT RUN — no authorized physical-device/PWA session was available in this workspace. Browser emulation is not physical-device or installed-PWA certification. |
| Native mobile applications | NOT APPLICABLE — excluded from this task. |
| New dependency-container regressions | PASS — 72 tests across three focused API files on disposable local PostgreSQL, including six new later-reference cases; the API compiler check passed. Profile values/crust values, template values, pending-run values and nested ingredient rows conflict without partial canonical changes. |
| Signed-in preview screenshot | Not captured through the preview tool, which only sees the unauthenticated login page. The isolated authenticated browser journey is the verification for the protected screen. |
| Full release/publish gates | NOT RUN — this task does not request publication. |

After synchronizing with main, generated validators were regenerated from the
merged specification rather than hand-merged. Both station read-only regression
boundaries were preserved: all 16 station-boundary tests and six validator tests
passed. Shared-library declarations were rebuilt and the final calculator
compiler check passed. The eight-project browser result and 100-test API result
above belong to the completed task tree before that sync; the browser matrix was
not repeated for generated-file/test-only conflict resolution.

## Failure and recovery ledger

These are concrete verification/tool failures observed during this task, and
their status:

| Failure | Evidence and recovery | Final disposition |
| --- | --- | --- |
| The first expanded API test run had one failure: the evidence-size case used a helper that expected a valid preview rather than testing the intended rejection. | Sent the oversized command to the route directly and asserted its bounded-evidence `400` response. The expanded API suite subsequently passed. | RESOLVED |
| Six profile-sync tests initially used fake `Response` objects without the `headers` interface required by canonical epoch reads. | Updated the response fixtures to include real `Headers` objects. Calculator typecheck and the focused client suite passed afterward. | RESOLVED |
| API typecheck found that JSON directory categories are `unknown`, not a statically typed array. | Added runtime `Array.isArray` checks before category membership tests. API typecheck passed afterward. | RESOLVED |
| The system `pnpm` bootstrap retried installing the workspace pin and exhausted available process slots before some checks started. Concurrent release-runner lock waits also caused individual attempts to stop before running the check. | Provisioned the exact `pnpm@12.8.1` in the existing ignored `node_modules/.bin` search path and verified its version. Retried via the pinned Node/release runner: `check:api-generated`, additive development schema push, both application typechecks, and focused API tests ran. | RESOLVED for the focused commands; the full configured release workflow remains out of scope and was not treated as passing. |
| A first frontend check showed the history UI did not accept the explicit permission state supplied by its parent. | Added the capability prop and disabled unsafe retry controls unless current inventory/profile permissions are present. Calculator typecheck passed afterward. | RESOLVED |
| The initial browser-review helper could not return a result in the current environment. | Continued in this session with a directly maintained isolated Playwright matrix and verified its test setup. | RESOLVED by direct verification; no delegated test result is claimed. |
| The initial browser accounts exceeded the sign-up username limit. | Shortened the project-name prefix while preserving independent, randomized test identities. Later runs passed sign-up and reached cross-device Undo. | RESOLVED |
| A targeted browser invocation supplied a repository-relative config path to a command already running from the calculator package directory. | Retried with the package-relative config name. The failed setup cleaned up its disposable database and was not counted as a browser result. | RESOLVED |
| The browser fixture reported a stale brand after Undo even though the device received a canonical directory with an advanced version and no such brand. | The locator also matched the retained operation in the history embedded in Settings. Scoped editable-row checks to the exact brand button, separately retaining the history and canonical-version assertions. | Fixture corrected; final matrix result is recorded above. |
| Initial phone confirmation probes measured a scrollable dialog action before scrolling it into view. | Applied the established viewport-safety procedure: scroll the action into view, then verify its numeric bounds remain within the viewport. No application dialog style was changed for this fixture issue. | Fixture corrected; final matrix result is recorded above. |
| After workspace resume, the ignored pnpm link survived but its external npm cache target did not. | Stopped the recursive bootstrap before tests started, reprovisioned the unchanged pinned pnpm version, verified its executable, and explicitly prepended the workspace tool directory for validation. | Runtime repaired; subsequent check results are recorded above. |
| The expanded client run passed 147 of 148 tests; the station-display source check sliced from a comment removed by the shared-record migration. | Anchored the check to the actual profile repository subscription and asserted both its current screen/identity guard and its reconciliation call. No runtime guard was changed. | Corrected check; rerun result is recorded above. |
| The desktop browser journey reached offline legacy resolution, then its toast locator matched both the title and its accessibility announcement. | Used exact title locators for failure and success notifications. The retained-evidence, unrelated-work, and no-upload assertions remain in the journey. | Fixture corrected; final matrix result is recorded above. |
| After the desktop journey passed, the phone action was genuinely wider than the viewport even after scrolling (524-pixel action in a 390-pixel viewport). | Confined the fix to the guarded confirmation: a viewport-inset width, zero-minimum grid track/children, anywhere wrapping for long operation names, and wrapping action labels. Kept the bounds assertion unchanged. | Layout corrected; final matrix result is recorded above. |
| The managed development API workflow initially timed out during schema introspection, before opening its port. | Diagnosed the startup stage rather than changing ports or bypassing schema protection. A read-only development database probe succeeded; one controlled retry completed the normal schema protection/build/start sequence, listened on port 8080 and reported startup ready. | RESOLVED — no startup policy or production schema changes. |
| The corrected phone dialog passed its viewport checks, then a second Add was ignored while the prior canonical refresh still held the mutation guard. | Disabled the maintained Settings content while a guarded mutation/refresh is busy, preserving the existing directory-readiness fence. The browser helper waits for enabled input and the new canonical row before continuing. Bounded response/action waits now give an actionable failure instead of consuming the entire journey timeout. | Busy-state boundary corrected; final matrix result is recorded above. |
| The development startup reported an unavailable identity-sequence health diagnostic and existing-record master-data health findings after reaching ready. | These are not proof of an Undo failure or permission to repair stored source facts. No automatic data heal was added. The isolated Undo suites use owned fixtures rather than claiming the development dataset is clean. | NOT REPAIRED under this task's data boundary. Accountable owner: manager/Data Health maintainer. Next action: review the bounded canonical health findings and diagnostic availability before approving any source-data repair. |
| The combined log feed also surfaced published-runtime dependency connection/time-out failures in background jobs, push scheduling and outbox retries. | This feed is not the unmerged Undo build or isolated test evidence. No production query, schema change, worker alteration or cleanup was performed for it. | NOT ASSESSED as a production incident in this task. Accountable owner: production operations maintainer. Next action: an authorized, revision-bound reliability investigation; this document makes no production-readiness claim. |
| Completion synchronization stopped on generated validators, station-boundary tests and package-manager memory. | Regenerated validators from the merged OpenAPI contract, retained both station-boundary assertions, and preserved the incoming supported runner guidance plus the resumed-cache lesson. The focused merged suites passed (16 station tests and six validator tests). | RESOLVED — no compensation behavior was discarded or intentionally changed. |
| The first post-sync calculator check reported 52 missing/unknown shared-type errors with older declaration outputs. | Rebuilt the current workspace shared-library declarations before diagnosing application source; no source casts, suppressed errors or compatibility fallbacks were added. | RESOLVED — final compiler check passed. |
| The supported precheck rejected the ignored development stage-start record after main changed the source policy. | Refreshed only the local development build-stage identity under the current policy. Preserved staged publish records and source-validation guards; did not prepare a publish. The Vite configuration checks then passed. | RESOLVED |
| A five-minute combined precheck/typecheck command expired without a subsequent compiler error. | Checked that no orphan compiler remained, then ran the unchanged final compiler step alone with a bounded longer deadline. Runtime provisioning was observed separately from compiler execution. | RESOLVED — isolated final compiler command exited zero. |
| Completion review found that a profile added after a rename could reference its target only in `crustValues` and escape new-dependency detection. | Included both canonical profile value containers in dependency membership. Added six conflict/no-partial-change cases covering profile values and crust values, template values, pending-run values and nested ingredient references. Rechecked the separate recipe-component, alias-context, immutable-history and inventory guards; no additional supported container omission was found. Condensed the package-manager memory to durable guidance. | RESOLVED — 72 focused API tests and the API compiler passed; disposable database fixtures were cleaned up. |
| A later main sync conflicted only in package-manager guidance; completion's unchanged `bash scripts/src/run-release-node.sh pnpm run typecheck` then exited 134 in the native manager before the TypeScript API check started. | Combined both guidance updates. Process ancestry identified the older system manager recursively installing the pin during API workflow startup, consuming the process/thread budget. Stopped only that failed workflow and restored the ignored workspace executable from the canonical runner's verified native 12.8.1 tool; checked byte identity and direct child-process execution. No package pin, lockfile, TLS guard or application source was changed. | Environment repaired; the unchanged configured gate is retried by completion validation, whose final result is retained with the task. |

No unresolved failure may be converted to a pass in the final task report.
Record the browser-matrix result and the final focused client-test result here
before closing this task.
