# Frontline supply and recovery repair evidence

## Scope and ownership

This repair owns current Frontline batch supply, update document handoff,
terminal lifecycle rejection, recovery status, and shared run-transition
recovery. Packaging hold/Resume and the split station timer remain independently
owned; do not replace their policies. No production writes or data heals are
authorized. Existing cumulative and pounds registers must remain readable.

## Evidence boundary

Checks below used the modified working tree based on `bc3e4d6aa`, with local
verification on October 22–23, 2026 (UTC). Operational browser fixtures used a
disposable PostgreSQL database and synthetic records, not shared development or
production data. Original operator captures remain private; no account identity,
session, operational payload, or raw private screenshot is reproduced here.

The post-review pepperoni restoration was checked after the initial completion
checkpoint, protected by local reference
`recovery-baseline-frontline-pepperoni-20261023`. Recovery audits before and after
selective restoration both reported 9 pass, 1 intentional difference, 0 missing.
Only the separate pepperoni controls were restored; the applicator pounds panel
was intentionally not restored.

The operator's October 22 Chrome cards identify
`app-build:41cba856-4ec7-404f-b4ef-7cb77a9484be`. An authorized, bounded deployment
inspection around October 23, 02:05 UTC identified a different currently serving
build, `app-build:bee65f3c-7607-4179-9172-6c391e7cab8b`. Available historical logs
did not explain the older validation request. Current-serving observations are
not evidence of what that earlier build or request did.

## Accounting contract

- The ticker is current pounds on line divided by a **known** batch weight.
  Internally retained pounds fields provide compatibility, not a pounds-entry
  panel. Unknown weights show an explicit Setup notice instead of invented
  batches. Empty applicators do not acquire a supply row.
- Still to make is stable full-run demand minus consumed pounds minus current
  supply, once each, divided by batch weight. Existing 20-pound run-buffer and
  fractional final-batch rules are retained. The two-batch bound limits active
  staging, not lifetime production.
- A distinct consumed-pounds ledger prevents repeated replenishment from
  resetting consumption. A missing legacy ledger can be baselined only from a
  valid cumulative register and known weight; neither legacy register becomes
  current stock. Historical fields remain readable and are not deleted.
- Manual supply changes do not consume product. Acknowledged corrections rebase
  the same run's stock and batch anchors/generations, not other stations. Legacy
  three-mutation stock claims remain readable; the server calculates depletion.
  Old incompatible batch claims conflict safely rather than becoming retryable
  validation errors.
- Pepperoni is not an applicator batch recipe. Its four existing load controls
  remain separately editable in pounds, with grouped peer locks, combined-mode
  visibility and run/ingredient-scoped in-memory draft retention.

## Failure ledger

