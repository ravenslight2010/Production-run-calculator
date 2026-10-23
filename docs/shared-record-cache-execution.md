# Shared record cache migration — execution evidence

## Scope and owner

The assigned task agent owns profiles, factory templates, completed history,
their read consumers, legacy migration, recovery preservation, and verification.
The approved design is authenticated server reads into observable memory;
only unsent payloads, unresolved migration/conflict evidence, and active-run
recovery remain durable. No retention change, production write, deployment,
new preference service, or server undo is authorized.

## Inventory and verification matrix

Cover dough/crust profiles, revisioned templates/tombstones, immutable completed
snapshots, legacy unscoped and scope-only records, malformed JSON/envelopes,
non-OK/network failures, offline cold/warm loads, reconnect, delayed responses,
newer edits during delivery, account/logout/live/sandbox transitions, canonical
conflicts, interrupted migration, equal page-boundary sort keys, and reset/undo.
Retain current day/run values, sync intents, inventory commands, import evidence,
completion/attestation queues, legacy undo evidence, device navigation, cast
identity, offline application files, and existing account-owned preferences.

Desktop, phone, tablet portrait and landscape: Chromium and WebKit emulation
required for changed reads/recovery. Physical Android/iOS/PWA: not run (no
physical-device service); native apps: not applicable. Browser evidence must use
synthetic isolated accounts and records, never production data.

## Failure ledger

| Finding | Status | Owner / next action |
| --- | --- | --- |
| Mutable profile-cache payloads at delivery; delayed GET overwriting a newly acknowledged edit | FIXED | Self-contained payload/revision and generation/stamp fences; profile sync regressions |
| Scope-only template queues could acquire another account | FIXED | Authenticated identity outbox; unverified legacy queues remain review-only |
| Persistent history and daily-sync archive publishing | FIXED | Memory reads, completion-only outbox, bounded API pages, outgoing transport omission |
| Old pending intents and acknowledged baselines could recreate full archive persistence | FIXED | New intent baselines/payloads omit archive; legacy unsent payload archive preserved separately before replay |
| Bootstrap responses malformed/non-OK, stale identity, or cyclic page cursors | FIXED | Unavailable status without empty-result adoption; identity fences; cursor-cycle detection |
| Migration retirement could discard unknown legacy properties | FIXED | Conservative structural matching; unknown fields/extra run values remain review evidence |
| Profile quota fallback was memory-only without a visible warning; failed completion queue writes | FIXED | Explicit keep-open warning; new completion enqueue fails explicitly if recovery cannot be saved |
| Seed helper could recreate unscoped profiles after logout | FIXED | Same authenticated reconcile/generation boundary; no raw read-cache writes |
| Initial focused fixtures assumed permanent caches, unauthenticated writes, and ownerless auto-migration | FIXED | Fixtures now specify authenticated ownership and self-contained queued payloads |
| First focused run: 18 failures of 64; next expanded run: 6 of 83 | FIXED | Fixture/cache contract assumptions, scoped queue keys and Response headers corrected; final focused run green |
| First broad calculator run: 9 failed, 3,479 passed, 1 skipped | FIXED | Subtab/source assertions, import/stale-template ownership, migration fixture signatures/keys and suppression-ref fixture repaired |
| Dough suppression fixture used the packaging suppression ref | FIXED | Test uses dough suppression ref; production timing/math unchanged |
| API cursor unit fixtures expected throws instead of null (3 failures) | FIXED | Assertions match the parser's explicit invalid-cursor result |
| Pagination fixture used `items` instead of `history`; route-test JSON inferred unknown | FIXED | Correct contract and typed response; stable page test passes |
| Disposable PostgreSQL daemon died after its parent shell; connection refused | FIXED | Dedicated tracked foreground process with private socket; all subsequent DB checks isolated |
| Fixture role query referenced nonexistent `roles.id` | FIXED | Correct named-role relationship; only synthetic local account promoted |
| Initial browser sign-in returned 401 because its synthetic manager did not exist | FIXED | Real signup plus local-fixture-only role assignment; resumed the same tester |
| Managed artifact workflow override rejected twice | FIXED | Used validated artifact configuration replacement; original configuration restored before handoff |
| pnpm auto-provision recursion caused incidental workflow failures | WORKSPACE WORKAROUND | Pinned Node/native pnpm used; successful named checks below supersede failed incidental workflows |
| Summary expansion crashed on missing legacy applicator type (`trim`) | FIXED / PASS | Unknown slot skipped without invented ingredient data; regression passes; responsive Chromium follow-up expanded the history group successfully |
| Summary nested-button warning | FIXED | Expand and CSV actions are sibling buttons; affected web typecheck |
| Responsive reconnect drained template/completion queues but did not automatically kick profile delivery | FIXED / PASS | Independent authenticated profile lifecycle retries on online/focus and a bounded poll; regressions and genuine WebKit automatic reconnect pass |
| Tester context factory requested WebKit but returned Chromium | RESOLVED BY LOCAL FALLBACK | That runner is not WebKit evidence; genuine installed WebKit verified all four required viewport journeys separately |
| Initial local WebKit fallback failed at dynamic fixture module import | RESOLVED FIXTURE | Absolute module imports and offline preinstalled local runtime reached the assertions; four genuine WebKit viewport journeys pass |
| Local retry fixture's serialized callback referenced tsx `__name` helper | FIXED FIXTURE | Test-only helper supplied in the browser evaluation realm; no application/runtime workaround |
| Outage fixture awaited rejected template GET in `Promise.all` | FIXED FIXTURE | Expected injected 503 now awaited with `allSettled`, matching the app's Retry handler; no swallowed success assertion |
| Reconnect retry reached a 400 for fixture ISO lifecycle strings | FIXED FIXTURE | Run lifecycle uses numeric epoch milliseconds; fixture now follows the existing completion boundary |
| Legacy orphan cleanup could replace an owned pending profile upsert with a delete during reload | FIXED / PASS | Cleanup skips owned pending writes; exact payload/queue regression and four WebKit reload/reconnect journeys pass |
| Editing source comments during the browser retry caused HMR identity reset | RESOLVED VERIFICATION INTERFERENCE | No application edits during the next browser attempt; inactive old fixture module instances do not count as recovery assertions |
| Dev update banner could not confirm an update; HMR/session reload and generic 401/403/404 console diagnostics | BOUNDED | No forced update/cache wipe; three target authenticated reads/retry returned 200; unreported request paths cannot support endpoint-specific claims |
| Final local startup emitted performance-budget warnings (about 1.6–1.8 seconds) | BOUNDED DEVELOPMENT OBSERVATION | Functional requests and four WebKit recovery journeys passed; this assignment makes no latency/release-certification claim |
| File-path searches and patch-context mismatches during editing | RESOLVED | Inspected actual locations/context; successful patches, typechecks and clean diff follow |
| An unauthenticated probe of `/api/health` returned 401 | RESOLVED PROBE ERROR | Correct public readiness endpoint `/api` returned 200; not counted as an application failure |
| Completion sync with newer main stopped on template regression-test conflicts | RESOLVED / PASS | Preserved incoming timeout/teardown coverage and authenticated memory/recovery cases; 30 merged template tests pass; regenerated and verified API output from the combined OpenAPI instead of retaining an auto-merged generated deletion |
| Completion review found history/current-day CSV header widths reversed for provenance | FIXED / PASS | Shared row assembly keeps history's 15-column provenance header with its values and current-day rows at 14 columns; seven empty/canonical/pending/mixed and Home-wiring regressions plus web typecheck pass |
| First CSV source-wiring test used a filesystem URL in the jsdom URL realm (1 of 7 failed) | FIXED FIXTURE | Pure export contract suite now uses Node and the artifact-relative source path; six row/provenance cases already passed before this fixture correction |

