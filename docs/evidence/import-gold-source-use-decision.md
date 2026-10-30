# Gold Lab customer-source decision

## Current decision

**Decision: conditional policy approval; NO-GO for real-source work.
Synthetic cases only until source-specific evidence and deletion compatibility
are verified.**

### Metadata-only approval ledger

The owner selected an application-database record containing metadata only.
The additive schema is `import_gold_approvals`; it stores opaque private-record,
owner, reviewer, conditions, external-copy and backup-handling references,
the permitted local-evaluation purpose, import type, exact evaluation-input
digest, review dates, 30-day manual-deletion acceptance, validity, and the
authenticated creation/verification/revocation actors and times. It stores no
workbook, source location, full approval document, or free-text evidence.

The protected `/api/import-gold/approvals` endpoints allow scoped Manager or
QC Manager users with `manage-staff` or `manage-qc` to create pending records
and list at most 50 at a time. Verification and revocation are separate explicit
review actions. Metadata is immutable after creation; revocation is permanent,
and the metadata/audit history is retained rather than silently deleted.
Neither creation nor verification changes runtime flags or independently
verifies a private document. The responsible human must actually review the
referenced evidence and its conditions before recording verification.

Real-source capture is also unavailable in all three existing import dialogs,
even if legacy server settings say Gold Lab is enabled. Home no longer builds
the old input-only capture payload, so ordinary Spec, Premix and Cheese Apply
does not fail because an unavailable approval ID was omitted. The future client
capture type requires an approval ID, but no approval-selection workflow is
enabled by this task. A later explicitly authorized workflow must select the
verified, matching source approval before exposing capture again; neither
metadata records nor configuration flags alone are sufficient.

Capture must now provide `goldCapture.approvalId` alongside `input`. Before
domain writes, the server locks the approval and checks its scope, configured
reference, import type, local-evaluation purpose, completeness, validity,
verification and revocation status, and exact input digest. The digest is
SHA-256 over JSON with recursively sorted object keys (JavaScript UTF-16
lexicographic order) and original array order, not a workbook-file hash or
evidence of permission. The private
approval record must map this digest to the exact permitted source. The case
retains its approval ID. Missing, mismatched, incomplete, expired, or revoked
approvals reject the whole Apply without committing domain or case changes.
Capture and revocation use the same row lock.

This local-use metadata does not approve Gemini comparison or case exports:
new approval-linked cases cannot be sent to Gemini or exported by the existing
JSONL endpoint. Local scoring rechecks the current approval before dispatch.
Legacy non-synthetic cases without an approval link cannot be scored, and case
exports remain synthetic-only under this policy.
Full documents, source ownership, permitted recipients/processing locations,
external copies and actual backup retention still require separate restricted
evidence and handling. The 30-day case policy is not a claim that approval
metadata, audit history, or backups are automatically erased.

No real approvals were inserted, no private evidence was copied, no enablement
settings were changed, and no production schema migration was run. The
development schema now has the approval table and nullable case link; production
schema application remains part of the normal Replit Publish process, not
startup DDL or direct production writes. The schema and endpoints do not change
the real-source NO-GO.

### Implementation verification and bounded failure record

- Synthetic verification: 42 tests passed across the approval-validator unit
  tests and atomic-import integration suite. The integration database was
  disposable and removed by its teardown. No real sources were captured.
- Completion review found that the old visible capture checkbox could submit
  input without the newly required approval ID and reject the entire import.
  The correction deliberately makes capture unavailable rather than adding
  an approval-selection workflow or enabling source capture. Dialog regressions
  exercise legacy `goldCaptureEnabled: true`, require no capture option, and
  require ordinary Apply to report no capture opt-in. All 43 tests across the
  three dialog suites and import-operation client boundary passed. The full
  root typecheck also passed again after this client correction.
- API generation initially rejected two unquoted comma-containing YAML
  descriptions; both were corrected and generation succeeded.
- The root typecheck identified an ambiguous transaction error-response type
  in the new approval router. Its result union was made explicit; final
  `bash scripts/src/run-release-node.sh env CI=true pnpm run typecheck`
  passed after that correction, including generated-API freshness, shared
  libraries, the API route check, client, mockup and scripts checks.
- A read-only metadata command encountered a stale API-local `tsx` executable
  link. The existing scripts-package executable worked. Database fingerprints
  confirmed the application connection matched managed development and
  differed from production, without recording connection strings or raw
  database names.
- The development-only, table-filtered Drizzle push created the requested table
  and nullable link, then reported an attempt to drop the unrelated
  `import_gold_scores_id_seq`. PostgreSQL refused that operation. The command
  returned zero despite this error. No forced retry or sequence deletion was
  attempted. Read-only metadata inspection confirmed the new primary key,
  source/reference unique index, scoped-list index, case foreign key and
  existing case indexes are present, and the unrelated score identity sequence
  remains attached. The temporary scoped configuration was removed. This is
  not a clean full-schema migration or proof of production compatibility.