| Observation / defect | Final local status | Evidence and limit |
| --- | --- | --- |
| Terminal lifecycle rejections could be retried unchanged | **PASS after repair** | Direct helper, row and bulk paths refuse terminal rejection; retained work points to correction/review. Recoverable failures retain explicit retry. Outbox/rendered tests passed. |
| Frontline presented pounds controls and capped lifetime batch progress | **PASS after repair** | Batch-unit current-supply rows replace the pounds panel; stable demand and a separate consumed ledger allow full-run replenishment. Shared math, four-slot canonical tests and the two-tab browser journey passed. |
| Tiny floating-point remainders could leave residual demand | **PASS after repair** | Numeric dust is normalized in shared staged-supply arithmetic; fractions remain fractions. |
| Manual batch correction omitted a required historical register | **PASS after repair** | Correction preserves the unchanged cumulative register and includes compatible section baselines. Generated contract check, canonical section tests and browser acknowledgement passed. |
| Packaging's browser suppression affected unrelated stations | **PASS after repair** | Suppression is case-channel-only. Canonical regression advances Dough, Sauce and Frontline while Packaging's corrected case claim remains fenced. Packaging hold policy itself remains independently owned. |
| A failed prior-run claim could appear to prevent a new run tracking | **PASS for controlled regression; MISSING published cause** | A tracks, a deliberately mismatched A claim rejects, A ends, B pauses/resumes and advances after eligible cadence; delayed A claims cannot mutate B or A. Hook tests also protect a run switch during acknowledgement. Browser B gains canonical supply after one accepted Start, without refresh. |
| Lifecycle reportedly required refresh and a second click | **PASS for local journey; MISSING published cause** | One Start, one Stop, and one next-run Start reconcile normally in four browser projects. No repeated refresh/button sequence is used as a workaround. |
| Successful snapshot refresh could imply an unsaved edit was saved | **PASS after repair** | Refresh notice distinguishes received snapshot from confirmed edits. Conflict drafts and write fences remain; HTTP 409 guidance requests review, not blind retry/reload. |
| Request timeout bounded headers but not a stalled response body | **PASS after repair** | Deadline covers the complete read; abort/timeout tests cover body stalls. Existing deadline was not increased. |
| Hidden/offline requests could outlive the useful wake attempt; repeated wake could extend retries | **PASS after repair** | Obsolete wake work is cancelled and visible/reconnect/manual attempts coalesce without refreshing an in-flight retry budget. Scope/reset/disposal tests passed. |
| Inventory intent ordering used locale-sensitive ordering against the wire contract | **PASS after repair** | Client uses deterministic code-unit ordering; contract regression passed. This is not proven to be the screenshot's rejected field. |
| HTTP 400 with explicit validation reason in the operator cards | **MISSING historical cause; diagnostics repaired** | The incident and performance card are one request, not two. Terminal handling is verified. Server rejection logging now emits only allowlisted reason/stage/build correlation, never the rejected payload. Historical diagnostics could not identify its exact field/precondition. |
| Background auth timeout, transport failure, sync timeout, 717-second wake interval | **MISSING exact published reproduction** | Controlled auth/read/body/transport/wake failures are covered. Browser lifetime and hidden time are not server processing time or proof of OS suspension. No common production cause or physical-device repair is asserted. |
| Update reportedly completed but required another refresh to become visible | **PASS for genuine local handoff; MISSING published cause** | Existing coordinator and real old→new build browser fixtures confirm the new document's exact running identity after one permitted handoff. No coordinator change was needed to make that controlled path pass. Activation alone is not counted as completion. |
| Completion review found pepperoni load controls removed with the applicator pounds panel | **PASS after repair** | Restored a separate pepperoni panel without resurrecting applicator pounds controls. All four pepperoni registers, grouped locks, expiry, run switching, ingredient changes, raw drafts and combined-mode retention are covered. |
| First restored pepperoni browser Save left canonical stock at zero | **PASS after repair** | Four browser projects reproduced the rejection. The client expands a section to its complete baseline; server validation wrongly treated its unchanged, inactive companion as a refill. Untouched triples now skip refill validation while the full canonical section fence remains. Six canonical tests passed, including all four registers, idempotency, stale HTTP 409 and existing applicator bounds. |

The reproduced pepperoni rejection used `/sync/manual-section`; it is not
assigned as the cause of the older `/sync/operational-intents` validation report.

### Verification failures encountered and resolved

These are retained rather than hidden behind the final passing runs:

| Failure | Resolution / final status |
| --- | --- |
| Pinned package-manager bootstrap recursed in this workspace | Repaired the local runtime bootstrap; supported typechecks and isolated suites subsequently executed. The earlier release-workflow failure is not reported as a passing release gate. |
| Early canonical tests used incomplete/invalid lifecycle or section fixtures | Updated fixture ownership, required lifecycle preconditions and section baselines; isolated targeted API integration finished **39 PASS**. Expected injected transactional-evidence failure verifies rollback; it is not an operational failure. |
| Production browser build rejected an unlisted deferred import, `MixedImportReviewQueue.tsx` | Added the existing surface to its boundary inventory; boundary tests and the isolated production build passed. No feature was removed to bypass the check. |
| Browser helper incorrectly expected GET `/sync/today` under `.data` | Corrected the helper to the documented top-level payload. |
| WebKit could not use the generic host launcher | Reused the repository's Nix/WPE runtime launcher. Host-dependency warnings were non-blocking; all four requested projects actually launched. |
| Browser fixture assumed seeded stock stayed at one whole batch while Auto ran | Paused canonically before correction and compared both tickers with current canonical stock; accepted fractional stock and formatted values. Resumed to prove actual consumption, not a countdown. Final focused four-project run passed once. |
| Final API test typecheck rejected three accesses to an intentionally generic snapshot field | Added explicit test-side record types; no runtime or production-code change. |
| Restored pepperoni Save did not persist in the first focused follow-up | Fixed the full-section/unchanged-companion validation mismatch. The same existing browser tester then passed the fixed pepperoni-only path once in all four projects; no broader repeat was used as evidence. |
| Review found environment-specific cache repair instructions in memory | Replaced the recipe with the durable rule: verify pinned runner identity and whether checks reached project code; do not change approved package policy to repair the environment. |
| Configured completion typecheck found generated API output stale | Regenerated with the exact pinned release runner. The resulting generated-file diff is blank lines only (`git diff --ignore-blank-lines --exit-code` passed); the full configured `bash scripts/src/run-release-node.sh pnpm run typecheck` then passed, including generated-output, six Zod contract tests, shared libraries, API/routes, scripts and client checks. Completion code review had already passed. |