## Results

Implementation and required automated/browser-emulation verification are
complete. Initial blocked or not-reached attempts remain in the failure ledger;
their resolved status is based on the subsequent genuine WebKit results, not
on relabelling Chromium as Safari. Physical-device checks remain explicitly
not run and are not inferred from emulation.

## Implemented read and recovery boundaries

- Profiles: observable authenticated memory, server precedence over acknowledged
  reads, payload/revision-owning recovery queue, force/delete/tombstone handling,
  and fences for both in-flight writes and reads.
- Templates: shared canonical factory service, observable memory, account-owned
  save/delete intents, canonical conflict/tombstone rules, post-ack refresh,
  scoped peer invalidation and focus/online/poll recovery.
- History: immutable server records through `limit`/opaque cursor/date queries.
  Client follows explicit pages, retaining all available history rather than
  deleting rows or imposing a silent archive cap. Ordering is `(date, runId)`;
  equal completion timestamps do not move or skip page boundaries.
- Historical display/recall read the memory projection and label unacknowledged
  local completions. CSV labels record provenance. Insight inputs exclude
  pending completions and refresh canonical history. Operational signed reports
  retain their existing server authority; this CSV is not a signed report.
- Daily sync neither publishes nor adopts a browser archive. The central writer
  also strips legacy history after rebase. New durable active-sync baselines
  omit it. Previously persisted, owned unsent history is review evidence, never
  a live read directory or automatically reassigned upload source.
- Legacy reconciliation is idempotent per entry: verified owned recovery first,
  retire only structurally matched canonical copies, preserve malformed,
  divergent and unowned records. Download is review-only, not an Apply action.
- No schema/retention change, production repair, preferences service, or server
  undo implementation. Existing live-authority and guarded-undo tasks already
  own those separate outcomes; no new follow-up split is proposed here.

## Retained durable namespaces and device state