- The development API started and reached readiness. `/api/healthz` returned
  `status: ok` with process, startup, database, audit protection, dependencies
  and background-worker checks all `ok`. The API-only screenshot also reported
  a missing favicon; no application page or browser interaction changed.
- After the client correction, the web workflow started cleanly and its
  screenshot showed the normal signed-out landing page. Its protected API
  requests returned 401 without a session, as expected. This screenshot does
  not claim to inspect the authenticated import dialogs; their availability
  and Apply callbacks are covered by the component tests above.
- An automatic log refresh included database-timeout warnings from the existing
  published queue/alert process. They are not evidence from this task's serving
  revision; no production investigation or change was performed.

### Implementation update — 2026-10-30

A cleanup-only application path is now implemented for retained cases when
source approval is disabled. It requires the separate
`IMPORT_GOLD_CLEANUP_ENABLED=true` setting and the existing `manage-staff`
capability. Its inventory returns only case ID, import type, and creation time;
deletion removes the scoped case and score rows and appends an audit entry with
the authenticated actor, scope, case ID, and timestamp. Cleanup-only mode also
blocks ordinary case and score content APIs, including development-only
synthetic review and scoring tools. The setting does not enable capture,
scoring, export, or case-content reads. This implementation update is based on
source and isolated synthetic integration tests; it does not establish the
setting's value or database constraint status in production, and does not
change the NO-GO for real-source work.

The project owner identified the Manager and QC Manager as authorized roles and
subsequently confirmed that they approve the proposed local workbook evaluation
and that privacy review was completed and approved. These are user-reported
decisions, not independently verified restricted approval evidence. No approval
reference has been created. The specific privacy reviewer, decision date,
conditions, and private record remain to be verified. No application
capabilities or runtime settings have changed.

The project owner clarified that Manager and QC Manager share all roles in
this workflow. Either may handle authorization, privacy review, deletion, and
deletion verification. Separate duties are not imposed by this decision note.
This clarification does not approve a retention deadline or alter app permissions.

The project owner subsequently approved the proposed 30-day retention policy
below. This records the policy decision, not evidence that the private approval
record or the required deletion operations have been completed.

The intended purpose is bounded spec-import accuracy evaluation in Gold Lab using
the private local evaluator. The project owner identified dough, sauce, cheese,
mix, and spec workbooks as the intended categories. These categories are not an
authorization or an inventory of specific approved sources. The specific source
set, source ownership evidence, source-specific handling conditions, actual
backup retention, and verification of the reported privacy outcome remain
unresolved. Model training, Gemini comparison,
production routing, and other uses are not authorized by this decision.

## Evidence scope

The initial documentation and implementation review used repository baseline
`440ed6a9091998f63615ceb76930bffd962b4b90`, not a runtime or production
attestation. Later metadata-only implementation changes and read-only checks
are identified separately above and below. Reviewed:

- `docs/spec-import-gold-review.md`
- `docs/local-ai-evaluation.md`
- `docs/evidence/import-gold-lab-2026-10-21.md`
- `artifacts/api-server/src/lib/importGoldEndpoint.ts`
- Gold authorization, exclusion, deletion, export, and scoring handlers in
  `artifacts/api-server/src/routes/importOperations.ts`
- `lib/db/src/schema/importGold.ts`

No customer content, private history, approval identities, source locations, or
private authorization evidence was accessed or copied. Available integration
discovery did not identify an accessible approval-record store. This does not
prove that no private approval records exist.

On 2026-10-30, read-only table-metadata queries against the Replit managed
development and production databases returned `public.import_gold_cases` and
`public.import_gold_scores` as the only public tables whose names matched
`%gold%` or `%approv%`. No named approval-record table or Gold retention table
was returned. Before the metadata-only addition, the repository had no
approval-record model; its Gold models covered cases, scores, and retention
metadata. No table rows or customer
content were queried. This establishes only that these database snapshots have
no matching named table; it does not rule out a record in a generic table or an
external restricted system. It also does not verify the runtime database schema
used by a published process.

Read-only Replit environment and secret-inventory checks on the same date found
none of the five real-source gate settings in either development or production.
The application gate therefore cannot pass from those configured values.
Nothing was changed. This does not attest to runtime configuration outside
Replit's environment inventory.

## Claim assessments

