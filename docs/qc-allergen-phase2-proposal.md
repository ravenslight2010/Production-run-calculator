# QC and Allergen Phase 2 Proposal

**Status:** Proposal for owner review — not approved for implementation

**Prepared:** 2026-10-16
**Scope:** Advisory component, label, date-code, cross-contact review, and daily allergen activity reporting only

## Recommendation

Start with a **read-only daily allergen activity report of recorded facts**. It can combine the existing immutable completed-run snapshots, the current-day operational snapshot, and Phase 1 QC allergen/cleaning events without changing production behavior or adding persisted data. The report must show missing reviews and unknown mappings as unknown, keep the manually entered run-allergen value separate from the derived footprint, and avoid calling any observation a violation or clearance.

This is the lowest-risk vertical slice because the source records already exist and the result can be checked against them. It will not establish cross-contact risk or prove that a cleaning action occurred between two runs. Those require explicit equipment/transition rules and better linkage than Phase 1 currently records. Component checks are the next best candidate, but should begin only after the expected component list can be resolved server-side from the selected run and its effective substitutions.

No Phase 2 feature, hold, regulatory statement, or change to a Phase 1 contract is approved by this proposal.

## Evidence and source boundaries

| Evidence reviewed | What it supports | What it does not support |
|---|---|---|
| `docs/qc-department-plan.md`, `docs/allergen-tracking-plan.md`, `.agents/memory/qc-allergen-phase1-decisions.md`, and merged Task #2897 | Phase 1 choices: non-blocking records, authenticated scope/actor/time, append-only history, audited corrections/redactions, indefinite retention and reset/purge survival. Later candidates are deferred, not approved. | New production holds, allergen declarations, label claims, or altered retention/access. |
| QC UI/API and `lib/db/src/schema/qcWorkflowEvents.ts` | The `qc_workflow_events` stream stores run-linked events and JSON payloads; current records include lots, weights, allergen reviews, cleaning, verification, sign-off, corrections and redactions. History and run reads are bounded; roles use `record-qc` and `manage-qc`. | New event types automatically being safe: strict event-specific validation, correction/redaction support, UI rendering, OpenAPI and generated clients must also be extended. |
| `artifacts/api-server/src/routes/sync.ts`, `lib/db/src/schema/sync.ts`, `artifacts/api-server/src/routes/operationalReports.ts` | Completed-run history stores canonical day snapshots; reports already distinguish immutable completed runs from mutable current-day state. Snapshots preserve the manually entered run value and selected run data. | A historical derived footprint when no Phase 1 allergen-review event captured one. Recomputing it from today's ingredient mappings would rewrite history. |
| `artifacts/api-server/src/routes/syncReset.integration.test.ts`, `sync.integration.test.ts` | Existing QC workflow events survive daily reset and factory purge in both scopes. | Extending retention to new storage or attachments without separately verifying that storage path. |
| `attached_assets/source-library/shipping/Shipping_and_Palletizing_Guide_07.02.2026_1784339849858.xlsx`, `lib/shipping-import/src/index.ts`, `lib/db/src/schema/savedShippingGuides.ts` | The reviewed shipping guide contains packaging and palletizing columns (box, dimensions, circle, case counts, grip sheets, pallet/stacking/film/height). The importer intentionally maps only existing packaging fields and omits uncertain values. | Approved finished-label artwork/text, ingredient declarations, finished-product lot rules, or date-code/shelf-life rules. Saved guide snapshots are packaging evidence and only the two latest per file are retained. |
| `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `artifacts/run-calculator/src/types.ts`, `lib/db/src/schema/inventory.ts` | Recipe and weight specification values exist; inventory lots have received/expiration dates. | Finished pizza/carton best-by rules. Inventory expiration dates describe ingredient lots, not finished product date codes. |
| `artifacts/run-calculator/src/runAllergenFootprint.ts`, `lib/ingredient-catalog/src/index.ts`, `artifacts/run-calculator/src/types.ts` | The derived footprint uses recipe ingredients, substitutions, selected pepperoni types, and reviewed ingredient mappings; reviewed-empty means none of the nine tracked allergens. Missing/unreviewed mappings and missing components stay incomplete. The manual run-allergen field is a separate input used for existing sequence warnings. | Inferring “none” from no review, changing the manual field, or making regulatory claims. |
| Current task board and task search | Merged Task #2897 delivered Phase 1. The current active unrelated work is Task #3246; no other active/proposed task was found for the Phase 2 candidates. | A reason to alter another task's scope or status. |

## Proposed sequence

### 1. Daily allergen activity report — recommended first vertical slice

- **User-visible outcome:** A QC activity view for one production day showing runs, the manual run-allergen value, any separately recorded Phase 1 derived-footprint review, unknown/missing mapping details, and recorded cleaning/verification events. Show “no review recorded” distinctly from a reviewed-empty footprint. Label the report as a summary of recorded activity, not a clearance or compliance determination.
- **Roles/capabilities:** Read access for the existing QC history capability (`record-qc`); use the existing manager-only boundary (`manage-qc`) for any full-history export. The initial recommendation is an on-screen report only, with no new export.
- **Sources:** `completed_run_history.snapshot` for ended runs and `daily_sync` for the active/current day, using the existing canonical operational snapshot validation approach. Read Phase 1 `allergen-review`, `cleaning`, and `cleaning-verification` events from the authenticated facility scope. Do not recompute historical footprints from current ingredient mappings.
- **Captured evidence and states:** This is a read-only projection, not a new QC record. Per run, report manual field as its own value/state and the latest recorded derived-footprint snapshot separately. Use `recorded`, `no review recorded`, `unknown/incomplete`, or `source unavailable`; do not convert missing values to “none.” Cleaning appears as recorded, independently verified, unverified, or unknown only where the event supports that status. Do not label any result “pass,” “violation,” “near miss,” or “allergen-free.”
- **History, correction, audit and retention:** No new event or table. Hydrate event overlays so audited corrections and redactions are respected. Keep report generation read-only and retain Phase 1's indefinite QC history and reset/purge survival unchanged. Avoid unnecessary actor details in the summary.
- **Operational impact and dependencies:** No production/shipping changes. A cleaning record is linked to a run, not to a defined equipment transition; display it as a record, not as proof of cleaning between adjacent runs. Fail the report explicitly or show a bounded unavailable state if a canonical source snapshot is missing or invalid; never fill gaps with plausible zeros.
- **Focused verification:** Check capability and facility-scope isolation; active-day versus completed-run inclusion and deduplication; canonical snapshot rejection; local production-date boundary; no-review versus reviewed-empty versus unknown mapping; unchanged manual/derived separation; corrected/redacted event projection; reset/purge retention; and that no report value is described as a violation or clearance.

### 2. Component identity/presence checks

- **User-visible outcome:** A run checklist for configured dough, sauce, cheese/applicator and pepperoni components. The first slice should check only that the expected component is present and identified correctly; qualitative color, smell, texture, weight and label criteria are not currently defined by an approved repository source.
- **Roles/capabilities:** QC operators with `record-qc` record and view; QC managers/app managers with `manage-qc` correct or redact through audited events and export only under the existing export boundary.
- **Expected source:** The selected run's effective product profile and day substitutions, resolved by the server. Snapshot the expected component identities at record time. Do not accept a client-supplied expected list or result as authority. If the server cannot resolve a complete expected list, persist `not-evaluated` with the reason rather than pass.
- **Captured evidence and states:** Expected component identity/source snapshot, observed present/mismatch/not checked, optional note, event ID, authenticated actor, server time and run ID. Per component, outcomes are `pass`, `fail`, or `not-evaluated`; the overall checklist passes only when all required components are evaluated and pass, fails if any evaluated component fails, and otherwise remains not evaluated. No photo is recommended in the first slice because the QC event ledger has no attachment contract.
- **History, correction, audit and retention:** Add a `component-check` event to the existing append-only ledger; no dedicated table is assumed. Add strict component-specific correction validation and only redact fields that can contain sensitive text. New run events participate in the existing sign-off high-water mark and reopen review. Records retain existing scope, actor, timestamp, indefinite retention, and reset/purge survival.
- **Operational impact and dependencies:** Advisory only; never blocks starting, running, completing, or shipping a run. Depends on a server-side resolver for effective run components/substitutions and on owner approval of the identity/presence checklist. Photo evidence would require a separate storage/access/retention decision.
- **Focused verification:** Expected-source resolution across profiles/substitutions and missing or ambiguous identities; server-owned result computation; all three outcomes and overall precedence; duplicate operation IDs; invalid/stale run conflicts; sign-off reopening; correction/redaction history; cross-scope denial; reset/purge survival; and no production or shipping hold. Include responsive and browser checks below.

### 3. Advisory cross-contact review

- **User-visible outcome:** A review queue for adjacent run transitions that lets QC staff inspect the existing manual sequence warning, the separately available derived footprint snapshot, and recorded cleaning evidence. Initially this is an advisory review, not a risk score, clean-line assertion, regulatory statement, or automatic reorder.
- **Roles/capabilities:** QC operators (`record-qc`) may record the review; managers retain the existing `manage-qc` correction/redaction/export authority.
- **Expected source:** Existing manual run-allergen values and sequence order remain the source of the current sequence warning. Derived footprint snapshots are a distinct visibility aid and count only when actually reviewed; missing/unreviewed mappings remain unknown. Cleaning records can be shown with their authenticated independent verification state, but Phase 1 has no shared-equipment mapping or transition link.
- **Captured evidence and states:** If approved, record the two run IDs, source snapshots/versions, existing warning, cleaning evidence considered, unknowns, reviewer disposition and note. Use `reviewed`, `not reviewed`, or `not evaluated` where the sequence, footprint or cleaning evidence is incomplete. Do not record a “violation” or “near miss” without owner-approved definitions and criteria.
- **History, correction, audit and retention:** A `cross-contact-review` event can reuse the append-only ledger; no new table is assumed. It needs strict payload validation, audited correction/redaction fields, manager access, server actor/time and the same retention/reset/purge rules. If it is run-linked, it should reopen sign-off as a new record.
- **Operational impact and dependencies:** Advisory only. Before evaluation beyond displaying existing warnings, the owner must define what constitutes the relevant transition, shared equipment, required cleaning evidence, and any time/sequence criteria. The existing cleaning event's run link alone is insufficient to establish a between-run clean.
- **Focused verification:** Adjacent-run ordering; no warning versus warning; manual value differing from derived footprint; reviewed-empty versus unknown; missing/late/unverified cleaning records; non-adjacent or missing run data; correction/redaction projection; sign-off reopening; and explicit proof that no reorder, hold, or release behavior is invoked.

### 4. Shipper-label verification

- **User-visible outcome:** A QC operator records what is printed on a shipper/carton label and compares only fields backed by an approved reference. Initially, unavailable expected fields remain `not-evaluated`; observed text may be retained as observation but must not be presented as verified.
- **Roles/capabilities:** `record-qc` records and views; `manage-qc` corrects/redacts and may export within the existing boundary.
- **Expected source:** No authoritative label artwork/reference is present in the reviewed corpus. The shipping guide supplies packaging settings, not printed label content. Profile brand/flavor names, recipe ingredients, ingredient lot numbers and shipping settings must not be silently treated as approved label text or finished-product lot/weight authority. Label ingredient/allergen claims are explicitly excluded.
- **Captured evidence and states:** After an approved reference source exists, snapshot its stable ID/version and expected field value alongside actual observed value, reason, and server-attributed event metadata. Per field: `pass`, `fail`, or `not-evaluated`; overall pass only if every required field has an authoritative expected value and matches. A failure in one evaluable field cannot be hidden by another unevaluated field. Defer image capture until a secure attachment path, access boundary and retention policy are approved.
- **History, correction, audit and retention:** A `label-check` event could use the QC ledger without a new table when text values fit the bounded payload. Strict field-specific corrections and redactions are required; preserve the original event. If reference values require app-managed versioned configuration, assess a separate persisted source and additive schema migration rather than putting unreviewed claims into QC events.
- **Operational impact and dependencies:** Advisory only; never block packaging/shipping. Block implementation of comparison fields until the owner identifies the authoritative label master and approves the exact non-regulatory fields that may be checked. Regulatory wording/claims require separate product and regulatory approval.
- **Focused verification:** Missing/ambiguous reference yields not-evaluated; exact normalization and mismatch behavior; reference-version snapshotting; no inference from recipe or shipping guide; bounded requests; correction/redaction; cross-facility isolation; reset/purge survival; upload security if later approved; and proof that failures do not affect shipping.

### 5. Date-code verification

- **User-visible outcome:** A QC operator records printed production/best-by values for a defined pizza/carton batch and sees a comparison only when an approved, deterministic expected-value source is available.
- **Roles/capabilities:** `record-qc` records and views; `manage-qc` corrects/redacts and may export within the existing boundary.
- **Expected source:** The current repository has production-run dates and ingredient-lot expiration dates, but no finished-product shelf-life rule, code format, date assignment policy, or approved carton/batch identity mapping. Do not derive best-by from ingredient expiration, a guessed shelf life, or the current calendar date. Production date is also not evaluable until the owner approves how a run/pack date maps to the printed code and facility-local date.
- **Captured evidence and states:** Snapshot product/batch identity, actual printed values, expected values only when sourced, source/version and parsing outcome, note, actor, server timestamp and run. Each date field is `pass`, `fail`, or `not-evaluated`; an unparseable code, absent policy, or ambiguous batch stays not evaluated. Overall pass requires every required date field to be evaluable and matching.
- **History, correction, audit and retention:** A `date-code-check` event can use the ledger for immutable per-check evidence. If an approved manager-maintained shelf-life/date-code policy is required, its storage is a separate design decision; any new field/table must follow the additive schema-change checklist. Corrections/redactions remain append-only; retention and purge behavior remain the Phase 1 contract.
- **Operational impact and dependencies:** Advisory only; no hold or expiration enforcement. Requires an owner-approved source, code decoder, production-date basis, batch identity and timezone rule before any expected date can be generated.
- **Focused verification:** Valid and invalid calendar dates, format/code parsing, leap days and timezone/day boundaries; absent/conflicting policy; no inferred shelf life; source snapshot immutability; correction/redaction; event idempotency; capability/scope; reset/purge survival; and no shipping/run enforcement.

## Persistence and API approach

Reuse the single facility-scoped `qc_workflow_events` ledger for future run-linked component, cross-contact, label and date-code evidence only if bounded event payloads remain sufficient. Its `event_type` is text and the event body is JSON, so these event types do not by themselves require new tables or columns. This is not a guarantee that the whole feature is schema-free: versioned expected-value catalogs, structured attachment metadata, or high-volume indexes may need separately approved additive schema work. No persistence changes are proposed in this task.

Any future write endpoint must derive facility scope and actor from the authenticated request, generate timestamps on the server, validate bounded inputs, use stable operation IDs for retry safety, and compute outcomes on the server. Expected values and pass/fail may not be client authority. Use `201` for a saved event and the existing safe JSON error shape; map invalid input to `400`, unauthenticated to `401`, denied capability/scope to `403`, unavailable scoped records to `404`, idempotency/stale conflicts to `409`, and unexpected failures to safe `500` responses. A required event write failure must fail the operation rather than display success.

Event additions require lockstep changes to the event type union, route schemas, event read/rendering, correction and redaction allow-lists, sign-off semantics, OpenAPI, and generated clients. New report/read endpoints also require OpenAPI and generated client updates, bounded date/page ranges, authenticated facility scoping, explicit source-unavailable responses, and tests that prove non-OK responses are not adopted as valid data. Do not edit generated files manually.

For any later schema change, use the additive schema-change checklist. For any photo/attachment requirement, design storage, authorization, retention, redaction and reset/purge behavior separately; do not store a raw URL or image bytes in the generic event payload.

## Owner decisions before implementation

1. **Phase 2 approval and order:** approve which proposed slices, if any, may proceed; this proposal itself authorizes no implementation.
2. **Component criteria:** approve the initial identity/presence-only checklist and the authoritative source for the effective run component list; decide later whether a controlled visual/sensory checklist or photo evidence is needed.
3. **Label source and field scope:** identify the current authoritative finished-label reference and approve which non-regulatory fields can be compared. No such reference was found in the repository.
4. **Date-code rules:** identify the authoritative finished-product date policy, production-date basis, timezone/code format and batch identity. No shelf-life or finished-date rule was found in the repository.
5. **Cross-contact criteria:** define the transition/equipment scope, cleaning evidence that counts for review, and whether “violation/near miss” terminology is wanted. The current evidence cannot establish any such result.
6. **Report presentation:** confirm whether the first read-only report should remain on-screen only or later support a manager export. Its date key should follow the canonical production-day date, not UTC event date.

No decision is needed to preserve the current non-blocking behavior, manual/derived separation, unknown-mapping semantics, or Phase 1 retention and authorization; those remain fixed by the approved contract.

## Validation matrix for a later UI implementation

| Surface | Planned evidence | Status in this design-only task |
|---|---|---|
| Desktop, Chromium/Chrome | Automated browser or responsive emulation plus operator flow for report/check entry | NOT RUN — no UI change in this task |
| Desktop, WebKit/Safari | Automated WebKit browser flow | NOT RUN — no UI change in this task |
| Phone, Chromium/Chrome | Phone-sized browser emulation for scroll, input, errors and save feedback | NOT RUN — no UI change in this task |
| Phone, WebKit/Safari | Phone-sized WebKit emulation | NOT RUN — no UI change in this task |
| Tablet portrait, Chromium/Chrome and WebKit/Safari | Responsive emulation | NOT RUN — no UI change in this task |
| Tablet landscape, Chromium/Chrome and WebKit/Safari | Responsive emulation | NOT RUN — no UI change in this task |
| Physical Android Chrome and physical iOS Safari/PWA | Device-only behavior; emulation is not a substitute | NOT RUN — no physical-device evidence collected for a proposal |

## Investigation and check ledger

| Check | Result | Evidence / next action |
|---|---|---|
| Phase 1 contracts reconciled against implementation and merged Task #2897 | PASS | QC event schema/routes/UI, allergen model, reset/purge integration coverage and approved plan reviewed. Preserve these boundaries. |
| Task overlap search | PASS | No active/proposed task other than this planning task owns these Phase 2 candidates; current Task #3246 is unrelated. Do not change unrelated task status. |
| Shipping-label/date authority in repository corpus | MISSING | Shipping workbook has packaging/pallet fields only; spec workbook has recipe/weight fields only. Owner must identify approved label/date source before comparison can pass. |
| Cross-contact transition/equipment/criteria source | MISSING | Phase 1 stores cleaning by run, not equipment/adjacent-run transition; no approved violation/near-miss criteria found. Owner must define before risk conclusions. |
| Concrete implementation defect found during investigation | PASS — none found | No production code changed. This is not a claim that Phase 2 is approved or production-ready. |
| Application tests/typecheck/release checks | NOT RUN — not required | Design/document-only task; no source-code change was made. |
| Proposal consistency with Phase 1 contracts and scope | PASS | Proposal keeps QC/advisory workflows non-blocking, manual allergen separate, unknown mappings unknown, and approved documents unchanged. |