Recovery inventory includes scoped profile operations/stamps, authenticated
template outboxes, completion/conflict outboxes, legacy daily-sync review,
applicator evidence/attestation recovery, sync pending intents, operational and
inventory intents, import/source evidence, and old undo evidence. Current day/run
settings remain the existing active-run recovery exception. Authorized run/day
reset semantics are unchanged; migration and legacy master-data Undo cannot
recreate retired read keys or erase the protected unsent/evidence namespaces.

Device tabs/subtabs, cast/client identity and offline application files have not
moved to an account service. Per-profile navigation no longer writes profile
metadata. Notification preferences and Floor Mode remain existing account-owned
server preferences. No acknowledged profile/template/history directory is
introduced in another localStorage namespace, IndexedDB, service-worker cache,
or persisted query cache. Synthetic browser inventory found no such copies.

## Verification results (2026-10-23)

| Check | Result | Bound |
| --- | --- | --- |
| Full calculator suite | PASS: 3,488 passed, 1 skipped, 372 files | Coherent migration before final narrow safety repairs |
| Final affected calculator regression set | PASS: 177 tests / 15 files | Profiles, templates, history, auth races, pending sync, source contract, imports, device subtab, suppression fixture |
| Reconnect repair regression and final web typecheck | PASS: 38 profile-sync tests; web noEmit | Adds automatic online retry, lifecycle cleanup and old-identity fencing; earlier unaffected passes remain valid |
| Final recovery/legacy cleanup repairs | PASS: 51 tests / 3 files; web noEmit | Profile sync, orphan cleanup and shared migration; exact owned queue/payload preservation |
| Integrated main-tree verification | PASS: 30 template tests; shared/web/API typechecks; `check:api-generated` | Incoming real-abort deadlines, all-scope teardown and late-commit/read recovery remain covered alongside authenticated ownership; merged OpenAPI generated without dropping newer main contracts |
| Completion-review CSV repair | PASS: 7 tests; web noEmit; clean diff | Both actual export actions use tested column assembly; no history provenance column leaks into current-day rows |
| Completed history / scoped API integration selection | PASS: 44 tests; 340 intentionally unselected | Disposable DB; canonical completion, stable pages, sync protection, template/role/preferences paths |
| Isolated sync convergence | PASS | Repository isolated runner; 26,195 ms; independent disposable fixture |
| `check:api-generated` | PASS | Generated API artifacts and six declaration checks |
| `typecheck:libs` | PASS | Shared generated dependencies |
| API package and route typechecks | PASS | Package build/noEmit and separate route check |
| Affected web typecheck | PASS | No emit |
| `git diff --check` | PASS | No whitespace errors |
| Chromium desktop functional verification | PASS with repaired Summary detail covered by targeted regression | Reads, unavailable/retry, all three owned pending queues across reload/reconnect, canonical readback, conflict review, legacy non-upload, peer updates, live/sandbox/live |
| Chromium phone/tablet portrait/tablet landscape | PASS: directory outage/retry, durable pending reload, canonical readback and storage inventory | 390×844, 768×1024, 1024×768; exposed automatic profile reconnect trigger gap, repaired and unit-verified above |
| Genuine WebKit functional matrix | PASS: four viewport journeys | 1440×960, 390×844, 768×1024, 1024×768; unavailable/retry, owned pending reload, automatic reconnect, canonical readback and absent targeted read-cache keys |
| Physical Android/iOS/Safari/PWA | NOT RUN | No physical-device service; emulation is not physical proof |
| Native apps | NOT APPLICABLE | Explicitly outside scope |
| Release certification / production publish | NOT RUN | Outside assignment; no production data writes or purge |

Browser evidence uses only synthetic accounts and records in an isolated local
PostgreSQL fixture. No cookies, session tokens, real account credentials, HARs,
production rows or raw payloads are retained in this document. Browser 503s and
the deliberate immutable 409 were injected negative cases, not unnoticed
successful requests. Completion reconnect acknowledgement was corroborated by
canonical API readback and an empty owned outbox; the exact POST response was not
captured in that browser window.

The owner requested the remaining browser checks rather than waiving them.
The same Chromium tester completed the three responsive journeys and verified
the repaired Summary expansion. Its initial reconnect observation led to the
profile lifecycle repair. The genuine local WebKit follow-up then verified all
three queues drain through the normal `online` event without direct flush calls
or identity rebinding, at all four requested viewport sizes. Its fixture used
numeric lifecycle timestamps, matching the completion boundary, and blocked
service-worker registration to isolate network-failure assertions; this is not
an installed-PWA/offline-application-file certification.

Sanitized local WebKit result log:
`/tmp/replit-background-tasks/695af923-963d-404c-b9c3-93b91799f267.log`.
The successful run reports `WEBKIT_GAP_PASS 4 viewports`.
Screenshots and the disposable fixture script are ignored generated evidence,
not application source, a production export, or publish input.

The local fixture's temporary artifact run command must not ship. Restore the
original managed configuration; this restoration has been completed and checked.
No disposable connection settings remain in the artifact configuration. Final
web preview and public API readiness returned 200, and workflow startup was
clean. The fixture is development verification only, not deployment proof.
