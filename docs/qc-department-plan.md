# QC Department — Comprehensive Plan

**Status:** Approved Phase 1 and advisory Slices 0–7 implemented; Slice 7 adds bounded manager-only intelligence over effective recorded evidence. Verification and source-authority limits are reconciled below; this is not completion of the entire program or a production-release decision. Earlier date-code WebKit background diagnostics remain unresolved. Real approved label/date-code references remain unavailable. Slice 8 enforcement is deferred pending explicit owner policy, neither shipped nor formally declined; optional Slice 9 allergen expansion is not adopted.
**Updated:** 2026-10-23
**Related:** [Idea backlog](idea-backlog.md#2-qc-department-comprehensive), [import plan](import-system-plan.md), [allergen plan](allergen-tracking-plan.md), [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

QC is a durable follow-on product track, not a sync-protocol prerequisite. New QC actions require explicit capabilities, server-generated audit identity, reset/purge survival, and stable ingredient identity for lot and allergen rollups.

## Approved Master-Program Slice 0 — Advisory Brix

**Status:** Implemented and verified with synthetic fixtures; the authenticated Brix matrix passed 8/8. The broader E2E syntax gate remains blocked by unrelated malformed specs (see the retained evidence map). This is an advisory QC workflow, not a production or regulatory approval.

- Brix readings are recorded from the Brix view alongside Lots and Weights, linked to the selected run, station, and active ingredient, with pre-run or interval timing and optional instrument/note.
- Managers configure Brix targets and tolerances separately from weight targets. Both values require an explicit reviewed setting; there is no inherited weight tolerance or default ±0.5 °Bx. Missing configuration stays not evaluated.
- The server validates readings in the canonical `brix` unit (0–100 °Bx), resolves the saved configuration, snapshots its version and applicable target/tolerance, and computes the outcome. Clients cannot submit authoritative targets or outcomes.
- Brix events appear in scoped history and manager CSV. Corrections and redactions append evidence; later run-linked events reopen sign-off. The shared QC event ledger preserves Brix evidence through daily reset and factory purge.
- The focused server, UI, database-retention, and authenticated browser checks use synthetic readings only. No real facility target values were supplied or inferred; reviewed operational configuration is still required before staff use.

This slice does not change weight behavior or add workbook target extraction, cadence alerts, device integrations, holds, run/shipping gates, or regulatory claims. Slice 8 enforcement remains deferred pending explicit owner policy; it is neither shipped nor formally declined. Slice 9 allergen expansion is not adopted by this request. See the retained [Slice 0 coverage map and failure ledger](../.local/tasks/evidence/qc-slice-0-brix/coverage-check-map.md).

## Approved Master-Program Slice 1 — Component Identity and Presence

**Status:** Implemented and verified with synthetic fixtures. This is advisory identity/presence evidence, not a sensory, food-safety, or production-release approval.

- The checklist uses server-resolved effective components from canonical run settings and substitutions. Completed runs retain their immutable component snapshot.
- Missing or ambiguous expected settings remain not evaluated with actionable explanations. The client records observations but cannot supply or override the expected component list or server-evaluated outcome.
- QC managers can sign off the exact reviewed event high-water mark. A later component record or correction reopens review; corrections and redactions append events without changing original evidence.
- Scoped history, manager CSV, and QC ledger reset/purge retention remain in place.
- No weight, sensory, color, smell, texture, photo, label/date-code, cross-contact, hold/release, or regulatory criteria are included.

Verification: resolver tests 13/13; checklist UI tests 14/14; focused PostgreSQL API role/high-water/correction test 1/1; QC purge-retention tests 3/3; authenticated Chromium and WebKit journeys 2/2, with four responsive viewport checks in each browser; workspace typecheck passed. Physical Android Chrome and iOS Safari/PWA were not run. See the retained [Slice 1 coverage map and failure ledger](../.local/tasks/evidence/qc-slice-1-component-completion/coverage-check-map.md).

Slice 8 enforcement remains deferred pending explicit owner policy; it is neither shipped nor formally declined. Slice 9 allergen expansion is not adopted by this request.

## Approved Master-Program Slice 2 — Advisory Shipper Label Verification

QC can record observed product name, lot text, date text, and optional notes for a selected canonical run and either a shipper-case or carton-label context. Observed and expected text are presented separately.

**Reference authority**

- `record-qc` records/views observations; `manage-qc` creates bounded reference drafts and explicitly approves or withdraws a version with a review reason. Observation entry cannot create or approve expected values.
- Each reference identifies its product/profile key, packaging context, source identity/description, required fields, version, configuration actor/time, and review actor/time/reason.
- Applicability requires the exact canonical `brand__flavor` identity from the server-resolved run, not a manager's arbitrary display name or an operator's selection alone. The picker filters to the current product/context. A missing canonical identity or wrong-product reference remains observation-only/not evaluated.
- Expected values are never inferred from recipes, shipping guides, imports, or AI. A new draft version makes the previous version unavailable for new comparisons until the latest version is explicitly approved.
- Missing, incomplete, ambiguous, unapproved, withdrawn, stale, or inapplicable references do not silently pass. Observations still save as **not-evaluated**. Any evaluated mismatch fails overall; overall pass requires every required field to be evaluable and matching.
- Comparison preserves case/punctuation and treats dates literally, using only NFC normalization and boundary-whitespace trimming. It does not interpret locale-dependent dates or certify a printed date's appropriateness.

**Persistence and advisory boundary**

- Each check snapshots the exact reference version, source/review provenance, observations, expected values, field results, and overall result in the existing append-only QC ledger. Later reference changes do not rewrite history.
- Scoped history, manager CSV, audited observed-text corrections, nested redactions, and run sign-off reopening include label evidence. Non-run configuration/review events do not reopen unrelated runs. Corrections recompute against the original reference snapshot.
- Stable operation IDs support acknowledged retries. No new database table or column is introduced; evidence remains outside day-state and survives reset/purge.
- **Real reference availability: missing.** No authoritative finished-label master was found. Synthetic manager-approved test references are not operational approval. Until an authorized owner approves applicable real reference data, the shipped operational status is **observation only / not evaluated**.
- No artwork/photos/OCR, AI recognition, ingredient/allergen/nutrition declarations, regulatory claims, generated shelf life, packaging hold, shipping clearance, or run-start block is included. Label text fields do not confer date-code authority; the exact-text date-code workflow is separately delivered by Slice 3.

Evidence and exact results: [coverage/check map](../.local/tasks/evidence/qc-slice-2-label-verification/coverage-check-map.md) and [failure ledger](../.local/tasks/evidence/qc-slice-2-label-verification/failure-ledger.md). Responsive Chromium/WebKit checks are not physical Android Chrome or iOS Safari/PWA evidence. This task makes no production-readiness or publishing claim.

Verification after completion-check repairs: comparison tests 6/6; QC UI tests 17/17; selected QC/authorization integration checks 11/11, including wrong-product and unknown canonical identity; strengthened applicability regression 1/1; retention checks 5/5; generated API runtime/parity and the exact configured workspace typecheck passed. The corrected authenticated Chromium/WebKit journeys passed 2/2 with references bound to canonical run products, each covering desktop, phone, tablet portrait and tablet landscape. Physical Android/iOS checks were not run. The unrelated whole-directory browser syntax gate remains blocked by existing malformed manager-attention/merge specs, as recorded in the failure ledger.

Slice 8 enforcement remains deferred pending explicit owner policy; it is neither shipped nor formally declined. Slice 9 allergen expansion is not adopted by this request.

## Approved Master-Program Slice 3 — Advisory Date-Code Evidence

QC records literal production, best-by, or other approved code text for a
canonical run, explicit batch/pack context and shipper-case/carton-label/product-pack
context. Each field also records readability: readable, missing, unreadable or
ambiguous. All fields may be unknown; recording unknowns is not a pass.

- `record-qc` records/views; `manage-qc` creates reference drafts and explicitly
  approves or withdraws the latest version with a reason. Reference configuration
  captures exact expected text, required fields, source identity, source version
  and description. It applies only to its exact server-resolved run/product,
  batch/pack and packaging context.
- Recording accepts an exact configuration event ID, not client-authoritative
  expectations or outcomes. Draft, withdrawn, stale, ambiguous or inapplicable
  references yield **not-evaluated**. Missing/unreadable/ambiguous observations
  remain not evaluated. Any evaluated mismatch fails overall; pass requires all
  required fields to match. Only NFC normalization and boundary trimming apply.
  Unavailable/inapplicable selections retain no reference contents, only a generic
  unavailable reason. Configuration/review ledger rows are manager-only; an
  operator cannot use guessed IDs or facility history to read protected drafts.
  Approved applicable comparisons retain their authorized historical snapshots.
- An optional label-check event link must be in the same authenticated scope and
  run. The server validates the link and snapshots its identity.
- Checks snapshot observations, readability, reference/source/review evidence
  and server results in `qc_workflow_events`. Corrections recompute against the
  original reference snapshot; corrections and redactions append evidence.
  Run-linked evidence reopens sign-off; non-run configuration/review events do not.
  Scoped history, manager CSV and reset/purge retention reuse the existing ledger.
- No new table, column, database migration or production data change is required.
- **Real date-code policy/reference availability: MISSING.** Synthetic approved
  references prove the bounded comparison workflow only. A facility owner must
  supply/approve applicable real exact text and its source/version for operational
  comparisons. Otherwise the workflow is observation-only / not evaluated.

This records evidence, not date validity, finished-product shelf-life, regulatory
certification, expiry enforcement, release approval or shipping clearance.
No expected code comes from today's date, run time, ingredient expiration, AI,
an assumed format or a decoder. Date generation/interpretation would require
separate owner-approved format/timezone/production-date policy.

Verification: the expanded QC API/unit batch passed 18 cases after the protected
reference authorization repair; separate reset/purge retention checks, 21 UI
tests, root/API typechecks and generated-contract checks also passed. A later
completion validation stalled before TypeScript while bootstrapping pnpm. The
full root typecheck passed again using the exact pinned manager directly; the
ignored tool-cache bin layout was then repaired so bare `pnpm` resolves the same
version. API and web workflows are running, proxied API/web requests return
HTTP 200, and all API health checks report ok. No project dependency version,
workflow command, production data or production schema was changed.
Chromium passed the scoped authenticated flow; both engines completed all
date-code workflow and four-viewport assertions. WebKit's original global
zero-pageerror check failed on background network diagnostics; the scoped reload
probe also retained background failures while authentication and QC navigation
succeeded. The new test distinguishes narrowly identified local WebKit background
network messages from unexpected JS/QC errors, retaining all diagnostics. This
classifier passed two pure tests and the final spec was discovery-checked, not
browser-rerun. This is **not** a clean Safari/browser-health claim.

Evidence: [coverage/check map](../.local/tasks/evidence/qc-slice-3-date-code-verification/coverage-check-map.md)
and [failure ledger](../.local/tasks/evidence/qc-slice-3-date-code-verification/failure-ledger.md).
Physical Android Chrome and iOS Safari/PWA are not run; browser emulation is not
physical-device evidence. Slice 8 remains deferred pending explicit owner policy,
not shipped or formally declined. Slice 9 is not adopted.

## Approved Master-Program Slice 4 — Advisory Import QC Review

**Status:** Implemented; focused PostgreSQL/API/UI checks and signed-in browser
evidence cover the advisory outcome. This does not certify real source accuracy
or production readiness.

- Each newly committed spec, premix or cheese operation captures a versioned,
  bounded normalized before/after summary and its exact canonical result hash
  inside the existing atomic Apply transaction. The existing append-only QC
  ledger is the retained source of truth; no new database table/column or
  production migration is required. Raw workbooks, source text, notes and
  unbounded snapshots are not copied into QC evidence.
- Managers with `manage-qc` can browse a bounded queue, inspect the committed
  summary and its explicit omissions, and Verify or Reject with rationale.
  Server actor/time, operation ID, result hash and prior review revision bind
  each decision. Concurrent/stale decisions conflict. A dropped-response retry
  uses the original decision identity and returns its original acknowledged
  receipt, not a second decision. Later manager decisions append revisions.
- Pending/verified/rejected is independent of Apply/Undo and Gold Lab evaluation.
  Failed/applying operations cannot be verified. Legacy operations lacking
  retained review evidence remain visibly unreviewed; missing or redacted
  summaries cannot support new decisions. Authorized users see only scoped
  pending/rejected badge counts without gaining review-detail, import or Undo
  rights. Queue/detail/decision access and ordinary QC history remain fenced.
- Rejection shows guarded existing Undo availability and guidance. It never
  executes Undo, replays Apply or changes production/shipping eligibility.
  Notes/reasons and summary redactions append overlays; original evidence
  remains immutable. These non-run events do not reopen unrelated run sign-offs.
- Review evidence survives both live/sandbox reset and factory purge, actual
  90-day source-text cleanup, and removal of the import operation. Historical
  QC status remains attributable to the retained operation ID and hash.
- Verification: 38 selected API/summary/purge tests passed; two strengthened
  source-expiry/pagination/immutability cases then passed. All 18 focused client
  tests, root typecheck, codegen and generated-contract checks passed.
  Chromium and WebKit demonstrated safe summary, rationale, Verify/Reject,
  stale-manager conflict and committed-response-loss retry. The first browser
  execution exited unsuccessfully on two fixture/assertion mistakes; its
  functional observations are preserved, not relabeled as a clean run.
  A narrow final-state follow-up passed 2/2 tests for cross-context badge deltas,
  reload persistence and four post-decision viewport checks per engine.
  Before/after desktop, phone, tablet portrait and tablet landscape evidence is
  retained. Physical Android Chrome and iOS Safari/PWA: **NOT RUN**.
- The final-state pass had no QC HTTP errors or unexpected JavaScript errors.
  Unrelated background 403 responses from factory-data/day-start consumption,
  deliberate navigation request cancellations and performance-budget warnings
  are recorded separately; no global clean-browser or release claim is made.

See the [coverage/check map](../.local/tasks/evidence/qc-slice-4-import-review/coverage-check-map.md),
[failure ledger](../.local/tasks/evidence/qc-slice-4-import-review/failure-ledger.md)
and [combined browser evidence](../.local/tasks/evidence/qc-slice-4-import-review/browser-evidence.md).
Gold Lab scoring/capture, raw-source retention and customer evaluation-use
authorization are unchanged. Slice 8 enforcement remains deferred pending
explicit owner policy, neither shipped nor formally declined. Slice 9 allergen
expansion is not adopted.

## Approved Master-Program Slice 5 — Advisory Applied Recipe QC Review

**Status:** Implemented and verified as advisory review of already-applied
shared recipe revisions. Review never gates activation or production use.

- Canonical dough, sauce, cheese, and mix saves capture the committed recipe
  fields, authenticated actor, server time, immutable identity, and exact
  SHA-256 revision hash in the existing QC event ledger. Mix stock amounts are
  operational inventory, not recipe content, and do not create review work.
- Spec, premix, and cheese import Apply captures the resulting recipe revisions
  in the same transaction. Rolled-back writes leave no capture. Existing queued
  writes continue through the canonical save routes; no offline queue or
  propagation contract was replaced.
- `manage-qc` reviewers can inspect bounded, revision-specific summaries and
  append an idempotent Verify or Reject decision against the exact identity,
  hash, and decision revision. Retries return the original receipt; stale
  decisions conflict. Later recipe edits create new pending work. Rename and
  delete histories remain tied to immutable IDs rather than name matching;
  removing a verified same-name merge source does not transfer its decision to
  the surviving identity.
- `record-qc` readers receive only the current facility-scoped recipe review
  status. They do not receive manager-only summary, actor, or decision history.
  Rejection records a decision but does not undo a recipe, apply replacement
  values, block production, or change existing save permissions.
- QC capture and decision events reuse the append-only event ledger and survive
  reset and factory purge. They are non-run evidence and do not reopen unrelated
  run sign-offs. No table, column, or production migration was added.
- The recipe editor waits for canonical master-data bootstrap before enabling
  Add. This prevents an acknowledged save from being hidden by the first
  bootstrap response when the editor opens during startup.
- Verification: focused recipe hash/API checks **8/8**; focused recipe-manager
  and QC UI tests **24/24**; reset retention **14/14**; factory-purge retention
  **5/5** (174 unrelated tests skipped); dough, cheese, and mix canonical route
  integration suites passed, and import-operations integration passed **32/32**
  after updating its ledger-event assertion for the additional recipe capture.
  Client profile-refresh and queued-profile-sync tests passed **37/37**.
  `CI=true pnpm run typecheck`, API code generation, and generated-contract
  checks passed. Authenticated Chromium and WebKit journeys passed **2/2**, each
  covering desktop, phone, and both tablet orientations. The task-specific
  endpoints had no 5xx responses. WebKit retained background cross-origin fetch
  diagnostics, detailed in the failure ledger; this is not a global clean-browser
  claim. Physical Android Chrome and iOS Safari/PWA were **NOT RUN**.
  The configured calculator-wide workflow separately failed on an unrelated,
  reproducible auto-track assertion; the background release-standard workflow
  separately failed its existing sync-test shard inventory check. Neither
  failure was changed in this slice; both are documented with owners/next
  actions in the failure ledger.
- One-time system repair/heal jobs that mutate recipe data outside the
  authorized editor and import Apply flows are not retroactively represented as
  manager-authored review captures. A recipe whose current content has no
  matching committed capture is shown as **unreviewed**, not approved.

See the [coverage/check map](../.local/tasks/evidence/qc-slice-5-recipe-review/coverage-check-map.md)
and [failure ledger](../.local/tasks/evidence/qc-slice-5-recipe-review/failure-ledger.md).
The browser screenshots and sanitized per-engine results are retained beside
those files. Physical devices were unavailable, and no production data or
production migration was used. Slice 8 enforcement remains deferred pending
explicit owner policy; it is neither shipped nor formally declined. Slice 9
allergen expansion is not adopted.

## Approved Master-Program Slice 6 — Upcoming QC Planning

**Status:** Implemented and verified as an advisory, read-only projection of the canonical persisted schedule. Focused API/database, client, contract, typecheck, and authenticated browser checks passed. Initial API/web workflow restarts were blocked by the workspace pnpm bootstrap failure; after provisioning the exact pinned pnpm in an ignored local cache, both workflows restarted successfully. No production data or production migration was used.

- QC staff with `record-qc` can open Upcoming production from the QC workflow. The dedicated read route returns only a bounded schedule projection from facility-scoped `daily_sync` rows; it does not grant general sync access or expose full day-state.
- The client supplies its local production date. The API validates a 1–90 day range (the UI offers 7, 30, and 90 days), uses calendar-safe date bounds, and leaves missing schedule fields unknown rather than inventing run details.
- The list groups scheduled brands/flavors by production date and shows run identity and case demand when present. Empty persisted days, days without scheduled runs, unknown fields, request errors, and source unavailability remain distinct states. Refresh reads current server data; the view has no scheduling controls.
- The signed-in synthetic journey navigated to QC Planning, read the canonical scheduled brand/flavor, refreshed after a manager changed the fixture, and retained the selected range after reload. All eight Chromium/WebKit desktop, phone, and tablet-portrait/landscape projects passed, with no horizontal overflow or browser page errors; fixture accounts and schedule rows were cleaned up.
- Focused API/database integration coverage passed **205/205** tests; the planning component passed **3/3**; generated API contract checks and the full workspace typecheck passed. The coverage map and full failure ledger are retained below.
- Physical Android Chrome and iOS Safari/PWA were **NOT RUN**; responsive browser emulation is not device evidence, and this slice adds no native-mobile deliverable.

See the [coverage/check map](../.local/tasks/evidence/qc-slice-6-planning/coverage-check-map.md)
and [failure ledger](../.local/tasks/evidence/qc-slice-6-planning/failure-ledger.md).
Sanitized synthetic per-engine results and screenshots are stored beside those
files.

## Approved Master-Program Slice 7 — QC Intelligence

**Status:** Implementation complete for bounded, advisory manager reports. The
[coverage/check map](evidence/qc-slice-7-intelligence/coverage-check-map.md)
and [failure ledger](evidence/qc-slice-7-intelligence/failure-ledger.md)
record the actual verification results, including repaired failures and unavailable evidence.
The reviewed synthetic evidence is mirrored in this tracked documentation
directory because managed task checkpoints omit ignored `.local` metadata.
The requested working captures remain under
`.local/tasks/evidence/qc-slice-7-intelligence/`; raw traces are not copied.
Focused report/API/PostgreSQL checks passed 11/11 selected tests (194 unrelated
tests skipped); client checks passed 22/22 before sync and 24/24 after incoming
Brix reference tests were integrated. Generated parity and the full workspace
typecheck passed, including the final pinned-runtime rerun after sync;
post-sync regeneration/library and API typechecks also passed.
All eight required authenticated viewport/engine
journeys passed across the Chromium matrix and focused WebKit rerun, including
filter/export/reload/error/retry and non-manager denial; zero browser page
errors were recorded. The WebKit failure-injection fixture blocks service
workers, so it does not establish PWA lifecycle coverage.

- `manage-qc` is required for reports and filtered CSV. `record-qc` alone does not
  grant access. Authentication supplies live/sandbox scope; no unrelated writes
  or general audit-log access are granted.
- Weight and Brix contexts separate measurement/target units, target version,
  stable ingredient identity, station, timing and profile. Missing target
  versions remain isolated rather than being merged on numeric equality.
  Graphs have accessible tabular equivalents.
- Recorded pass/fail/not-evaluated totals cover weight, Brix, component, label
  and date-code checks, grouped by check type, station and ingredient. The
  denominator is recorded checks, not expected or missing checks. Missing
  records never become passes or proof of cadence compliance.
- Reports and CSV share the history correction/redaction projection. Original
  evidence stays append-only; overlays do not add replacement checks to the
  denominator. Filters apply to effective station/timing values; redacted
  measurements do not appear in chart points or exports.
- The date basis is inclusive UTC source-event creation dates, not production
  dates or correction dates. Filters and coverage accompany every report/export.
  Default range is 30 UTC dates, maximum 366; source events, overlays, groups,
  canonical snapshots, traversal and CSV size all have enforced limits. Bounds
  produce explicit partial/unavailable coverage or an explicit export error,
  not complete-looking truncation.
- Lot traces use recorded lot-to-run IDs and exact scoped current/completed-run
  evidence. Missing, ambiguous, invalid or oversized canonical sources remain
  unavailable. No explicit lot-to-customer/outbound relation exists in the
  available model; the report says unavailable. Inventory transfers, matching
  names and production labels are not evidence of customer shipments.
- Verification uses disposable PostgreSQL and synthetic authorized accounts.
  Physical Android Chrome and iOS Safari/PWA are **NOT RUN**. Real operational
  references remain a separate **MISSING** source-authority gap.

### Master coverage reconciliation

Earlier slice statements below remain the recorded handoffs from their owning
slices; they were not rerun as part of Slice 7. Their linked capture directories
are absent in this checkout, so original captures are **MISSING**, not silently
treated as retained passing evidence.

| Slice | Current factual handoff | Evidence available in this checkout / remaining gap |
| --- | --- | --- |
| 0 — Brix | Advisory recording and separately reviewed targets | Earlier plan claim retained; original capture MISSING; real targets require owner review |
| 1 — Components | Identity/presence checks only | Earlier plan claim retained; original capture MISSING; no cross-contact conclusion |
| 2 — Labels | Advisory literal text verification | Earlier plan claim retained; original capture MISSING; approved real references MISSING |
| 3 — Date codes | Advisory exact-text evidence | Earlier plan claim retained; original capture MISSING; approved references MISSING and prior WebKit diagnostics unresolved |
| 4 — Import review | Advisory review of committed operations | Earlier synthetic handoff retained; original capture MISSING; no approval gate inferred |
| 5 — Recipe review | Advisory applied-recipe review | Earlier synthetic handoff retained; original capture MISSING; no activation block inferred |
| 6 — Planning | Read-only bounded canonical schedule projection | Earlier plan claim retained; original capture MISSING; not forecast or schedule enforcement |
| 7 — Intelligence | Bounded effective measurement/outcome reports and exact stored lot-to-run trace | Current coverage map, failure ledger and synthetic browser captures retained; no outbound/customer relation |
| 8 — Enforcement | Deferred pending explicit owner policy | Not shipped and not formally declined; no hold/release/clearance enforcement authorized |
| 9 — Allergen Phase 2 | Optional proposal, unadopted | Not adopted by this request; no expansion or risk certification claimed |

## QC Phase 1 — Approved and Implemented

### Lots and weights

- Lots and Weights are distinct QC views. Each lot is an append-only record linked to the current run, stable ingredient identity, station, authenticated recorder, and server timestamp. Repeated lots remain separate records.
- Weight checks support pre-run and 30-minute check types. Each records the target snapshot, target unit, actual value/unit, check type, authenticated recorder, server time, and evaluated result. Out-of-tolerance readings require a note.
- Targets resolve only from unambiguous imported portion fields or a manager-reviewed QC override. Imported sauce, applicator, and pepperoni portions are ounces per pizza; the doughball target is ounces. Recipe-linked cheese/mix applicators use their linked recipe name. Only an exact name match to one active ingredient is used. Incomplete, conflicting, unmatched, or missing targets return “not evaluated.”
- The spec-import contract has no explicit crust target field. Crust targets are therefore not inferred or evaluated unless a future approved importer contract adds an explicit value.
- Default tolerance is ±0.1 in the target unit. A reviewed QC override may supply another non-negative tolerance; a blank override tolerance uses the default. An explicit approved spec limit takes precedence if one becomes available.
- QC managers and app managers can change or clear reviewed targets. Each settings change records its authenticated actor, timestamp, and reason.

### Allergen and cleaning records

- The pre-run checklist snapshots the current derived run footprint, unknown/missing mappings, the per-run Warehouse ingredient-stage rows and their checked state, staged-ingredient review, and relevant cleaning status. The derived footprint remains visibility-only and separate from the manually entered run-allergen field.
- A cleaning record captures method, start/end times, authenticated cleaner, and server timestamp. A different authenticated person must verify it; self-verification is rejected.
- An authorized QC manager or app manager can sign off once for the current run evidence set. Any later QC record reopens that review.
- QC work never blocks production or shipping. Unknown or incomplete allergen data remains visible and is not presented as clear.

### Roles, history, audit, and retention

- QC operators can record QC work and view facility-scoped history. QC managers and app managers can edit targets, sign off runs, and export full filtered history as CSV.
- Facility scope comes from the authenticated request. History queries are bounded and paginated; CSV export is manager-only.
- QC events are append-only, server-timestamped, and attributed to authenticated actor IDs. Corrections and privacy redactions are new auditable events, never edits or deletes. Retention is indefinite.
- The new QC event ledger is outside day-state reset and factory-purge deletion. The existing photo-quality records remain a separate surface with their existing behavior.

### Deferred from Phase 1

Shipping holds or release enforcement; regulatory or food-label declarations; shipper-label and date-code checks; import or recipe approval; trend/analytics; cross-contact analytics; lot-to-customer traceability; line clearance; finished-lot identification; mock recall; and HACCP evidence.

The Phase 1 exclusions above are historical scope boundaries. Advisory text-only label observation/comparison is separately delivered by master-program Slice 2, and exact-text date-code evidence by Slice 3. Enforcement remains deferred.

## Critical Requirements

### Daily Reset: Archive Yesterday, Show Only Today
The daily reset (midnight day-state clear) is the natural cutoff point. QC data behavior:

- **Active QC pages** — Lots and Weights remain separate; each defaults to current-run/today records
- **History view** — browse prior records, filter by date/ingredient/lot/station, and export CSV as scoped in the owner decision note
- **Yesterday's data is saved** — historical QC records are not removed by the daily reset; retention follows the approved privacy/redaction policy
- **No clutter** — operators see only what matters RIGHT NOW on the active screen; historical data never pollutes the current view
- **The reset doesn't delete QC data** — it clears day-state (runs and active operational data), not server-persisted QC history

**Illustrative view pattern (not an implementation spec)**:
```
QC
├── Lots               ← separate page; current run by default
├── Weights            ← separate page; current run by default
└── History / CSV      ← filter historical checks for authorized review
```

The daily reset is invisible to QC pages: each defaults to current records, while older entries remain available in history subject to the approved retention policy.

### QC Data Survives All Wipes
Phase 1 QC events and the existing photo-quality records are separate from day-state and factory-purge data. Integration coverage verifies that live and sandbox QC events survive both `/sync/reset` and `/sync/purge-all`, while scoped operational state is reset or purged.

### Audit, Access, and Retention — Phase 1 Contract
- Each QC event is facility-scoped from the authenticated request, attributed to the authenticated actor ID, and timestamped by the server.
- The QC event ledger rejects UPDATE and DELETE. Corrections and privacy redactions append events that preserve the original history while changing the reviewed presentation.
- Operators with `record-qc` can record QC work and read scoped history. `manage-qc` and app managers can change targets, sign off runs, and export full filtered history as CSV.
- History reads are bounded and paginated; export is manager-only. No IP address, user agent, or unrestricted request body is stored.
- Retention is indefinite. Privacy requests use the audited redaction path rather than deleting QC evidence.
- Required audit and record writes are atomic. If a required event cannot be saved, the operation fails instead of silently succeeding.

These are implemented Phase 1 boundaries, not open design questions. The retained [operational audit design boundaries](idea-backlog.md#17-residual-observability--resilience-ideas) still apply.

The remainder of this document separates implemented Phase 1 behavior from deferred candidates. Deferred proposals are not approved requirements.

## Existing Surfaces and Phase 1 Placement

Phase 1 adds run QC workflows inside the existing QC department without replacing photo history or moving unrelated import, inventory, substitution, incident, or downtime workflows:

| Current Location | Feature | Move To |
|-----------------|---------|---------|
| QC department | Append-only Lots and Weights workflows | QC workflows |
| QC department | Derived allergen footprint, staged review, cleaning record and independent verification | QC workflows |
| QC department | Existing photo-quality history | Separate photo-quality section; behavior unchanged |
| QC department | Incident log and downtime trends | Existing separate surfaces |
| Inventory tab | Inventory lot number field and temporary substitutions | Remain in Inventory |
| Manager menu | Import dialogs (spec, premix, cheese, shipping, guides) | **Shared** — see below |

QC workflows are available from the department menu to authorized QC staff; the primary station navigation is unchanged.

### Shared Importers: QC + Everyone Else (approval workflow deferred)

The existing importers stay available under their current permissions. Phase 1 does not add QC import approval or change importer behavior. The following proposal is deferred:

- **Who can import**: Managers, supervisors, and QC staff (existing capability gates stay)
- **Who must verify/approve**: QC staff — every import lands in a **pending review** state
- **Import flow**:
  1. Anyone with import capability uploads a file (spec sheet, shipping guide, premix, cheese, etc.)
  2. The parsed data lands in the normal pipeline BUT with `qc_review_status = "pending"`
  3. Database changes are applied but flagged as **unverified** (visible to all, marked "awaiting QC verification")
  4. QC staff see pending imports in their QC queue → review → **approve** (verified) or **reject** (rollback pending)
  5. On approval, the import becomes fully verified; on rejection, a rollback plan is offered
- **Where it shows**:
  - **QC Department** → "Import Review" queue (pending/approved/rejected, with diff preview)
  - **Company-wide** → imported data still shows everywhere (profiles, recipes, mixes) but with a small "unverified" badge until QC approves
- **Why shared works**: QC is the *primary* source but not the *only* source — managers can import in an emergency, but QC verification is the enforced quality gate

**Deferred implementation notes**:
- Extend import metadata with `qc_review_status` enum: `pending | verified | rejected`
- Add `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes` to import records
- API: `GET /api/qc/import-reviews` (queue), `POST /api/qc/import-reviews/:id/approve`, `POST /api/qc/import-reviews/:id/reject`
- Existing import capability gates (`canImportSpec`, `canImportProfileGuide`, etc.) remain unchanged for who can *trigger* an import
- Import commit / rollback needs to stay reversible until QC approves (see existing import lifecycle audit in docs/)


- **Existing tabs**: Quality (photo checks), Incidents, Downtime Trends
- **Inventory lot tracking**: Basic lot number field on inventory items; separate from Phase 1 run-level QC lots
- **Phase 1 adds**: weight checks and per-run, per-station QC lot records
- **Deferred**: shipper labels, date verification, full lot traceability, and QC analytics dashboards

---

## QC Department Structure and Deferred Candidates

### 1. Lot Tracking (Enhanced)
**What exists**: Simple lot number text field on inventory batches
**Implemented in Phase 1**:
- Per-station lot logging (every ingredient used gets its lot recorded against the current run)
- Stable ingredient ID, run, station, authenticated recorder, and server timestamp are included in the immutable event.
- Repeated lots for one run/ingredient remain separate records.

**Deferred**: lot-to-customer traceability, recipe-chain rollups, expiry alerts, barcode scanning, and inventory-batch linking.

### 2. Weight Checks
**What exists**: Nothing — manual clipboard process
**Implemented in Phase 1**: pre-run and 30-minute checks, explicit target snapshots, actual value/unit, default ±0.1 target-unit tolerance, reason-required deviations, authenticated recorder, server time, and “not evaluated” when a valid target is unavailable.

**Deferred**: trend graphs, analytics, and any inferred target or tolerance.

### 3. Component Checks
**Status:** Approved master-program Slice 1 is implemented and verified for identity and presence only. See the Slice 1 acceptance and evidence map above.

The server resolves expected effective components from canonical run settings and substitutions, preserves completed-run expectations, and leaves incomplete or ambiguous settings not evaluated. Observations and outcomes are recorded in the existing append-only QC event ledger. Manager sign-off is tied to an exact event high-water mark; later run-linked component evidence and corrections reopen review.

**Out of scope:** Weight, sensory, color, smell, texture, photos, labels/date codes, cross-contact, safety conclusions, and production or shipping enforcement.

### 4. Import Source Management
**What exists**: Import system (spec, premix, cheese, shipping) — QC is described as "primary source"
**What's needed**:
- QC-owned import queue (pending imports awaiting QC verification)
- QC sign-off on imported data (approve/reject with comments)
- Import audit trail (who imported, when, QC approved/rejected)
- QC-specific import view (filtered to items needing attention)

**No new tables needed** — extend existing import metadata with QC approval status

### 5. Shipper Label Verification
**What exists**: Slice 2 advisory text-only product name, lot text and date text checks, versioned manager-reviewed reference configuration, server comparisons and immutable source/result snapshots. Scoped history/CSV, corrections/redactions and sign-off reopening reuse `qc_workflow_events`; no separate `label_checks` table is needed.

**Operational gap**: No approved real finished-label master is available. Observations save as not evaluated until an authorized manager explicitly approves an applicable real source. Shipping guides and AI recognition are not approved references.

Artwork, photos/OCR, weight/ingredient/allergen/nutrition declarations, regulatory claims, shelf-life generation and packaging/shipping enforcement are not part of this slice.

### 6. Date Verification
**What exists**: Slice 3 advisory literal production/best-by/other code recording,
versioned manager-approved exact-text references with run/batch/pack applicability,
server comparison, immutable snapshots and optional same-run label linkage.
The existing QC ledger owns persistence; no separate `date_checks` table is needed.

**Operational gap**: Real approved finished-product date-code references and any
generation/decoding policy are unavailable. No shelf life, current-date mapping,
ingredient-expiration mapping or calendar validity is inferred.

### 7. Recipe & Future Planning
**What exists**: Setup tab has recipe editors (dough, sauce, frontline), brand/flavor management
**What's needed**:
- QC-owned recipe approval workflow (new recipes require QC sign-off)
- Future brand/flavor planning view (upcoming brands, planned flavors, ingredient requirements)
- Recipe change tracking (what changed, when, who approved)
- Ingredient requirement calculator for planned recipes

**This overlaps heavily with existing Setup tab** — may be better as a sub-section rather than separate UI

### 8. QC Dashboard
**What exists**: QualityHistoryTab (photo checks only)
**What's needed**:
- At-a-glance QC status for current run (all checks pending/passed/failed)
- Checklist completion tracker for the applicable lot, weight, and component identity/presence workflows
- Alert panel (overdue checks, failed checks, expiring lots)
- Shift summary (what was checked, what failed, what's pending)

---

## Recommended Build Order

### Phase 1: QC and allergen foundation — implemented
1. Separate append-only lot and weight records tied to a run and stable ingredient.
2. Explicit importer-backed targets, reviewed overrides, target-unit tolerance, and not-evaluated behavior.
3. Advisory allergen pre-run checklist and independently verified cleaning records.
4. Per-run QC manager sign-off, scoped history, manager CSV export, audited correction/redaction, and reset/purge retention.
5. Existing photo-quality history stays separate.

### Phase 2: Verification Workflows
6. **Label verification** — advisory text-only Slice 2 implemented; approved real references still unavailable
7. **Date verification** — Slice 3 exact-text advisory workflow implemented and functionally verified; real references unavailable; WebKit background diagnostics retained separately

### Phase 3: Integration & Planning
8. **Import review queue** — advisory committed-operation review in Slice 4; no import block
9. **Recipe review** — advisory applied-recipe review in Slice 5; no activation gate
10. **Future planning view** — bounded persisted schedule projection in Slice 6

### Phase 4: Intelligence
11. **Weight and Brix trends** — Slice 7 bounded effective measurements, separate units/targets and accessible tables
12. **Lot traceability report** — Slice 7 recorded lot → exact run evidence; customer/outbound links unavailable without explicit stored evidence
13. **QC analytics** — Slice 7 recorded pass/fail/not-evaluated counts and denominators, not inferred compliance

---

## Key Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/departments/QcDepartment.tsx` | QC department boundary (exists, thin) |
| `artifacts/run-calculator/src/components/QualityHistoryTab.tsx` | Photo quality checks (exists) |
| `artifacts/run-calculator/src/components/InventoryTab.tsx` | Lot tracking (basic, exists) |
| `artifacts/run-calculator/src/components/StaffRolesCard.tsx` | Role management (needs "qc" role) |
| `artifacts/run-calculator/src/departments/DepartmentBoundary.tsx` | Department routing |
| `artifacts/run-calculator/src/hooks/useHomeNavigation.ts` | Tab definitions |
| `lib/db/src/schema/inventory.ts` | Inventory schema (has lot field) |
| `artifacts/run-calculator/src/pages/home.tsx` | Main app (tab rendering) |

## Phase 1 Persistence

Phase 1 uses one facility-scoped append-only `qc_workflow_events` ledger for lots, weight checks, allergen reviews, cleaning and verification, target settings, sign-offs, corrections, and redactions. Each event has an authenticated actor ID and server-generated timestamp. The ledger is outside day-state and factory-purge deletion.

## Phase 1 UI Surfaces

The QC department presents distinct Lots and Weights views, an allergen/staging review, cleaning record and independent verification, manager target settings, per-run sign-off, scoped event history, and manager CSV export. Corrections and privacy redactions are available to QC managers. The existing `QualityHistoryTab` remains a separate photo-quality section.

## Phase 1 API

- `GET/POST /api/qc/targets`
- `POST /api/qc/lots` and `/api/qc/weight-checks`
- `GET /api/qc/runs/:runId`
- `POST /api/qc/allergen-reviews`
- `POST /api/qc/cleaning-records` and `/api/qc/cleaning-records/:recordId/verification`
- `POST /api/qc/run-signoffs`
- `GET /api/qc/history` and manager-only `GET /api/qc/history.csv`
- Manager-only `POST /api/qc/events/:eventId/corrections` and `/redactions`

Every path is capability-gated and derives facility scope from the authenticated request. History queries are paginated and bounded; CSV export streams bounded database pages. QC ledger records are excluded from daily reset and factory purge.

## Deferred API and Workflow Gates

Date-code generation/decoding and date-validity certification, label artwork/OCR,
import/recipe approval, dashboards, trend/analytics, PDF export, lot-to-customer
traceability, holds, release enforcement, and label/regulatory claims remain
deferred. Advisory text-only label observations/comparisons are delivered by
Slice 2 and exact-text date-code evidence by Slice 3.

## Slice 2 API

- `GET /api/qc/label-references` — scoped reference status; operators see approved versions, managers see draft/review state.
- Manager-only `POST /api/qc/label-references` — create a draft reference or a new version.
- Manager-only `POST /api/qc/label-references/:eventId/review` — explicitly approve or withdraw the latest version with a reason.
- `POST /api/qc/label-checks` — record observed text; the server resolves reference authority and computes results.

Label events reuse the existing history, CSV, correction/redaction and sign-off endpoints. No observation request accepts client-supplied expected values, review authority or outcomes.

## Slice 3 API

- `GET /api/qc/date-code-references` — scoped latest reference versions; operators see approved versions only.
- Manager-only `POST /api/qc/date-code-references` — save a draft/new version for an explicit canonical run and batch/pack context.
- Manager-only `POST /api/qc/date-code-references/:eventId/review` — approve/withdraw the latest version with a reason.
- `POST /api/qc/date-code-checks` — record text/readability; server resolves exact reference authority, validates optional label linkage and computes results.

Date-code checks reuse the existing history, CSV, correction/redaction and sign-off
endpoints. A recorded pass means a literal text match only, never a valid date or
release approval.