| Claim | Assessment | Evidence and limitation |
| --- | --- | --- |
| The development-only scorer switch grants customer-source permission. | **contradicted**, high confidence | `importGoldEnabled` independently requires the real-source flags, approval reference, and privacy status; the development path filters cases by its fixed synthetic identity. |
| An approval reference proves the owner authorized a specific workbook. | **contradicted**, high confidence | A reference alone is not evidence. Capture now also requires a verified, current, scoped metadata row bound to the exact input and import type. The verification action records an authorized human's attestation; it does not independently inspect the referenced private document or establish the owner's authority. |
| Case exclusion deletes stored content. | **contradicted**, high confidence | The exclusion handler updates `excluded` and `excludedAt`; it does not delete rows. |
| Case deletion removes the case and its score attempts from the application database. | **verified**, high confidence for implementation intent only | The scoped manager DELETE handler deletes the case; the declared score foreign key specifies `onDelete: "cascade"`. No deletion was executed and the deployed database constraint was not inspected. |
| Export deletes cases or recalls previously downloaded copies. | **contradicted**, high confidence | The JSONL handler reads cases without deletion. Previously downloaded copies are outside this deletion handler. |
| Application-row deletion establishes complete erasure everywhere. | **unsupported**, high confidence | These handlers do not establish deletion of source files, exports, database backups, diagnostic copies, or evaluator-side data. Actual retention and deletion for every approved destination must be reviewed separately. |
| The intended source set and local evaluation use have verified owner and privacy clearance. | **needs-human**, high confidence | The project owner reports source-use and privacy approval by authorized roles, but no specific source inventory or verified restricted approval record is available to this review. |

Counts: verified 1; partially verified 0; unsupported 1; stale-suspected 0;
contradicted 4; needs-human 1.

The existing lab note also states that cases have no automatic expiration and
survive daily reset and factory purge. This review does not independently
re-prove those lifecycle paths. Do not promise automatic deletion or treat a
reset, purge, exclusion, export, or evaluator-cache removal as a substitute for
the approved deletion procedure.

## Required private approval record

Use the record structure in
[`import-gold-lab-2026-10-21.md`](import-gold-lab-2026-10-21.md) in an
access-controlled location outside Git. Before allowing any real-source work,
the responsible source owner and privacy reviewer must resolve:

1. The exact authorized source set and the source owner's authority under the
   applicable customer terms.
2. Explicit permission for the stated local Gold Lab evaluation purpose,
   permitted recipients and processing locations, and prohibited uses.
3. Retention deadlines, a deletion owner, and acceptable deletion methods for
   workbooks, derived cases and scores, exports, evaluator-side data, diagnostic
   copies, and backups where applicable.
4. A privacy decision, reviewer, decision date, and conditions. Do not infer
   `not_required`; the reviewer must explicitly determine it where permitted.
5. Verification that actual deletion behavior meets those requirements,
   including a safe synthetic rehearsal if needed, without using customer
   content. If automatic expiration or complete erasure is required but cannot
   be demonstrated, do not enable real-source work.

Keep identities, workbook names/locations, completed approval evidence, and any
private mapping outside this repository. Only a permitted, non-sensitive status
summary belongs here.

### Suggested approval route — not yet adopted or approved

Use the organization's existing access-controlled document system to identify
the specific sources privately and retain the written decision. The source
owner or an authorized representative must confirm authority under the relevant
customer terms; possession of a workbook alone does not establish that authority.
If the content belongs to a customer, obtain the appropriate customer
authorization unless the applicable agreement already permits this use.

Ask the person responsible for privacy review to record the required review and
outcome, including an explicit determination if review is not required. Agree
on retention deadlines and accountable deletion ownership before any upload.
Then compare those requirements with actual handling at every destination,
including exports and backups where applicable. This suggested process grants
no permission and does not substitute for the completed private record.

### Approved retention policy

Retain each evaluation case for no more than 30 days after capture, with earlier
deletion on source-owner request. Either the Manager or QC Manager must manually
delete the case and score history by the deadline, verify completion, and record
it in the restricted deletion register. No separate verifier is required by the
project owner's role clarification. A register and reminders are required
because the lab has no automatic expiration.

Delete evaluation-only workbook copies and any approved exports by the same
deadline. Avoid exports unless specifically needed and approved. Original
business records remain subject to their existing policy; lab cleanup must not
delete them. Record actual backup retention and handling separately. Do not
promise complete erasure within 30 days unless that is demonstrated for all
applicable destinations, including backups. The project owner approved these
terms. The implementation update below adds manual deadline tracking only; it
does not provide automatic deletion or establish that every destination has
been erased.

### Runtime tracker implementation

The application now has a scope-bound, payload-free register that records each
case's capture time, a deadline exactly 30 elapsed days later, and the time and
identity of a manager who records manual deletion verification. Existing cases
are backfilled from their stored capture timestamps when the register is read.
An in-app reminder appears during the seven days before a deadline and remains
overdue until the case and score rows are absent and a Manager or QC Manager
records verification. The register remains visible when the real-source feature
gate is disabled; it does not enable capture, scoring, or case deletion.

