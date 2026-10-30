# Gold Lab customer-source decision

## Current decision

**Decision: conditional policy approval; NO-GO for real-source work.
Synthetic cases only until source-specific evidence and deletion compatibility
are verified.**

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

This is a documentation and implementation review of repository baseline
`440ed6a9091998f63615ceb76930bffd962b4b90`, not a runtime or production
attestation. Reviewed:

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

## Claim assessments

| Claim | Assessment | Evidence and limitation |
| --- | --- | --- |
| The development-only scorer switch grants customer-source permission. | **contradicted**, high confidence | `importGoldEnabled` independently requires the real-source flags, approval reference, and privacy status; the development path filters cases by its fixed synthetic identity. |
| An approval reference proves the owner authorized a specific workbook. | **contradicted**, high confidence | The server validates reference presence/format, not the referenced record, identity, terms, or source scope. An authorized human must verify those separately. |
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
terms; no automatic deletion, reminders, or deletion register has been implemented
by this documentation change.

### Deletion compatibility assessment

| Approved requirement | Current behavior and disposition |
| --- | --- |
| Maximum 30 days for evaluation cases and scores | Manual case deletion exists and score cascade is declared. No automatic deadline enforcement exists. Compliance requires an actual deletion register, reminders, and timely execution; it is not established by policy approval. |
| Earlier deletion on source-owner request | The same manual route can remove a scoped case while real-source authorization is enabled. The handler also gates real-source deletion on current approval, so revoking approval can prevent ordinary real-case cleanup. Do not re-enable capture merely to delete retained data; require a separately authorized, verified cleanup procedure before admitting real sources. |
| Delete evaluation working copies and approved exports | Case deletion cannot recall downloads or delete separately retained workbook copies. The responsible authorized role must inventory destinations and verify their cleanup separately. |
| Record actual backup retention without promising unsupported erasure | Backup retention and deletion behavior were not inspected and remain unknown. No complete-erasure claim is supported. |
| Keep original business records under their existing policy | The lab's case DELETE targets evaluation rows, not original workbooks; cleanup of external files must distinguish working copies from business records. |

Evidence is implementation inspection, not an executed deletion rehearsal:
the DELETE handler in `importOperations.ts`, the score foreign key in
`importGold.ts`, and the existing synthetic integration case
`lists, excludes, exports, and deletes only manager-visible scoped cases` in
`importOperations.integration.test.ts`. That test's source asserts disabled
real-case deletion returns 404 and enabled case deletion returns 204; it was
not run for this documentation-only decision. It does not establish backup
erasure or a runtime score-cascade result.

These limitations mean the approved policy cannot yet be attested as operationally
satisfied. The decision therefore uses the task's conservative branch: no real
source capture or scoring. It is not a recommendation to enable flags or bypass
the source-use boundary.

## Verification and unresolved requirements

- **Validation failure and repair:** the first required
  `bash scripts/src/run-release-node.sh pnpm run typecheck` attempt failed to
  resolve the already-declared `@workspace/schedule-move` dependency, producing
  consequent implicit-type errors and cancellation of the sibling client check.
  A frozen-lockfile workspace install restored the missing package link without
  changing application source, dependency manifests, or the lockfile.
  Completion validation must rerun; this repair alone is not a passing typecheck.
- **PASS:** bounded source inspection of authorization and application deletion
  behavior; no code, runtime settings, scorer switch, or provider routing changed.
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
- **Not run:** runtime deletion, upload, scoring, database queries, and browser
  tests; no customer-source operation is authorized or needed for this review.
- **Not applicable:** desktop/phone/tablet portrait and landscape,
  Chromium/Chrome, WebKit/Safari, physical-device and PWA checks; this note changes
  no UI or runtime behavior.

This closes the source-use decision on the synthetic-only branch while the
remaining operational requirements are uncertain. It does not complete or
authorize a real-source evaluation. Before any later real-source work, verify the
specific source set, private approval record, and all deletion requirements
outside any model-evaluation run. No approval reference, private evidence,
customer workbook upload, score, or runtime change is supplied by this note.