### Operational warnings outside the disposable fixture

The final local workflow check showed the API and web serving, but shared
development startup also reported `identity_sequence_health_check_failed` and
master-data findings (one error in each scanned scope). These are **BLOCKED for
automatic repair**, not clean health evidence: their data owner/maintainer must
review the scoped health report before authorizing stored-data or sequence
changes. No speculative heal, sequence DDL or customer-data write was made.

An automatically included deployment log window additionally showed scheduled
evaluation database-timeout/connection warnings, a push enqueue failure and a
background job dependency-connection failure. The final included production
window also contained a daily-rollover failure and an outbox scope-list
connection failure whose cursor was retained for retry. A later readiness
sample returned success with a background-worker warning. These are **observed, not attributed
to the October 22 screenshots**. They belong with the already-owned post-Publish
server-stall signal verification, not a new capacity/topology change in this
repair. Current health samples are not proof that a reported operational run
advanced. No production fix or production GO is claimed.

The observed post-repair development restart, before generated-format refresh,
reached API `ready` in 353 ms and web `ready`;
its API build was `app-build:94d4a902-4206-4dcd-822e-224203c9264c`, source
fingerprint `80903e5acc6f6676e30cd7e9bf71229045935b7936343373394988175e581670`.
The above shared-development diagnostic warnings remained explicitly visible.
These identifiers are not published-build or physical-device verification.

## Verification matrix

| Check | Status / scope |
| --- | --- |
| Root `pnpm run typecheck`, generated API contract and recovery audit | **PASS**; API, client, scripts and generated check; recovery audit 9 pass plus its existing intentional difference. |
| Shared supply/cadence tests | **PASS**: 28 tests across five focused files. |
| API coordination/intent/tick unit suites | **PASS**; latest tick suite includes 31 tests, including full-run four-slot accounting, Packaging-only hold and failed-A/new-B rearming. |
| Canonical API integration | **PASS**: original 39 focused tests, plus the later six-test pepperoni/stock correction pass; separate disposable DB, not the full API suite. |
| Client outbox, status, recovery, timeout, tracking and station suites | **PASS**: 166 tests in the completed focused pass; final restored station/draft suite passed 51 tests. Client and API/route typechecks passed after the restoration. |
| Two-tab operational journey | **PASS**: desktop Chromium, phone Chromium, desktop WebKit, phone WebKit. Sign-up/authorized fixture transition, paused correction, one-batch demand change, peer adoption, resume/consumption, Packaging correction/hold and A→B handoff. |
| Responsive ticker controls | **PASS** in all four projects: 1280×800 desktop, 390×844 phone, 768×1024 tablet portrait and 1024×768 tablet landscape; viewport/bounds assertions, not physical hardware. |
| Restored pepperoni refill and peer UI | **PASS**: narrow four-project follow-up saved canonical 12.5 lb and the peer editor adopted 12.5 lb without refresh. Applicator stock and consumed ledger remained unchanged; both controls passed the four viewport bounds. Packaging and A→B were intentionally not rerun in this follow-up; their earlier evidence is unchanged. |
| Genuine update handoff | **PASS**: four desktop Chromium/WebKit cases in the real two-build PWA harness, including safe manual handoff and failed-discovery recovery. Exact new-document identity is asserted; no second operator refresh. |
| Phone/tablet update handoff matrix | **PASS**: six real two-build handoffs, phone and tablet portrait/landscape in Chromium and WebKit. Controls remained reachable, stored work was preserved, and the new document asserted the exact target identity without another operator refresh. |
| Retained browser screenshots | **MISSING**: synthetic attachment points were reached, but the isolated runner did not retain accessible attachments. Final assertions passed; no claim of visual screenshot inspection. |
| Public development preview | **PASS** startup/sign-in render. Vite has no production target build; its update-discovery error is not treated as old→new production handoff evidence. |
| Physical Android Chrome, iOS Safari or installed device PWA | **BLOCKED / not run**: no authorized physical-device service was available. Emulated Chromium/WebKit is not physical-device proof. |
| Native mobile | **Not applicable**: responsive web repair only. |
| Published-root-cause attribution and production post-repair check | **BLOCKED / not run**: no publishing or production writes authorized; older request/build diagnostics unavailable. |
| Standard/full release certification, production stress or capacity changes | **NOT REACHED / out of scope**; no release GO/NO-GO or publish recommendation. |

No original screenshot proves a common root cause, recovered production
tracking, or that a newer document is running. Safely actionable local defects
and fixture failures were repaired here; unavailable historical and physical
evidence remains explicitly unavailable, not silently marked PASS.