This is source-code and synthetic-test evidence, not proof of production
behavior or real-source authorization. The register verifies only application
case and score rows. It does not track or prove deletion of workbooks, exports,
evaluator copies, diagnostic copies, or database backups. Those destinations
remain separate manual responsibilities, and automatic erasure is not claimed.

### Deletion compatibility assessment

| Approved requirement | Current behavior and disposition |
| --- | --- |
| Maximum 30 days for evaluation cases and scores | A capture-based deadline register shows seven-day and overdue reminders. Case deletion and verification remain manual; there is no automatic expiry, and source inspection/tests do not prove production compliance. |
| Earlier deletion on source-owner request | With approval active, ordinary case deletion remains approval-gated. After approval is withdrawn, the separately gated cleanup-only route (`IMPORT_GOLD_CLEANUP_ENABLED=true`, `manage-staff`) lists only scoped IDs, import types, and creation times and deletes the selected application case and score history without reopening ordinary content reads, scoring, capture, or export. The retention record remains for verification by either Manager or QC Manager after both rows are absent. Do not re-enable capture merely to delete retained data. |
| Delete evaluation working copies and approved exports | Application cleanup cannot recall downloads or delete separately retained workbook copies. The responsible authorized role must inventory destinations and verify their cleanup separately. |
| Record actual backup retention without promising unsupported erasure | Backup retention and deletion behavior were not inspected and remain unknown. No complete-erasure claim is supported. |
| Keep original business records under their existing policy | The lab's case DELETE targets evaluation rows, not original workbooks; cleanup of external files must distinguish working copies from business records. |

Evidence includes source inspection, synthetic isolated integration tests, and
browser checks, not a real-source or production deletion rehearsal. The
cleanup-only integration test
`allows scoped metadata-only cleanup after approval withdrawal without
reopening Gold Lab reads` checks scope, role revocation, disabled content reads,
score-row deletion, audit minimization, invalid IDs, and repeated deletion. The
retention integration test checks capture-based math, payload-free scoped
metadata, role boundaries, manual verification, and persistence after reload.
The cleanup and retention interfaces were exercised with synthetic data in
desktop, phone, tablet portrait, and tablet landscape emulation on Chromium and
WebKit. These browser checks verify the UI, not physical devices or persistence;
the isolated API tests verify database behavior. No customer content was used.
These checks do not establish backup erasure, source-workbook deletion, export
recall, evaluator-side deletion, or the published database's foreign-key state.

These limitations mean the approved policy cannot yet be attested as operationally
satisfied. The decision therefore uses the task's conservative branch: no real
source capture or scoring. It is not a recommendation to enable flags or bypass
the source-use boundary.

## Verification and unresolved requirements

- **PASS:** final root typecheck, including generated-API freshness and API
  routes, after the dependency-link and error-response repairs described in
  this review history. This is not a full release or production-readiness gate.
- **PASS:** bounded source inspection of authorization and application deletion
  behavior and the metadata-only implementation described above. No enablement
  setting or scorer switch changed; source approvals are local-use-only.
- **PASS:** user decisions recorded for the five workbook categories, local
  evaluation purpose, shared authorized roles, reported approved privacy review,
  and 30-day manual-retention policy.
- **PASS:** policy-to-implementation comparison recorded above, with explicit
  limitations and a synthetic-only disposition rather than an enablement claim.
- **BLOCKED for future real-source use:** specific source scope, verification of
  reported source-use and privacy approvals, and operational retention
  compatibility. Accountable
  parties: project owner to establish the specific source scope and restricted
  evidence location; either Manager or QC Manager to document the decisions,
  inventory evaluation copies, maintain and execute deletion deadlines, and
  establish backup handling and an approved cleanup route after revocation.
  No existing customer-case presence is inferred; no customer data was queried.
- **Not run:** real-source upload, scoring or deletion, private-document review,
  published-schema migration, or authenticated end-to-end browser flows.
  Synthetic database/API tests, bounded schema metadata checks and the
  development health screenshot are recorded above.
- **Not applicable:** desktop/phone/tablet portrait and landscape,
  Chromium/Chrome, WebKit/Safari, physical-device and PWA checks; this note changes
  no layout or navigation changes. The removed capture-option availability is
  covered by component tests; server behavior by scoped database/API checks.

This closes the source-use decision on the synthetic-only branch while the
remaining operational requirements are uncertain. It does not complete or
authorize a real-source evaluation. Before any later real-source work, verify the
specific source set, private approval record, and all deletion requirements
outside any model-evaluation run. No approval reference, private evidence,
customer workbook upload, score, or runtime change is supplied by this note.
